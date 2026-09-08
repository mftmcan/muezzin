import { db, Timestamp } from './lib/firebaseAdminInit.ts';
import { toTurkishUpperCase, getTurkeyDateString, getTurkeyNow } from '../src/lib/dateUtils.ts';
import { EzanVakitOkuyucu } from './lib/ezanVakitleri.ts';
import { VEKALET_DEVRI_BEKLEME_ASIMI_MS } from '../src/lib/slotKorumasi.ts';

type BildirimData = {
  haftaId: string;
  tarih: string;
  vakit: string;
  uid: string;
  tip: 'asil' | 'yedek' | 'gorev_cagrisi';
  durum: string;
  cumaMi?: boolean;
  vekaletDevredildi?: boolean;
  vekaletDevriBekliyor?: boolean;
  vekaletPlanSenkronEdildi?: boolean;
};

type VekaletTalebiData = {
  bildirimId: string;
  haftaId: string;
  gonderenUid: string;
  gonderenIsim: string;
  aliciUid: string;
  aliciIsim: string;
  tarih: string;
  vakit: string;
  tip: 'asil' | 'yedek' | 'gorev_cagrisi';
  durum: 'beklemede' | 'kabul_edildi' | 'reddedildi';
  bildirimUygulandi?: boolean;
  /** `bildirimUygulandi` yalnızca "script bu talebi işledi mi" bilgisini
   * taşır, SONUCUNU değil — istemci tarafı (useBekleyenVekaletDevirleri,
   * "DEVİR İŞLENİYOR" banner'ı) hem başarı hem red durumunda bu alanı aynı
   * `true` değeriyle görüyordu, ikisini ayırt edemiyordu (bkz. mimari
   * denetim). */
  talepSonuc?: 'uygulandi' | 'reddedildi';
};

type MuezzinData = {
  role?: string;
  aktif?: boolean;
  onayBekliyor?: boolean;
  haftalikIzinGunu?: number;
};

/**
 * NOT ("1000 ifade tavanı" kök neden çözümü — bkz. firestore.rules
 * `isVekaletDevriBekliyorIsareti` yorumu): bu iş eskiden yalnızca
 * `haftaPlanlari` önbelleğini senkronize ediyordu — GERÇEK sahiplik
 * transferini (bildirimler.uid flip'i) `src/services/vekaletServisi.ts`'teki
 * `vekaletKabulEt` anlık olarak, security rules'ta ~45 terimlik bir
 * çapraz-belge doğrulamasıyla yapıyordu. O doğrulama emülatörün "istek
 * başına 1000 ifade" bütçesine (en basit yazımda bile) çarpıyordu; kök
 * neden kuralın DERLENMİŞ toplam karmaşıklığıydı, çalışma-zamanı sıralama/
 * get() paylaşımıyla düzelmiyordu (ölçüldü). Çözüm: istemci artık yalnızca
 * `vekalet_talepleri.durum='kabul_edildi'` + bildirimde dar bir
 * `vekaletDevriBekliyor:true` bayrağı yazıyor; GERÇEK transfer — talep
 * korelasyonu + atanabilirlik (role/aktif/onayBekliyor) + Cuma + sabit
 * haftalık izin-günü kontrolleri dahil, hepsi TAZE veriyle yeniden
 * doğrulanarak — burada, Admin SDK ile (kural bütçesi yok) gerçekleşiyor.
 *
 * İşlenen talep `bildirimUygulandi: true` ile işaretlenir (idempotent).
 * Transfer uygunluk kontrolünü GEÇEMEZSE (ör. alıcı bu ~10-15 dk'lık
 * pencerede arşivlendi/rolü değişti/izin gününe denk geldi), önceki sahip
 * korunur ve bir admin uyarısı oluşturulur — kabul anında senkron
 * doğrulanan bu durumun artık asenkron bir başarısızlık modu olması,
 * mimarinin kabul edilen yeni maliyeti (bkz. plan dosyası).
 */

/**
 * "Bu vaktin ezanı ZATEN GEÇTİ Mİ" — devam eden bir görevi geçmiş bir vakit
 * için devretmek anlamsız olduğundan, script kendi çalıştığı anda TAZE veriyle
 * ayrıca kontrol eder. Kabul ile bu script'in GERÇEK transferi uyguladığı an
 * arasında ~10-15 dakikalık bir gecikme var; bu pencerede ezan vakti geçmiş
 * olabilir (bkz. kod denetimi, kritik bulgu).
 *
 * NOT — bu, 1 SAATLİK mazeret/vekalet penceresi DEĞİLDİR ve olmamalıdır:
 * pencere açıkken (ör. ezandan 70 dk önce) yapılan meşru bir kabul, bu iş
 * 55 dk kala çalıştığında reddedilmemelidir. 1 saatlik pencere artık
 * firestore.rules'ta, `bildirimler.mazeretSonBasvuru` damgası ile SUNUCU
 * saatinde (`request.time`) uygulanıyor (bkz. `mazeretPenceresiAcik`) —
 * yani teklif/kabul yazımının kendisi zaten pencere dışında kabul edilmiyor.
 *
 * FAIL-CLOSED (kod denetimi — "ezan saati biçim asimetrisi"): ezan saati
 * okunamıyorsa (ay henüz önbelleğe alınmamış, değer bozuk: "9:05"/"abc")
 * önceden `false` — yani "ezan geçmedi, devri UYGULA" — dönülüyordu. Aynı veri
 * istemcide pencereyi doğru kapatıp cron'da fail-open olabildiğinden, bozuk
 * tek bir kayıt ezanı geçmiş bir görevin devredilmesine yol açabiliyordu.
 * Artık `null` sonuç "geçmiş say" (kapalı) olarak yorumlanır: transfer
 * reddedilir ve admin uyarısı üretilir — sessizce yanlış davranmak yerine
 * görünür şekilde durur. Saat dizgesinin ayrıştırılması artık tek noktadan
 * (scripts/lib/ezanVakitleri.ts → `normalizeVakitSaati`/`ezanAniUtc`)
 * yapılıyor; istemci de AYNI fonksiyonları kullanıyor.
 *
 * SABAH VAKTİ HARİÇ TUTULMAZ: 'sabah' da `vakitler` belgesindeki
 * `gunler[tarih]` haritasında sıradan bir alandır ve "ezanı geçti mi" sorusu
 * diğer vakitlerle birebir aynı yolla cevaplanır (premium hata analizi
 * düzeltmesi).
 */
async function ezanVaktiGecmisMi(okuyucu: EzanVakitOkuyucu, tarih: string, vakit: string): Promise<boolean> {
  const ezanSaati = await okuyucu.ezanAni(tarih, vakit);
  if (!ezanSaati) {
    console.warn(`[vekalet] ${tarih} ${vakit}: ezan saati okunamadı/bozuk — transfer FAIL-CLOSED reddediliyor.`);
    return true;
  }
  return Date.now() >= ezanSaati.getTime();
}

/**
 * Aynı tarih/vakit için ÇÖZÜLMEMİŞ bir admin uyarısı var mı — sorgunun
 * KENDİSİNİ döner (çalıştırmaz) ki çağıran onu bir transaction içinde
 * (`transaction.get`) okuyabilsin. Alarm yazımı ile talebi "işlendi" olarak
 * işaretleyen bayrak yazımı AYNI transaction'da yapılmalı: eskiden alarm,
 * transaction COMMIT EDİLDİKTEN SONRA ayrı bir `add()` ile yazılıyordu ve
 * süreç (GitHub Actions runner zaman aşımı/iptali) tam bu iki yazım arasında
 * ölürse, bir sonraki çalıştırmanın `bildirimUygulandi !== true` filtresi bu
 * talebi artık hiç görmediğinden alarm SONSUZA DEK kaybediliyordu — başarısız
 * devirden kimsenin haberi olmuyordu (bkz. kod denetimi). Aynı atomiklik
 * garantisi scripts/mazeretDevirleriniIsle.ts'te `alarmOlustur`'un tek
 * batch'iyle sağlanıyor.
 *
 * NOT: filtre `tip`e göre daraltılmadı — bugün `vakit` alanı NULL OLMAYAN her
 * admin uyarısı zaten `tip: 'zincirTukendi'` (mazeretDevirleriniIsle.ts,
 * mazeretServisi.ts, bu dosya); gün-geneli uyarılar (`planOlusturulamadi`,
 * yatsiSonuIslemleri.ts) `vakit: null` yazdığından bu sorguya hiç
 * takılmıyor. `tip` eklemek davranışı değiştirmeden yeni bir bileşik indeks
 * gerektirirdi.
 */
function cozulmemisAlarmSorgusu(tarih: string, vakit: string) {
  return db.collection('adminUyarilari').where('tarih', '==', tarih).where('vakit', '==', vakit).where('cozuldu', '==', false).limit(1);
}

// haftalikIzinGunu ile AYNI ölçekte (Pazartesi=1 ... Pazar=7) haftanın
// gününü döner — src/lib/dateUtils.ts `kisiGunIcinMusaitMi` ve
// firestore.rules `haftaGunuNumarasi` ile AYNI formül (bkz. o dosyalardaki
// yorumlar); üç yerde de senkron tutulmalı.
function haftaGunuNumarasi(tarihStr: string): number {
  const [y, m, d] = tarihStr.split('-').map(Number);
  const gunTarihi = new Date(y!, m! - 1, d!);
  return ((gunTarihi.getDay() + 6) % 7) + 1;
}

export async function processVekaletDevirleri(dryRun = false) {
  console.log(`Vekalet devirleri uzlaştırılıyor${dryRun ? ' (dry-run)' : ''}...`);

  // Tek okuyucu örneği: `settings/system` ve okunan `vakitler` ay belgeleri
  // çalıştırma boyunca önbelleklenir (bkz. scripts/lib/ezanVakitleri.ts).
  const okuyucu = new EzanVakitOkuyucu();

  // `tarih >= otuzGunOnce` sınırı: bu iş her 10 dakikada bir çalışıyor;
  // aşağıdaki iki sorgu öncesinde `durum`/`vekaletDevredildi` filtresi TEK
  // BAŞINA koleksiyondaki her kabul edilmiş/devredilmiş talebi — zaten
  // işlenmiş (bildirimUygulandi/vekaletPlanSenkronEdildi: true) olanlar
  // dahil — sınırsızca çekiyordu; koleksiyonlar yıllar içinde büyüdükçe her
  // çalıştırma neredeyse tamamı gereksiz okuma yapıyordu (bkz. Firebase/
  // GitHub veri akışı denetimi). 30 günlük pencere `temizleGunlukler.ts`'teki
  // RETENTION_DAYS ile aynı — bu işten daha eski bir görev tarihi zaten
  // geçmişte kalmıştır, yeniden uzlaştırılacak bir şey kalmaz.
  const otuzGunOnce = getTurkeyDateString(new Date(getTurkeyNow().getTime() - 30 * 24 * 60 * 60 * 1000));

  const talepSnap = await db.collection('vekalet_talepleri').where('durum', '==', 'kabul_edildi').where('tarih', '>=', otuzGunOnce).get();

  const islenecekler = talepSnap.docs.filter((docSnap) => {
    const data = docSnap.data() as VekaletTalebiData;
    return data.bildirimUygulandi !== true;
  });

  let transferUygulandi = 0;
  let transferReddedildi = 0;
  let planSenkronlandi = 0;

  for (const talepDoc of islenecekler) {
    const talep = talepDoc.data() as VekaletTalebiData;

    if (dryRun) {
      console.log(`${talep.tarih} ${talep.vakit}: vekalet transferi uygulanacak (${talep.gonderenUid} -> ${talep.aliciUid}).`);
      transferUygulandi++;
      continue;
    }

    const bildirimRef = db.collection('bildirimler').doc(talep.bildirimId);
    let sonuc: 'uygulandi' | 'reddedildi' | 'zatenUygulanmis' | 'atlandi' = 'atlandi';

    // TEK KAYNAK (kod denetimi — "script talep/bildirim alanlarını
    // karıştırıyor"): ezan-geçmiş kontrolü eskiden `talep.tarih`/`talep.vakit`
    // ile, Cuma ve izin-günü kontrolleri ise `bildirim.tarih` ile yapılıyordu.
    // OLUŞTURMA anında kurallar bu ikisini birbirine sabitliyor
    // (isValidVekaletCreate: `bildirim.tarih == incoming().tarih` vb.), ama
    // `vekalet_talepleri` update kuralının admin dalı hiçbir şema doğrulaması
    // yapmadığından sonradan desenkronize olabiliyorlardı — o durumda aynı
    // kararın üç bileşeni FARKLI görevler hakkında hesaplanırdı. Artık üçü de
    // MUTASYONA UĞRAYAN belgeden, yani `bildirim.*`'dan okunur; ayrıca
    // aşağıdaki `korelasyonTutarli` talep<->bildirim eşitliğini açıkça
    // doğrular ve bozuksa transferi reddeder. (Kök neden ayrıca
    // firestore.rules'ta `isAdminVekaletUpdate` ile kapatıldı.)
    //
    // Bildirim transaction DIŞINDA bir kez okunur (vakit verisi transaction'ın
    // kilitlediği varlıklardan bağımsız, harici bir kaynak); transaction içinde
    // TAZE bildirimin tarih/vakit'inin bu ön okumayla aynı kaldığı ayrıca
    // doğrulanır — arada değişmişse karar bayat veriyle verilmiş olurdu.
    const onOkumaSnap = await bildirimRef.get();
    const onOkumaVeri = onOkumaSnap.exists ? (onOkumaSnap.data() as BildirimData) : null;
    const kontrolTarih = onOkumaVeri?.tarih ?? talep.tarih;
    const kontrolVakit = onOkumaVeri?.vakit ?? talep.vakit;
    const ezanGecmisMi = await ezanVaktiGecmisMi(okuyucu, kontrolTarih, kontrolVakit);

    await db.runTransaction(async (transaction) => {
      const freshTalep = await transaction.get(talepDoc.ref);
      if (!freshTalep.exists) return;
      const freshTalepData = freshTalep.data() as VekaletTalebiData;
      if (freshTalepData.bildirimUygulandi === true) return;

      const freshBildirim = await transaction.get(bildirimRef);
      if (!freshBildirim.exists) {
        transaction.update(talepDoc.ref, { bildirimUygulandi: true, sonGuncelleme: Timestamp.now() });
        return;
      }
      const bildirim = freshBildirim.data() as BildirimData;

      // Devreye alma penceresi güvenliği: rules+istemci deploy'u ile bu
      // script'in (cron, git push ile ayrı ayrı devreye giriyor) devreye
      // alma zamanları TAM aynı anda olmayabilir. Eski istemci (henüz eski
      // kurallar canlıyken) transferi zaten DOĞRUDAN tamamlamış olabilir —
      // bu durumda `bildirim.uid` zaten `talep.aliciUid`'dir. Bunu "transfer
      // başarısız" sanıp yanlış admin uyarısı üretmek yerine "zaten
      // uygulanmış" say (idempotent no-op).
      if (bildirim.uid === talep.aliciUid) {
        transaction.update(talepDoc.ref, { bildirimUygulandi: true, talepSonuc: 'uygulandi', sonGuncelleme: Timestamp.now() });
        sonuc = 'zatenUygulanmis';
        return;
      }

      const aliciRef = db.collection('muezzins').doc(talep.aliciUid);
      const aliciSnap = await transaction.get(aliciRef);
      const alici = aliciSnap.exists ? (aliciSnap.data() as MuezzinData) : null;

      // Kabul anında CEL'de doğrulanan TÜM iş kuralları — burada taze
      // veriyle yeniden doğrulanıyor (istemcinin/eski talebin verisine
      // GÜVENİLMİYOR):
      const atanabilir = !!alici && alici.role === 'muezzin' && alici.aktif === true && alici.onayBekliyor !== true;
      const izinGunuCakisiyor = ['asil', 'yedek'].includes(bildirim.tip) && alici?.haftalikIzinGunu === haftaGunuNumarasi(bildirim.tarih);
      // Cuma kontrolü TAZE `bildirim.tarih`'ten hesaplanır — saklı `cumaMi`
      // bayrağı DEĞİL. Bu alan eksikse (backfill çalıştırılmamış eski
      // belgeler, ya da ileride bir yazım yolunun alanı unutması) eski
      // `bildirim.cumaMi !== true` kontrolü fail-open davranırdı: script
      // gerçek transferi UYGULARDI. firestore.rules aynı kök nedeni
      // `isSelfBildirimUpdate`'te `tarih`ten hesaplayarak çözmüştü — bu tek
      // satır o düzeltmeden nasibini almamıştı (premium hata analizi MV-O1,
      // bu script'in kendi "istemcinin verisine GÜVENİLMİYOR" ilkesiyle de
      // tutarsızdı, bkz. yukarıdaki izinGunuCakisiyor'un taze hesaplanması).

      // Talep ile bildirim arasındaki korelasyon: OLUŞTURMA anında
      // isValidVekaletCreate bunları birebir eşitliyor. Burada yeniden
      // doğrulanır — eşleşmiyorlarsa hangi görevin devredildiği belirsizdir ve
      // hiçbir kontrol güvenilir sonuç vermez, bu yüzden transfer reddedilir.
      // `kontrolTarih`/`kontrolVakit` karşılaştırması ayrıca ön okuma ile
      // transaction arasındaki değişimi yakalar (ezan kararı bayat olurdu).
      const korelasyonTutarli =
        bildirim.tarih === kontrolTarih &&
        bildirim.vakit === kontrolVakit &&
        bildirim.tarih === talep.tarih &&
        bildirim.vakit === talep.vakit &&
        bildirim.tip === talep.tip &&
        bildirim.haftaId === talep.haftaId;

      const uygun =
        korelasyonTutarli &&
        bildirim.durum === 'bekliyor' &&
        bildirim.uid === talep.gonderenUid &&
        haftaGunuNumarasi(bildirim.tarih) !== 5 &&
        atanabilir &&
        !izinGunuCakisiyor &&
        !ezanGecmisMi;

      if (!uygun) {
        // Alarm dedup okuması, bu daldaki İLK yazımdan ÖNCE yapılmalı
        // (Firestore transaction'larında tüm okumalar yazımlardan önce
        // gelir) — bu yola gelene kadar hiçbir yazım yapılmamış olur.
        // Alarm dedup'ı ve aşağıdaki alarm kaydı da AYNI tek kaynağı
        // (bildirimden türeyen kontrolTarih/kontrolVakit) kullanır — admin'in
        // gördüğü uyarı, kararın verildiği görevle aynı gün/vakti göstermeli.
        const alarmSnap = await transaction.get(cozulmemisAlarmSorgusu(kontrolTarih, kontrolVakit));

        // vekaletDevriBekliyor temizlenir — transfer kalıcı olarak
        // başarısız olduğundan bu bayrağın planServisi.ts `korumaliSlotMu`
        // içindeki koruması artık gerekmiyor; önceki sahip normal bir
        // 'bekliyor' slotu olarak kalmaya devam eder.
        transaction.update(bildirimRef, { vekaletDevriBekliyor: false, sonGuncelleme: Timestamp.now() });
        // `durum` da 'reddedildi'ye çekilir. Talep ID'si deterministik
        // (haftaId_tarih_vakit_tip_aliciUid) olduğundan, `durum`
        // 'kabul_edildi'de bırakılırsa gönderen o (görev, alıcı) çifti için
        // bir daha ASLA teklif gönderemiyordu: firestore.rules'un delete
        // kuralı yalnızca 'beklemede'/'reddedildi' durumundaki bir talebin
        // gönderen tarafından silinmesine izin verdiğinden belge
        // silinemiyor, aynı ID'ye setDoc ise create değil UPDATE sayılıp
        // isValidVekaletCreate/isRecipientVekaletStatusUpdate'in hiçbiriyle
        // eşleşmediği için reddediliyordu — yani talep kalıcı olarak
        // kilitleniyordu (bkz. mimari denetim O7'nin AYNISI, bu kez cron
        // kaynaklı red yolunda). Kuralları gevşetmeye gerek yok: mevcut
        // delete kuralı bu durumu zaten kapsıyor.
        transaction.update(talepDoc.ref, {
          bildirimUygulandi: true,
          talepSonuc: 'reddedildi',
          durum: 'reddedildi',
          sonGuncelleme: Timestamp.now(),
        });
        if (alarmSnap.empty) {
          transaction.set(db.collection('adminUyarilari').doc(), {
            tip: 'zincirTukendi',
            mesaj: `${talep.aliciIsim}, kabul ettiği vekalet devrini uygulanma anında artık devralamıyor (arşivlendi/rolü değişti/izin gününe denk geldi/ezan vakti geçti veya okunamadı/talep-bildirim eşleşmesi bozuldu). Admin müdahalesi gerekir.`,
            tarih: kontrolTarih,
            vakit: kontrolVakit,
            cozuldu: false,
            olusturmaTarihi: Timestamp.now(),
          });
        }
        sonuc = 'reddedildi';
        return;
      }

      transaction.update(bildirimRef, {
        uid: talep.aliciUid,
        vekaletDevredildi: true,
        vekaletDevriBekliyor: false,
        sonGuncelleme: Timestamp.now(),
      });
      transaction.update(talepDoc.ref, { bildirimUygulandi: true, talepSonuc: 'uygulandi', sonGuncelleme: Timestamp.now() });
      transaction.set(db.collection('audit_logs').doc(), {
        actionType: 'Görev Vekaleti Devri',
        targetName: `${talep.tarih} - ${toTurkishUpperCase(talep.vakit)}`,
        details: `${talep.gonderenIsim} görevi otonom vekalet ile ${talep.aliciIsim} hocaya devretti.`,
        userId: talep.aliciUid,
        userDisplayName: talep.aliciIsim,
        timestamp: Timestamp.now(),
      });
      sonuc = 'uygulandi';
    });

    // NOT: `as` ile açık tip ataması kasıtlı — `sonuc`, kapsayan bir async
    // closure içinde yeniden atanan bir `let` olduğundan TypeScript'in
    // kontrol akışı analizi burada değeri yanlışlıkla ilk atamaya
    // daraltıyor (bilinen bir TS closure-narrowing sınırlaması).
    const finalSonuc = sonuc as 'uygulandi' | 'reddedildi' | 'zatenUygulanmis' | 'atlandi';
    if (finalSonuc === 'uygulandi') {
      console.log(`${talep.tarih} ${talep.vakit}: vekalet transferi uygulandı (${talep.gonderenUid} -> ${talep.aliciUid}).`);
      transferUygulandi++;
    } else if (finalSonuc === 'zatenUygulanmis') {
      console.log(
        `${talep.tarih} ${talep.vakit}: transfer zaten uygulanmış (eski istemci/kural devreye alma penceresi) — yalnızca işaretlendi.`
      );
    } else if (finalSonuc === 'reddedildi') {
      console.log(
        `${talep.tarih} ${talep.vakit}: kabul edilmiş vekalet transferi artık uygulanamıyor (alıcı uygunluğu değişti) — talep reddedildi ve admin uyarısı AYNI transaction'da yazıldı.`
      );
      transferReddedildi++;
    }
  }

  // haftaPlanlari önbelleği: GERÇEKTEN transfer edilmiş (vekaletDevredildi:
  // true) ama henüz senkronize edilmemiş belgeler için — mevcut davranış,
  // artık transferin kendisi de burada uygulandığı için aynı döngüde
  // hemen ardından çalışabilir.
  const devirSnap = await db.collection('bildirimler').where('vekaletDevredildi', '==', true).where('tarih', '>=', otuzGunOnce).get();

  const senkronizeEdilecekler = devirSnap.docs.filter((docSnap) => {
    const data = docSnap.data() as BildirimData;
    return data.vekaletPlanSenkronEdildi !== true;
  });

  for (const devirDoc of senkronizeEdilecekler) {
    const devir = devirDoc.data() as BildirimData;

    console.log(`${devir.tarih} ${devir.vakit} (${devir.tip}): haftaPlanlari senkronize ediliyor (-> ${devir.uid}).`);
    planSenkronlandi++;

    if (dryRun) continue;

    await db.runTransaction(async (transaction) => {
      const freshDevir = await transaction.get(devirDoc.ref);
      if (!freshDevir.exists) return;
      const freshDevirData = freshDevir.data() as BildirimData;
      if (freshDevirData.vekaletPlanSenkronEdildi === true) return;

      const planRef = db.collection('haftaPlanlari').doc(devir.haftaId);
      const planSnap = await transaction.get(planRef);
      if (!planSnap.exists) {
        // Plan belgesi (henüz) yoksa senkronize edilecek bir şey yok — yine
        // de işaretle ki bu iş sonsuza kadar aynı belgeyi denemesin.
        transaction.update(devirDoc.ref, { vekaletPlanSenkronEdildi: true, sonGuncelleme: Timestamp.now() });
        return;
      }

      transaction.update(planRef, {
        [`gunler.${devir.tarih}.${devir.vakit}.${devir.tip}`]: freshDevirData.uid,
      });
      transaction.update(devirDoc.ref, {
        vekaletPlanSenkronEdildi: true,
        sonGuncelleme: Timestamp.now(),
      });
    });
  }

  const bayatTemizlendi = await bayatDevirBayraklariniTemizle(dryRun);

  console.log(
    `Tamamlandi. transferUygulandi=${transferUygulandi}, transferReddedildi=${transferReddedildi}, planSenkronlandi=${planSenkronlandi}, bayatBayrakTemizlendi=${bayatTemizlendi}`
  );
}

/**
 * BAYAT `vekaletDevriBekliyor` SÜPÜRMESİ.
 *
 * Kök neden (kod denetimi): bu bayrak yalnızca yukarıdaki uzlaştırma
 * döngüsünde temizlenir, o döngü de `vekalet_talepleri.tarih >= otuzGunOnce`
 * ile sınırlıdır. Bu iş 30 günden uzun süre çalışmazsa (GitHub Actions
 * zamanlanmış workflow'ları repo 60 gün hareketsiz kalınca kendiliğinden devre
 * dışı bırakır) pencerenin dışında kalan talebin bayrağı ARTIK HİÇBİR ZAMAN
 * temizlenmez; slot `src/lib/slotKorumasi.ts` `korumaliSlotMu` üzerinden hem
 * self-heal'e hem admin'in elle atamasına karşı sonsuza dek kilitli kalır.
 *
 * 30 GÜNLÜK SINIR NEDEN BU SORGUYA KONULMADI: o sınır, TERMİNAL durumdaki
 * (kabul_edildi / vekaletDevredildi) ve dolayısıyla yıllar içinde SINIRSIZ
 * biriken belgeleri her 10 dakikada bir yeniden okumamak için var (bkz.
 * yukarıdaki `otuzGunOnce` yorumu). `vekaletDevriBekliyor == true` ise GEÇİCİ
 * bir durumdur ve tam olarak bu süpürme sayesinde drenajı garanti edilir:
 * normal işleyişte sonuç kümesi 0-2 belgedir, birikmez. Yani sınırın koruduğu
 * maliyet burada zaten yok — sınırı bu sorguya taşımak ise düzeltilen hatanın
 * ta kendisini geri getirirdi.
 *
 * Zaman aşımı eşiği ve "damga okunamıyorsa dokunma" davranışı tek kaynaktan
 * gelir: src/lib/slotKorumasi.ts (istemci tarafı koruma kararı ile bu
 * süpürmenin AYNI eşiği kullanması gerekir, aksi halde istemci bir slotu
 * serbest sayarken cron bayrağı hâlâ canlı sanabilirdi).
 */
async function bayatDevirBayraklariniTemizle(dryRun: boolean): Promise<number> {
  const bekleyenSnap = await db.collection('bildirimler').where('vekaletDevriBekliyor', '==', true).get();

  const simdiMs = Date.now();
  let temizlenen = 0;

  for (const bekleyenDoc of bekleyenSnap.docs) {
    const veri = bekleyenDoc.data() as BildirimData & { sonGuncelleme?: { toMillis(): number } };
    const damgaMs = veri.sonGuncelleme?.toMillis?.();
    // Damga yoksa/okunamıyorsa DOKUNMA (fail-closed) — yaşını bilemediğimiz
    // bir bayrağı bayat sayıp gerçek bir devri iptal etmek, birkaç gün fazla
    // kilitli kalmaktan daha kötüdür.
    if (typeof damgaMs !== 'number' || !Number.isFinite(damgaMs)) continue;
    if (simdiMs - damgaMs <= VEKALET_DEVRI_BEKLEME_ASIMI_MS) continue;

    const yasSaat = Math.round((simdiMs - damgaMs) / (60 * 60 * 1000));
    console.log(`${veri.tarih} ${veri.vakit} (${veri.tip}): bayat vekaletDevriBekliyor bayragi (${yasSaat} saat) temizleniyor.`);
    temizlenen++;
    if (dryRun) continue;

    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(bekleyenDoc.ref);
      if (!fresh.exists) return;
      const freshVeri = fresh.data() as BildirimData & { sonGuncelleme?: { toMillis(): number } };
      if (freshVeri.vekaletDevriBekliyor !== true) return;
      const freshDamga = freshVeri.sonGuncelleme?.toMillis?.();
      // Belge bu arada tazelendiyse (ör. yeni bir kabul) dokunma.
      if (typeof freshDamga !== 'number' || Date.now() - freshDamga <= VEKALET_DEVRI_BEKLEME_ASIMI_MS) return;

      const alarmSnap = await transaction.get(cozulmemisAlarmSorgusu(freshVeri.tarih, freshVeri.vakit));

      transaction.update(bekleyenDoc.ref, { vekaletDevriBekliyor: false, sonGuncelleme: Timestamp.now() });
      if (alarmSnap.empty) {
        transaction.set(db.collection('adminUyarilari').doc(), {
          // `tip` kasitli olarak 'zincirTukendi' — `cozulmemisAlarmSorgusu`
          // dedup'i `tip`e gore daralmiyor (bkz. o fonksiyonun yorumu),
          // dolayisiyla `vakit` alani NULL OLMAYAN her uyarinin ayni tipte
          // kalmasi o yorumun dayandigi degismezi korur.
          tip: 'zincirTukendi',
          mesaj: `${freshVeri.tarih} ${toTurkishUpperCase(freshVeri.vakit)} görevinde bekleyen bir vekalet devri ${yasSaat} saattir uygulanamadı (uzlaştırma işi bu süre boyunca çalışmamış olabilir). Devir iptal edildi, görev önceki sahibinde kaldı ve slot yeniden düzenlenebilir. Devrin gerçekten yapılması gerekiyorsa yeniden teklif edilmelidir.`,
          tarih: freshVeri.tarih,
          vakit: freshVeri.vakit,
          cozuldu: false,
          olusturmaTarihi: Timestamp.now(),
        });
      }
    });
  }

  return temizlenen;
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const isDryRun = process.argv.includes('--dry-run');
  processVekaletDevirleri(isDryRun).catch((err) => {
    console.error('Vekalet devirleri islenemedi:', err);
    process.exit(1);
  });
}
