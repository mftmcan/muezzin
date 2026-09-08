import { db, Timestamp } from './lib/firebaseAdminInit.ts';
import {
  haftalikPlanUret,
  tekKisiliGunleriBul,
  kapsamsizGunleriBul,
  nobeteAtanabilirMi,
  oncekiHaftaninArdArdaYedekSayilariniHesapla,
  OnayliIzin,
  VAKITLER,
} from '../src/lib/planlamaCekirdegi.ts';
import { getTurkeyNow, isFriday, getOncekiHafta } from '../src/lib/dateUtils.ts';
import { handleFirestoreError, OperationType } from './lib/errors.ts';
import { EzanVakitOkuyucu } from './lib/ezanVakitleri.ts';
import { fcmGonderVeTemizle, kullaniciFcmTokenleriniTopla, type FcmMessage } from './lib/fcmNotify.ts';
import { Muezzin, Vakit, VakitAtama } from '../src/types';

function formatDateLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Bir haftanın atamalarını müezzinlerin bellek içi aylık yük sayaçlarına
// ekler — kalıcı Firestore güncellemesi yine yalnızca
// scripts/yatsiSonuIslemleri.ts'in günlük işidir, bu yalnızca AYNI script
// çalıştırması içindeki sonraki hafta iterasyonlarının adalet hesabını
// beslemek içindir (bkz. algoritma denetimi).
//
// minTarih verilirse yalnızca o tarihten (dahil) itibaren olan günler
// sayılır: zaten var olup atlanan bir haftanın GEÇMİŞ günleri
// yatsiSonuIslemleri tarafından zaten kalıcı sayaçlara işlenmiş olur, onları
// burada tekrar saymak çifte sayıma yol açar. Bu script'in bu çalıştırmada
// TAZE ürettiği hafta için minTarih verilmez (haftanın tamamı zaten geleceğe
// ait olduğundan çifte sayım riski yoktur).
function gunPlanProjeksiyonuUygula(
  gunler: string[],
  gunPlan: Record<string, Record<Vakit, VakitAtama>>,
  muezzinler: (Muezzin & { id: string })[],
  minTarih?: string
) {
  for (const gun of gunler) {
    if (minTarih && gun < minTarih) continue;
    const veri = gunPlan[gun];
    if (!veri) continue;
    const [gY, gM, gD] = gun.split('-').map(Number);
    const gunCumaMi = isFriday(new Date(gY, gM - 1, gD));
    for (const vakit of VAKITLER) {
      const atama = veri[vakit];
      if (!atama) continue;
      if (atama.asil !== 'Sistem') {
        const asilKisi = muezzinler.find((m) => m.id === atama.asil);
        if (asilKisi) {
          asilKisi.aylikVakitSayisi = (asilKisi.aylikVakitSayisi || 0) + 1;
          if (gunCumaMi) asilKisi.aylikCumaSayisi = (asilKisi.aylikCumaSayisi || 0) + 1;
        }
      }
      // Yedek yükü de projekte edilmeli — aksi halde aynı koşuda üretilen
      // sonraki haftalar "bu hafta kimse yedek olmadı" varsayımıyla adalet
      // hesabı yapar (premium hata analizi PL-O1). tieBreaker.ts'teki
      // aylikYedekSayisi ağırlığıyla (YEDEK_YUK_CARPANI) tutarlı olmalı.
      if (atama.yedek !== 'Sistem') {
        const yedekKisi = muezzinler.find((m) => m.id === atama.yedek);
        if (yedekKisi) {
          yedekKisi.aylikYedekSayisi = (yedekKisi.aylikYedekSayisi || 0) + 1;
        }
      }
    }
  }
}

async function main() {
  console.log('Haftalık plan oluşturma başladı...');

  // `vakitler` okumalarını (ay belgeleri) çalıştırma boyunca önbellekleyen tek
  // okuyucu — 3 hafta × 7 gün × 5 vakit için ayrı okuma yapmaz.
  const okuyucu = new EzanVakitOkuyucu();

  // Plan/bildirim yazımı ile FCM duyurusu ayrı başarısızlık alanlarıdır: bir
  // FCM arızası plan üretimini geri almamalı (plan zaten commit edildi), ama
  // sessizce de geçmemeli — aksi halde script 0 ile çıkar ve
  // haftalik-plan.yml'in `if: success()` adımı (reportWorkflowSuccess.ts)
  // önceki gerçek bir arızanın admin uyarısını yanlışlıkla çözer. Bu yüzden
  // arıza biriktirilip çıkış kodunda bildirilir.
  let fcmArizasiVar = false;

  // 1. Personel Çekme (Adminler ve Müezzinler dahil, Gözlemciler hariç)
  let muezzinSnapshot;
  try {
    muezzinSnapshot = await db.collection('muezzins').where('aktif', '==', true).get();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'muezzins');
    return;
  }

  // Sadece aktif müezzinleri alalım
  const muezzinler = muezzinSnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Muezzin & { id: string })
    .filter((m) => nobeteAtanabilirMi(m));

  // NOT (mimari denetim — bütünsel hata analizi): bu eşik önceden 2 idi,
  // ama src/services/planServisi.ts'teki İSTEMCİ self-healing çağırıcısı
  // aynı çekirdeği (haftalikPlanUret) 1 aktif müezzinle bile çağırıyordu —
  // CLAUDE.md'nin "TEK çekirdek, her iki çağıran AYNI kuralları kullanır"
  // ilkesine aykırı bir davranışsal ayrışmaydı. `haftalikPlanUret`'in
  // kendisi zaten tek-kişilik hafta için tasarlanmış bir dal içeriyor
  // (yedek her zaman 'Sistem') — bu script'in daha katı eşiği, personel
  // sayısı 1'e düştüğünde (istemci sessizce yedeksiz bir plan üretip
  // yayınlayabilirken) gece cron'unun HİÇ plan üretmemesine yol açıyordu.
  if (muezzinler.length < 1) {
    console.error('Yetersiz müezzin! Planlama yapılamıyor.');
    await db.collection('adminUyarilari').add({
      tip: 'zincirTukendi',
      mesaj: 'Aktif personel sayısı planlama için yetersiz (en az 1 gerekli).',
      tarih: formatDateLocal(getTurkeyNow()),
      vakit: null,
      cozuldu: false,
      olusturmaTarihi: Timestamp.now(),
    });
    process.exit(1);
  }

  // 3. Dinamik Tarih Hesaplama (Türkiye takvim gününe göre — runner UTC'de çalışır)
  const simdi = getTurkeyNow();
  const bugunDay = simdi.getDay();
  // Pazartesiye git (0: Pazar ise -6 gün, 1: Pzt ise 0 gün...)
  const diff = bugunDay === 0 ? -6 : 1 - bugunDay;

  const pazartesiTemel = new Date(simdi);
  pazartesiTemel.setDate(simdi.getDate() + diff);
  pazartesiTemel.setHours(0, 0, 0, 0);

  const bugunStr = formatDateLocal(simdi);

  // 2. Onaylanmış İzinleri Çek — `bitis >= bugunStr`: bugünden ÖNCE bitmiş
  // onaylı izinlerin önümüzdeki 3 haftadan hiçbirini etkileme ihtimali yok
  // (düşük öncelikli bulgu — filtresiz sorgu yıllar içinde birikmiş TÜM
  // onaylı izin geçmişini her çalıştırmada okuyordu). `durum+bitis` bileşik
  // index'i zaten mevcut (bkz. src/services/planServisi.ts aynı desen).
  const izinSnapshot = await db.collection('izinler').where('durum', '==', 'onaylandi').where('bitis', '>=', bugunStr).get();
  const onayliIzinler = izinSnapshot.docs.map((doc) => doc.data() as OnayliIzin);

  // Gelecek 3 hafta için plan oluşturmayı dene (Daha güvenli bir aralık)
  for (let weekOffset = 0; weekOffset < 3; weekOffset++) {
    const pazartesi = new Date(pazartesiTemel);
    pazartesi.setDate(pazartesiTemel.getDate() + weekOffset * 7);

    const haftaBaslangicStr = formatDateLocal(pazartesi);
    const haftaId = `W${haftaBaslangicStr}`;

    const gunler: string[] = [];
    for (let i = 0; i < 7; i++) {
      const gun = new Date(pazartesi);
      gun.setDate(pazartesi.getDate() + i);
      gunler.push(formatDateLocal(gun));
    }
    const haftaBitisStr = gunler[6];

    const planDoc = await db.collection('haftaPlanlari').doc(haftaId).get();
    if (planDoc.exists) {
      console.log(`Plan (${haftaId}) zaten mevcut, atlanıyor.`);
      // Bu hafta önceki bir çalıştırmada üretilmiş olabilir — henüz
      // gerçekleşmemiş (bugünden itibaren) günlerini bellek içi adalet
      // hesabına dahil et ki bu çalıştırmada üretilecek sonraki haftalar
      // bu yükten habersiz kalmasın (bkz. algoritma denetimi).
      const mevcutGunPlan = planDoc.data()?.gunler as Record<string, Record<Vakit, VakitAtama>> | undefined;
      if (mevcutGunPlan) {
        gunPlanProjeksiyonuUygula(gunler, mevcutGunPlan, muezzinler, bugunStr);
      }
      continue;
    }

    console.log(`${haftaId} haftası için otomatik plan oluşturuluyor...`);

    const batch = db.batch();
    let eksikSonBasvuru = 0;

    // Bir önceki haftanın son vaktinin (Pazar yatsı) ASİLİNİ oku — hafta
    // sınırında dinlenme kuralının (SOS) sıfırlanmasını önlemek için (bkz.
    // algoritma denetimi). SADECE asil taşınır, yedek değil (premium hata
    // analizi PL-K1 — yedek çoğu zaman fiilen görev yapmaz, bkz.
    // src/lib/planlamaCekirdegi.ts). Önceki hafta hiç üretilmemişse (soğuk
    // başlangıç) boş dizi kullanılır, mevcut davranışla aynıdır.
    const { haftaId: oncekiHaftaId, sonGun: oncekiSonGun } = getOncekiHafta(haftaId);
    const oncekiPlanDoc = await db.collection('haftaPlanlari').doc(oncekiHaftaId).get();
    const oncekiHaftaSonEkibi: string[] = [];
    if (oncekiPlanDoc.exists) {
      const sonVakitAtama = oncekiPlanDoc.data()?.gunler?.[oncekiSonGun]?.yatsi;
      // 'SISTEM' (büyük harf) — eski verilerde kalmış, bkz.
      // src/services/planServisi.ts'teki AYNI düzeltme (düşük öncelikli bulgu).
      if (sonVakitAtama?.asil && sonVakitAtama.asil !== 'Sistem' && sonVakitAtama.asil !== 'SISTEM') {
        oncekiHaftaSonEkibi.push(sonVakitAtama.asil);
      }
    }
    // Art arda yedek kilidinin (bkz. tieBreaker.ts ARD_ARDA_YEDEK_ESIGI) hafta
    // sınırında sıfırlanmasını önlemek için (premium hata analizi PL-O2).
    const oncekiArdArdaYedekSayilari = oncekiHaftaninArdArdaYedekSayilariniHesapla(
      oncekiPlanDoc.exists ? (oncekiPlanDoc.data()?.gunler as Record<string, Record<Vakit, VakitAtama>> | undefined) : undefined,
      muezzinler.map((m) => m.id)
    );

    // Tek, paylaşılan atama çekirdeği (bkz. src/lib/planlamaCekirdegi.ts) —
    // src/services/planServisi.ts'deki istemci "self-healing" akışıyla
    // AYNI kuralları kullanır: onaylı izindeki veya sabit haftalık izin
    // gününde olan personel asla atanmaz.
    const gunPlan = haftalikPlanUret(gunler, muezzinler, onayliIzinler, undefined, oncekiHaftaSonEkibi, oncekiArdArdaYedekSayilari);

    for (const gun of gunler) {
      const [gY, gM, gD] = gun.split('-').map(Number);
      const cumaMi = isFriday(new Date(gY, gM - 1, gD));

      for (const vakit of VAKITLER) {
        const atama = gunPlan[gun][vakit];

        // `mazeretSonBasvuru`: mazeret/vekalet penceresinin KAPANDIĞI gerçek
        // an — firestore.rules'un `request.time` (SUNUCU saati) ile
        // karşılaştırdığı tek güvenilir damga (bkz. firestore.rules
        // `mazeretPenceresiAcik`). İstemcinin `getTurkeyNow()`'u cihaz saatine
        // düşebildiğinden 1 saatlik pencerenin OTORİTER uygulaması budur;
        // burada, güvenilir Admin SDK bağlamında ve doğrulanmış ezan verisiyle
        // hesaplanır. Ezan verisi henüz yoksa (ör. 3 hafta ileri planlanan bir
        // gün, o ayın `vakitler` belgesi daha yazılmadan) alan YAZILMAZ ve
        // pencere kural tarafında KAPALI sayılır (fail-closed); eksik damgalar
        // scripts/mazeretPenceresiBackfill.ts tarafından (10 dakikada bir)
        // veri geldiğinde tamamlanır.
        const sonBasvuru = await okuyucu.mazeretSonBasvuru(gun, vakit);
        if (!sonBasvuru) eksikSonBasvuru++;
        const pencereAlani = sonBasvuru ? { mazeretSonBasvuru: Timestamp.fromDate(sonBasvuru) } : {};

        // Bildirim ID'leri kasıtlı olarak deterministiktir (haftaId_tarih_vakit_tip).
        // Bu, mazeret/vekalet akışlarının Firestore güvenlik kurallarında
        // getAfter() ile "asil" ve "yedek" belgelerini çapraz doğrulamasını
        // sağlar (bkz. firestore.rules `isBackupPromotionFromMazeret`).
        if (atama.asil !== 'Sistem') {
          const bAsil = db.collection('bildirimler').doc(`${haftaId}_${gun}_${vakit}_asil`);
          batch.set(bAsil, {
            haftaId,
            tarih: gun,
            vakit,
            uid: atama.asil,
            tip: 'asil',
            durum: 'bekliyor',
            pendingAck: true,
            retSebebi: null,
            cumaMi,
            olusturmaTarihi: Timestamp.now(),
            sonGuncelleme: Timestamp.now(),
            ...pencereAlani,
          });
        }

        if (atama.yedek !== 'Sistem') {
          const bYedek = db.collection('bildirimler').doc(`${haftaId}_${gun}_${vakit}_yedek`);
          batch.set(bYedek, {
            haftaId,
            tarih: gun,
            vakit,
            uid: atama.yedek,
            tip: 'yedek',
            durum: 'bekliyor',
            pendingAck: true,
            retSebebi: null,
            cumaMi,
            olusturmaTarihi: Timestamp.now(),
            sonGuncelleme: Timestamp.now(),
            ...pencereAlani,
          });
        }
      }
    }

    if (eksikSonBasvuru > 0) {
      console.warn(
        `${haftaId}: ${eksikSonBasvuru} slot için ezan verisi yok — mazeretSonBasvuru damgası yazılamadı; mazeret/vekalet o slotlarda veri gelene kadar KAPALI kalır (bkz. scripts/mazeretPenceresiBackfill.ts).`
      );
    }

    batch.set(db.collection('haftaPlanlari').doc(haftaId), {
      haftaBaslangic: haftaBaslangicStr,
      haftaBitis: haftaBitisStr,
      durum: 'yayinda',
      olusturmaTarihi: Timestamp.now(),
      gunler: gunPlan,
    });

    // Hiç kimsenin müsait olmadığı (tamamen kapsamsız) günler — sistemdeki
    // en ağır durum, önceden hiçbir uyarı üretmiyordu (bkz. mimari denetim O3).
    const kapsamsizGunler = kapsamsizGunleriBul(gunPlan);
    if (kapsamsizGunler.length > 0) {
      console.error(`${haftaId}: HİÇ KİMSENİN müsait olmadığı günler: ${kapsamsizGunler.join(', ')}`);
      // Her gün için ayrı bir uyarı (tek uyarının `tarih` alanı yalnızca
      // ilk günü taşıyıp diğerlerini yalnızca mesaj metninde bırakması —
      // dedup'ın diğer günleri hiç görememesine yol açıyordu, bkz.
      // src/services/planServisi.ts PL-O7 yorumu, aynı sınıf bulgu).
      for (const gun of kapsamsizGunler) {
        batch.set(db.collection('adminUyarilari').doc(), {
          tip: 'planOlusturulamadi',
          mesaj: `${haftaId} haftasında ${gun} için HİÇ KİMSE müsait değil (herkes izinli/haftalık izin gününde). Acilen kadro/izin durumunu kontrol edin.`,
          tarih: gun,
          vakit: null,
          cozuldu: false,
          olusturmaTarihi: Timestamp.now(),
        });
      }
    }

    // Tek kişinin (yedeksiz) kaldığı günler için admin'e görünürlük bırak —
    // önceden bu durum sessizce geçiyordu (bkz. algoritma denetimi).
    const tekKisiliGunler = tekKisiliGunleriBul(gunPlan);
    if (tekKisiliGunler.length > 0) {
      console.warn(`${haftaId}: yedeksiz kalan günler: ${tekKisiliGunler.join(', ')}`);
      for (const gun of tekKisiliGunler) {
        batch.set(db.collection('adminUyarilari').doc(), {
          tip: 'zincirTukendi',
          mesaj: `${haftaId} haftasında ${gun} yalnızca tek kişiyle (yedeksiz) planlandı. Kadro müsaitliğini kontrol edin.`,
          tarih: gun,
          vakit: null,
          cozuldu: false,
          olusturmaTarihi: Timestamp.now(),
        });
      }
    }

    await batch.commit();
    console.log(`Başarı: ${haftaId} planı ve bildirimleri oluşturuldu.`);

    // Bu cron çalıştırması aynı anda birden fazla YENİ hafta üretirse (soğuk
    // başlangıç / uzun kesinti sonrası), sonraki hafta iterasyonunun adalet
    // hesabı bu haftanın taze atamalarını görsün diye bellek içi projeksiyon
    // yapılır. Firestore'a yazılmaz — kalıcı güncelleme yine yalnızca
    // scripts/yatsiSonuIslemleri.ts'in günlük işidir (bkz. algoritma denetimi).
    gunPlanProjeksiyonuUygula(gunler, gunPlan, muezzinler);

    try {
      const tokenToUidMap: Record<string, string> = {};
      const fcmTokens: string[] = [];
      muezzinler
        .filter((m) => m.notificationSettings?.nobetHatirlatici !== false)
        .forEach((m) => {
          const userTokens = kullaniciFcmTokenleriniTopla(m);
          userTokens.forEach((t) => {
            tokenToUidMap[t] = m.id;
          });
          fcmTokens.push(...userTokens);
        });

      const messages: FcmMessage[] = fcmTokens.map((token) => ({
        token,
        notification: {
          title: 'Yeni Haftalık Plan Yayınlandı 🗓️',
          body: 'Önümüzdeki haftanın ezan nöbet planı hazırlandı. Görevlerinizi kontrol etmek için dokunun.',
        },
        data: {
          type: 'weekly_plan_published',
        },
      }));

      await fcmGonderVeTemizle(messages, tokenToUidMap, 'FCM haftalık plan bildirimi');
    } catch (fcmErr) {
      console.error('FCM haftalık plan bildirim gönderimi başarısız oldu:', fcmErr);
      fcmArizasiVar = true;
    }
  }

  if (fcmArizasiVar) {
    console.error('Plan(lar) oluşturuldu ancak FCM bildirimi gönderilemedi — iş BAŞARISIZ sayılıyor (bkz. main() başındaki yorum).');
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Kritik hata:', err);
  process.exit(1);
});
