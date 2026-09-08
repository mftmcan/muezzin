import {
  collection,
  query,
  where,
  limit,
  getDocs,
  getDoc,
  doc,
  runTransaction,
  writeBatch,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Muezzin, Vakit, VakitAtama } from '../types';
import {
  haftalikPlanUret,
  tekKisiliGunleriBul,
  kapsamsizGunleriBul,
  nobeteAtanabilirMi,
  oncekiHaftaninArdArdaYedekSayilariniHesapla,
  gunIzinliUidler,
  OnayliIzin,
  VAKITLER,
} from '../lib/planlamaCekirdegi';
import { korumaliSlotMu as korumaliSlotVerisiMi, guncelSlotBildirimleriniSec, SlotBildirimVerisi } from '../lib/slotKorumasi';
import { isFriday, getOncekiHafta, getTurkeyDateString, getTurkeyNow, oncekiGunTarihi, toTurkishUpperCase } from '../lib/dateUtils';
import { mazeretSonBasvuruHesapla } from '../lib/mazeretKurallari';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { telemetryService } from './telemetryService';

// İyimser eşzamanlılık denetiminin (aşağıda) attığı çakışma hatasını genel
// Firestore hatalarından ayırt etmek için — böylece dışarıdaki tek seferlik
// otomatik tekrar deneme yalnızca gerçek bir çakışmada devreye girer, başka
// bir hatayı (izin, ağ vb.) yutmaz (bkz. algoritma denetimi).
class PlanEszamanlilikCakismasi extends Error {}

/**
 * Çevrimdışıyken (ya da sunucuya erişilemeyip okumalar yerel önbelleğe
 * düşerken) tüm haftayı yeniden hesaplayıp yazmayı engelleyen koruma — bkz.
 * src/lib/planSelfHealing.ts'teki ayrıntılı gerekçe. Firestore yazımları
 * çevrimdışında iyimserdir: `writeBatch.commit()` yerel önbelleğe hemen
 * işlenir ve bağlantı gelince sunucudaki GERÇEK (gece cron'unun ürettiği)
 * çizelgeyi EZER. Bu yüzden hesaplama BAYAT/EKSİK önbellek verisiyle
 * yapılacaksa hiç başlanmaz. İstemci tarafındaki self-healing tetikleyicileri
 * bunu zaten `sunucudanDogrulandi` ile önlüyor; bu, aynı kuralın yazma
 * yolundaki (elle "PLANLARI GÜNCELLE", izin onayı, kadro değişikliği de dahil
 * TÜM çağıranları kapsayan) ikinci savunma katmanıdır.
 */
export class PlanCevrimdisiEngellendi extends Error {
  constructor() {
    super(
      'Bağlantı yok (veriler yerel önbellekten okunuyor). Plan üretimi, sunucudaki güncel çizelgeyi bozmamak için iptal edildi. Bağlantı sağlandığında tekrar deneyin.'
    );
    this.name = 'PlanCevrimdisiEngellendi';
  }
}

/**
 * Haftanın her (gün, vakit) slotu için `mazeretSonBasvuru` damgasını —
 * mazeret/vekalet penceresinin KAPANDIĞI gerçek anı — hesaplar.
 *
 * Bu damga, 1 saatlik pencerenin SUNUCU tarafı zorlayıcısıdır: firestore.rules
 * onu Firestore'un kendi `request.time` değeriyle karşılaştırır (bkz.
 * `mazeretPenceresiAcik`). Gece cron'u da AYNI formülü (`mazeretSonBasvuruHesapla`)
 * scripts/lib/ezanVakitleri.ts üzerinden kullanır — self-healing ile üretilen
 * bir hafta, cron'un ürettiğiyle aynı damgalara sahip olmalıdır.
 *
 * Ezan verisi okunamazsa (ay henüz önbellekte yok, çevrimdışı, bozuk değer)
 * ilgili slot için damga ÜRETİLMEZ; kural tarafı bunu "pencere kapalı" sayar
 * (fail-closed) ve scripts/mazeretPenceresiBackfill.ts 10 dakika içinde
 * tamamlar. Bu fonksiyon bu yüzden asla fırlatmaz — plan üretimi ezan verisine
 * bağımlı hale getirilmemelidir.
 */
async function haftaMazeretPencereleri(gunler: string[]): Promise<Record<string, Timestamp>> {
  const sonuc: Record<string, Timestamp> = {};
  try {
    const settingsSnap = await getDoc(doc(db, 'settings', 'system'));
    const ilceId = (settingsSnap.data()?.ilceId as string) || '9148';

    // Sabah vakti bir ÖNCEKİ günün yatsısına bağlı olduğundan (ay sınırını
    // geçebilir) o günlerin ayları da okunur.
    const gerekliGunler = new Set<string>();
    gunler.forEach((gun) => {
      gerekliGunler.add(gun);
      const onceki = oncekiGunTarihi(gun);
      if (onceki) gerekliGunler.add(onceki);
    });
    const aylar = new Set(Array.from(gerekliGunler).map((gun) => gun.slice(0, 7)));

    const gunVakitleri: Record<string, Record<string, unknown>> = {};
    await Promise.all(
      Array.from(aylar).map(async (ay) => {
        const snap = await getDoc(doc(db, 'vakitler', `${ilceId}_${ay}`));
        const harita = snap.exists() ? snap.data()?.gunler : null;
        if (harita && typeof harita === 'object') Object.assign(gunVakitleri, harita);
      })
    );

    for (const gun of gunler) {
      const onceki = oncekiGunTarihi(gun);
      for (const vakit of VAKITLER) {
        const an = mazeretSonBasvuruHesapla(gun, vakit, gunVakitleri[gun]?.[vakit], onceki ? gunVakitleri[onceki]?.yatsi : null);
        if (an) sonuc[`${gun}_${vakit}`] = Timestamp.fromDate(an);
      }
    }
  } catch (err) {
    console.warn('[plan] mazeret penceresi damgaları hesaplanamadı — bildirimler damgasız yazılacak (fail-closed; cron tamamlar).', err);
  }
  return sonuc;
}

type BildirimQueryDoc = QueryDocumentSnapshot<DocumentData>;
type BildirimDoc = BildirimQueryDoc | DocumentSnapshot<DocumentData>;
type GunPlanMap = Record<string, Record<Vakit, VakitAtama>>;

function haftaGunleri(haftaId: string) {
  const startStr = haftaId.substring(1);
  const [year, month, day] = startStr.split('-').map(Number);
  const pazartesi = new Date(year, month - 1, day);

  return Array.from({ length: 7 }, (_, index) => {
    const gun = new Date(pazartesi);
    gun.setDate(pazartesi.getDate() + index);
    const y = gun.getFullYear();
    const m = String(gun.getMonth() + 1).padStart(2, '0');
    const d = String(gun.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
}

// İyimser eşzamanlılık denetiminin (haftalikPlanOlusturTekSeferlik) tek
// başına haftaPlanlari.sonGuncelleme'yi karşılaştırması yeterli değildi —
// mazeretBildir/vekaletKabulEt kendi bildirimler yazımlarını YALNIZCA o
// belgede yapar, haftaPlanlari'na hiç dokunmaz (bunu yalnızca ayrı,
// asenkron bir uzlaştırma cron'u — mazeretDevirleriniIsle.ts/
// vekaletDevirleriniIsle.ts — daha sonra yapar). Bu yüzden eskiBildirimler
// okunduktan (T1) SONRA ama commit'ten (T2) ÖNCE bir müezzin mazeret
// bildirirse, haftaPlanlari.sonGuncelleme değişmediğinden freshness
// kontrolü çakışmayı hiç görmüyor, ve commit T1'deki BAYAT bildirim
// durumuna göre hesaplanmış bir plan yazıp mazeretin az önce güncellediği
// bildirim belgesini (delete+set ile) sessizce üzerine yazıyordu — mazeret
// reddi ve varsa yedek terfisi kayboluyordu (bkz. code-review, dördüncü
// denetim turu). Bu parmak izi haftaPlanlari.sonGuncelleme kontrolüne EK
// olarak bildirimler koleksiyonunun da T1-T2 arasında değişmediğini
// doğrular.
function bildirimlerParmakIzi(docs: BildirimQueryDoc[]): string {
  return docs
    .map((d) => `${d.id}:${(d.data().sonGuncelleme as Timestamp | undefined)?.toMillis() ?? 'null'}`)
    .sort()
    .join('|');
}

function bildirimleriSlotlaraAyir(docs: BildirimQueryDoc[]) {
  return docs.reduce(
    (acc, bildirimDoc) => {
      const data = bildirimDoc.data();
      const key = `${data.tarih}_${data.vakit}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(bildirimDoc);
      return acc;
    },
    {} as Record<string, BildirimQueryDoc[]>
  );
}

// scripts/vekaletDevirleriniIsle.ts'teki `alarmVarMi` ile AYNI dedup
// deseni. Gece cron'u (scripts/haftalikPlanOlustur.ts) bir haftanın
// uyarılarını yalnızca `haftaPlanlari/{haftaId}` belgesi İLK
// OLUŞTURULDUĞUNDA üretir (`if (planDoc.exists) continue`) — ama bu
// istemci tarafı "self-healing" fonksiyonu belge var olsa bile HER
// çağrıldığında (korunan slotlar hariç) yeniden hesaplar ve önceden bu
// kontrolsüzdü: aynı anlaşılmaz/yedeksiz gün, self-healing effect'leri
// (HaftalikCizelge.tsx, useBugunPlanDurumu.ts), her personel işleminde
// 3 haftalık yenileme döngüsü (`haftalikPlanlariYenile`) veya "PLANLARI
// GÜNCELLE" düğmesiyle günde onlarca kez tetiklenebildiğinden, aynı
// koşul için art arda neredeyse birebir aynı çözülmemiş uyarı kaydı
// birikiyordu (bkz. kod denetimi bulgusu, Hizmet Cetveli veri akışı
// analizi).
async function cozulmemisUyariVarMi(tip: string, tarih: string): Promise<boolean> {
  const snap = await getDocs(
    query(collection(db, 'adminUyarilari'), where('tip', '==', tip), where('tarih', '==', tarih), where('cozuldu', '==', false), limit(1))
  );
  return !snap.empty;
}

function slotVerileri(slotBildirimleri: BildirimDoc[]): SlotBildirimVerisi[] {
  return slotBildirimleri
    .map((bildirimDoc) => bildirimDoc.data() as SlotBildirimVerisi | undefined)
    .filter((data): data is SlotBildirimVerisi => !!data);
}

/**
 * Koruma kararının saf mantığı src/lib/slotKorumasi.ts'te — burada yalnızca
 * Firestore snapshot'ları düz veriye çevrilir. `izinliUidler` (o gün onaylı
 * izinde olanlar) verilirse, "kabul edilmiş/elle atanmış" türü koruma o kişi
 * için DÜŞER (bkz. slotKorumasi.ts `korumaliSlotMu` yorumu).
 */
function korumaliSlotMu(slotBildirimleri: BildirimDoc[], izinliUidler?: ReadonlySet<string>) {
  return korumaliSlotVerisiMi(slotVerileri(slotBildirimleri), izinliUidler);
}

export interface VakitAtamasiGuncelleParams {
  haftaId: string;
  tarih: string;
  vakit: Vakit;
  asilUid: string;
  yedekUid: string;
  /** Yalnızca denetim izi mesajında gösterilir. */
  asilAdi: string;
  yedekAdi: string;
}

/**
 * Tek bir gün/vakit hücresi için elle (admin) atama günceller. Vaktin
 * onaylanmış/reddedilmiş veya görev-çağrılı bir geçmişi varsa güvenli
 * güncelleme reddedilir — bu durumda 'protected' döner, hiçbir yazım yapılmaz.
 */
export async function vakitAtamasiniGuncelle(params: VakitAtamasiGuncelleParams): Promise<'updated' | 'protected'> {
  const { haftaId, tarih, vakit, asilUid, yedekUid, asilAdi, yedekAdi } = params;
  const path = `haftaPlanlari/${haftaId}`;
  try {
    // Bildirim ID'leri deterministiktir (haftaId_tarih_vakit_tip) — bu sayede
    // slotu bulmak için bir sorgu yerine iki bilinen belge referansı okunabilir.
    // Bu da "koru mu?" kontrolünü ve yazımı TEK bir transaction'a almayı
    // mümkün kılar (bkz. algoritma denetimi — önceki sürüm oku-sonra-yaz
    // arasında bir yarış koşuluna açıktı: eş zamanlı bir mazeret/vekalet kabulü
    // bu okumadan sonra gerçekleşirse sessizce ezilebiliyordu).
    const asilRef = doc(db, 'bildirimler', `${haftaId}_${tarih}_${vakit}_asil`);
    const yedekRef = doc(db, 'bildirimler', `${haftaId}_${tarih}_${vakit}_yedek`);
    const planRef = doc(db, 'haftaPlanlari', haftaId);

    const [gY, gM, gD] = tarih.split('-').map(Number);
    const cumaMi = isFriday(new Date(gY, gM - 1, gD));

    const sonuc = await runTransaction(db, async (transaction) => {
      const asilSnap = await transaction.get(asilRef);
      const yedekSnap = await transaction.get(yedekRef);

      if (korumaliSlotMu([asilSnap, yedekSnap])) {
        return 'protected' as const;
      }

      if (asilSnap.exists()) transaction.delete(asilRef);
      if (yedekSnap.exists()) transaction.delete(yedekRef);

      transaction.update(planRef, {
        [`gunler.${tarih}.${vakit}`]: { asil: asilUid, yedek: yedekUid },
      });

      if (asilUid && asilUid !== 'Sistem') {
        transaction.set(asilRef, {
          haftaId,
          tarih,
          vakit,
          uid: asilUid,
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          cumaMi,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
          manuelAtama: true,
        });
      }

      if (yedekUid && yedekUid !== 'Sistem') {
        transaction.set(yedekRef, {
          haftaId,
          tarih,
          vakit,
          uid: yedekUid,
          tip: 'yedek',
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          cumaMi,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
          manuelAtama: true,
        });
      }

      return 'updated' as const;
    });

    if (sonuc === 'updated') {
      await telemetryService.logAudit(
        'Manuel Görev Atama',
        tarih,
        `${toTurkishUpperCase(vakit)} vakti için asil: ${asilAdi}, yedek: ${yedekAdi} ataması yapıldı.`
      );
    }
    return sonuc;
  } catch (err) {
    throw handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function haftalikPlanOlustur(haftaId: string, denemeSayisi = 1): Promise<void> {
  try {
    await haftalikPlanOlusturTekSeferlik(haftaId);
  } catch (err) {
    if (err instanceof PlanEszamanlilikCakismasi) {
      if (denemeSayisi > 0) {
        return haftalikPlanOlustur(haftaId, denemeSayisi - 1);
      }
      // Tekrar denemeler tükendi — nadir ama kalıcı bir çakışma; telemetriye
      // düşür ki sık tekrarlarsa fark edilsin (bkz. algoritma denetimi).
      throw handleFirestoreError(err, OperationType.WRITE, 'haftaPlanlari');
    }
    throw err;
  }
}

async function haftalikPlanOlusturTekSeferlik(haftaId: string): Promise<void> {
  const path = 'haftaPlanlari';
  try {
    const muezzinSnapshot = await getDocs(query(collection(db, 'muezzins'), where('aktif', '==', true)));
    const muezzinler = muezzinSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as Muezzin & { id: string })
      .filter((m) => nobeteAtanabilirMi(m));

    if (muezzinler.length < 1) {
      throw new Error('Planlama için en az 1 aktif müezzin gereklidir.');
    }

    const gunler = haftaGunleri(haftaId);
    const haftaBitisStr = gunler[6];
    const startStr = haftaId.substring(1);
    // `bitis >= startStr` — bu haftadan ÖNCE bitmiş onaylı izinlerin bu
    // planlamayla hiçbir ilgisi yok (haftalikPlanUret zaten her gün için
    // `gun >= izin.baslangic && gun <= izin.bitis` kontrol ediyor), ama
    // filtresiz sorgu yıllar içinde birikmiş TÜM onaylı izin geçmişini her
    // çağrıda okuyordu (düşük öncelikli bulgu — Spark okuma kotası).
    // `durum+bitis` bileşik index'i zaten mevcut (bkz. useAktifIzinlerStore.ts
    // aynı desen).
    const izinSnapshot = await getDocs(query(collection(db, 'izinler'), where('durum', '==', 'onaylandi'), where('bitis', '>=', startStr)));
    const onayliIzinler = izinSnapshot.docs.map((doc) => doc.data() as OnayliIzin);

    const planRef = doc(db, 'haftaPlanlari', haftaId);
    const mevcutPlanSnap = await getDoc(planRef);
    // `getDoc` çevrimiçiyken sunucuya gider; yalnızca sunucuya ULAŞILAMADIĞINDA
    // yerel önbelleğe düşer. Yani `fromCache === true` burada fiilen "çevrimdışı /
    // sunucu erişilemez" demektir — bu durumda ne mevcut planın ne de yukarıda
    // okunan müezzin/izin verisinin güncel olduğu garanti edilebilir.
    if (mevcutPlanSnap.metadata.fromCache) {
      throw new PlanCevrimdisiEngellendi();
    }
    const mevcutGunler = mevcutPlanSnap.exists() ? ((mevcutPlanSnap.data().gunler || {}) as Partial<GunPlanMap>) : {};
    // İyimser eşzamanlılık denetimi (bkz. algoritma denetimi) — commit'ten hemen
    // önce plan belgesinin bu okumadan beri değişmediği doğrulanır.
    const okunanSonGuncelleme = mevcutPlanSnap.exists() ? (mevcutPlanSnap.data().sonGuncelleme?.toMillis() ?? null) : null;

    // Bir önceki haftanın son vaktinin (Pazar yatsı) ASİLİNİ oku — hafta
    // sınırında dinlenme kuralının (SOS) sıfırlanmasını önlemek için. SADECE
    // asil taşınır, yedek değil (bkz. src/lib/planlamaCekirdegi.ts PL-K1
    // yorumu) — yedek çoğu zaman fiilen görev yapmaz.
    const { haftaId: oncekiHaftaId, sonGun: oncekiSonGun } = getOncekiHafta(haftaId);
    const oncekiPlanSnap = await getDoc(doc(db, 'haftaPlanlari', oncekiHaftaId));
    const oncekiHaftaSonEkibi: string[] = [];
    if (oncekiPlanSnap.exists()) {
      const sonVakitAtama = (oncekiPlanSnap.data().gunler || {})[oncekiSonGun]?.yatsi;
      // 'SISTEM' (büyük harf) — eski verilerde kalmış, artık hiçbir yazım
      // yolunun üretmediği bir değer (bkz. HaftalikTakvim.tsx/GorevKarti.tsx'in
      // savunmacı kontrolleri) — burada da 'Sistem' ile aynı işlem görür,
      // aksi halde hayalet bir "uid" SOS listesine girip anlamsızca bloklardı
      // (düşük öncelikli bulgu).
      if (sonVakitAtama?.asil && sonVakitAtama.asil !== 'Sistem' && sonVakitAtama.asil !== 'SISTEM') {
        oncekiHaftaSonEkibi.push(sonVakitAtama.asil);
      }
    }
    // Art arda yedek kilidinin (bkz. tieBreaker.ts ARD_ARDA_YEDEK_ESIGI) hafta
    // sınırında sıfırlanmasını önlemek için — bkz. src/lib/planlamaCekirdegi.ts
    // PL-O2 yorumu.
    const oncekiArdArdaYedekSayilari = oncekiHaftaninArdArdaYedekSayilariniHesapla(
      oncekiPlanSnap.exists() ? (oncekiPlanSnap.data().gunler as GunPlanMap | undefined) : undefined,
      muezzinler.map((m) => m.id)
    );

    const eskiBildirimler = await getDocs(query(collection(db, 'bildirimler'), where('haftaId', '==', haftaId)));
    const bildirimlerBySlot = bildirimleriSlotlaraAyir(eskiBildirimler.docs);
    const okunanBildirimlerParmakIzi = bildirimlerParmakIzi(eskiBildirimler.docs);

    // Onaylı izin, "kabul edilmiş" (durum 'onaylandi') ya da elle atanmış bir
    // slotun korumasını EZER — aksi halde plan yayınlandıktan ve müezzin
    // "okudum" dedikten SONRA onaylanan bir izin, o kişiyi çizelgeden hiçbir
    // zaman çıkaramıyordu: koruma, haftalikPlanUret'in izin filtresine slotu
    // hiç ulaştırmıyordu (admin'in elindeki tek çare Firestore'u elle
    // düzenlemekti; vakitAtamasiniGuncelle de 'protected' dönüyordu).
    // useAdminIzinlerStore.izinGuncelle zaten onay sonrası ilgili haftaları bu
    // fonksiyonla yeniliyor — bu ezme sayesinde onay ANINDA çizelge düzelir.
    //
    // GEÇMİŞ günler kapsam dışı (`gun >= bugun`): geriye dönük onaylanan bir
    // izin, fiilen yapılmış ve kredilendirilmiş bir nöbeti yeniden yazmamalı
    // (bkz. K7 — tamamlanmış günlerin korunma gerekçesi).
    const bugunStr = getTurkeyDateString(getTurkeyNow());
    const izinliUidlerByGun = new Map<string, ReadonlySet<string>>();
    const gunIzinliSeti = (gun: string): ReadonlySet<string> => {
      let set = izinliUidlerByGun.get(gun);
      if (!set) {
        set = gun >= bugunStr ? new Set(gunIzinliUidler(onayliIzinler, gun)) : new Set<string>();
        izinliUidlerByGun.set(gun, set);
      }
      return set;
    };

    // Koruma kararı TEK bir yerden türetilir — aşağıdaki `korunmusAtama`
    // çözücüsü ile bildirim yazım döngüsü AYNI cevabı almak zorundadır, aksi
    // halde plan belgesi ile bildirim belgeleri birbirinden ayrışır.
    const slotKorumaliMi = (gun: string, vakit: Vakit) => korumaliSlotMu(bildirimlerBySlot[`${gun}_${vakit}`] || [], gunIzinliSeti(gun));

    // Korunan (zaten onaylanmış/reddedilmiş/görev-çağrılı) slotlar için taze
    // hesaplama atlanır — mevcut atama aynen korunur. Diğer tüm slotlar,
    // scripts/haftalikPlanOlustur.ts (gece cron'u) ile AYNI paylaşılan
    // çekirdekten (src/lib/planlamaCekirdegi.ts) taze hesaplanır.
    const gunPlan: GunPlanMap = haftalikPlanUret(
      gunler,
      muezzinler,
      onayliIzinler,
      (gun, vakit) => {
        const slotBildirimleri = bildirimlerBySlot[`${gun}_${vakit}`] || [];
        if (!slotKorumaliMi(gun, vakit)) return null;

        const mevcutAtama = mevcutGunler[gun]?.[vakit];
        // 'SISTEM' (büyük harf) — eski `haftaPlanlari` verilerinde kalmış olabilir
        // (bkz. HaftalikTakvim.tsx/GorevKarti.tsx'in savunmacı kontrolleri); bu
        // önbellekten okunurken 'Sistem'e normalize edilmezse aşağıdaki `|| 'Sistem'`
        // fallback'i tetiklenmez ('SISTEM' truthy olduğundan) ve bu değer canlı bir
        // bildirim belgesine `uid: 'SISTEM'` olarak sızabilirdi (düşük öncelikli bulgu).
        const mevcutAsil = mevcutAtama?.asil === 'SISTEM' ? undefined : mevcutAtama?.asil;
        const mevcutYedek = mevcutAtama?.yedek === 'SISTEM' ? undefined : mevcutAtama?.yedek;
        // Yedek terfisi YERİNDE yapıldığından (`..._yedek` belgesinin `tip`i
        // 'asil'e çevrilir, mazeret bildirenin `..._asil` belgesi denetim izi
        // olarak SİLİNMEZ) bir slotta `tip === 'asil'` olan İKİ belge
        // bulunabilir. Basit bir `find` burada belge-ID sırası nedeniyle her
        // zaman ESKİ belgeyi seçip terfiyi sessizce geri alıyordu — seçim
        // kuralı artık src/lib/slotKorumasi.ts'te (bkz. oradaki ayrıntılı
        // gerekçe).
        const { asil: asilBildirim, yedek: yedekBildirim } = guncelSlotBildirimleriniSec(slotVerileri(slotBildirimleri));
        // Öncelik `bildirimler`'de (canlı gerçek) — `mevcutAtama` bu fonksiyon
        // başında okunan `haftaPlanlari` ÖNBELLEĞİnden gelir ve bir vekalet/mazeret
        // devri sonrası uzlaştırma cron'u çalışana kadar bayat kalabilir. Önceki
        // sıralama (önbellek > bildirim) bayat değeri tercih edip devredilen bir
        // slotu sessizce eski sahibine geri döndürebiliyordu (bkz. mimari denetim
        // O8). `mevcutAtama` yalnızca hiçbir bildirim belgesi yoksa devreye girer.
        return {
          asil: asilBildirim?.uid || mevcutAsil || 'Sistem',
          yedek: yedekBildirim?.uid || mevcutYedek || 'Sistem',
          // Mazeret bildirilmiş (reddedildi) bir bildirim — bu kişi bu görevi
          // ARTIK YAPMAYACAK (mazeretDevirleriniIsle.ts bir yedeği terfi
          // ettirecek, ~10-15 dk gecikmeli); `uid` alanı reddedilme anında hâlâ
          // bu kişiyi gösterse de haftalık yük dengesine bu kişi olarak
          // sayılmamalı (premium hata analizi PL-O5).
          asilYukSayilmasin: asilBildirim?.durum === 'reddedildi',
          yedekYukSayilmasin: yedekBildirim?.durum === 'reddedildi',
        };
      },
      oncekiHaftaSonEkibi,
      oncekiArdArdaYedekSayilari
    );

    // Tek kişinin (yedeksiz) kaldığı günler için admin'e görünürlük bırak.
    const tekKisiliGunler = tekKisiliGunleriBul(gunPlan);
    // Hiç kimsenin müsait olmadığı (tamamen kapsamsız) günler — sistemdeki en
    // ağır durum, önceden hiçbir uyarı üretmiyordu (bkz. mimari denetim O3).
    const kapsamsizGunler = kapsamsizGunleriBul(gunPlan);

    // Mazeret penceresi damgaları eşzamanlılık kontrolünden ÖNCE hesaplanır —
    // bu okumalar (settings + en fazla 2 `vakitler` belgesi) kontrol ile commit
    // arasındaki pencereyi genişletmemeli (bkz. hemen aşağıdaki yorum).
    const mazeretPencereleri = await haftaMazeretPencereleri(gunler);

    // Commit'ten hemen önce eşzamanlılık kontrolü yapılıp SONRA batch kurulur —
    // aradaki pencere olabildiğince küçük tutulur. haftaPlanlari VE
    // bildirimler'in ikisi de yeniden kontrol edilir (bkz. bildirimlerParmakIzi
    // yorumu — yalnızca haftaPlanlari yeterli değildi).
    const tazeKontrolSnap = await getDoc(planRef);
    const tazeSonGuncelleme = tazeKontrolSnap.exists() ? (tazeKontrolSnap.data().sonGuncelleme?.toMillis() ?? null) : null;
    if (tazeSonGuncelleme !== okunanSonGuncelleme) {
      throw new PlanEszamanlilikCakismasi('Plan bu sırada başka bir işlem tarafından değiştirildi. Lütfen tekrar deneyin.');
    }
    const tazeBildirimlerSnap = await getDocs(query(collection(db, 'bildirimler'), where('haftaId', '==', haftaId)));
    if (bildirimlerParmakIzi(tazeBildirimlerSnap.docs) !== okunanBildirimlerParmakIzi) {
      throw new PlanEszamanlilikCakismasi(
        'Bu hafta için bildirimler bu sırada başka bir işlem tarafından değiştirildi. Lütfen tekrar deneyin.'
      );
    }

    // NOT ("1000 ifade tavanı" kök neden sınıfı — bkz. firestore.rules'taki
    // aynı isimli yorumlar, mazeret/vekalet devirlerinin Admin SDK'ya taşınma
    // gerekçesi): önceden TÜM haftanın (7 gün × 5 vakit × 2 = ~70 belge)
    // silme+yazma işlemi TEK bir writeBatch'te toplanıp commit ediliyordu.
    // `isValidBildirim` her belge için ayrı ayrı değerlendirildiğinden,
    // kümülatif ifade sayısı Firestore Rules emülatörünün "istek başına 1000
    // ifade" bütçesini AŞABİLİYORDU — yazım tüm belge sayısına ve hangi
    // slotların korumalı olduğuna bağlı olarak ARALIKLI (bazen olur bazen
    // olmaz) şekilde sessizce PERMISSION_DENIED ile başarısız oluyordu (bkz.
    // tests/e2e/haftalik-plan.spec.ts self-healing testindeki flaky
    // başarısızlık — kök neden burada izlendi). Çözüm: bildirimler yazımı
    // GÜN BAŞINA ayrı bir batch'e bölünüp sırayla commit edilir (günde en
    // fazla ~20 işlem — bütçenin çok altında), `haftaPlanlari` belgesi ise
    // TÜM günler başarıyla yazıldıktan SONRA, ayrı bir son batch'te commit
    // edilir. Bu, `useHaftaPlan`'ın `!plan` kontrolüne göre self-healing'i
    // tetikleyen tek kaynak `haftaPlanlari` belgesinin, ait olduğu
    // bildirimler TAMAMEN yazılmadan asla görünmemesini garanti eder —
    // kısmi bir başarısızlık durumunda (haftaPlanlari hâlâ yok/eski)
    // bir sonraki deneme (self-healing veya "PLANLARI GÜNCELLE") zaten
    // korumasız her slotu silip yeniden yazdığından doğal olarak
    // kendi kendini düzeltir (idempotent).
    for (const gun of gunler) {
      const gunBatch = writeBatch(db);
      const [gY, gM, gD] = gun.split('-').map(Number);
      const cumaMi = isFriday(new Date(gY, gM - 1, gD));

      for (const vakit of VAKITLER) {
        const slotKey = `${gun}_${vakit}`;
        const slotBildirimleri = bildirimlerBySlot[slotKey] || [];

        // Korunan slotlara dokunulmaz — atama zaten gunPlan'da korunmuş halde.
        // `korunmusAtama` çözücüsüyle AYNI `slotKorumaliMi` kullanılır: onaylı
        // izin ezmesi burada hesaba katılmazsa, izin nedeniyle yeniden hesaplanan
        // bir slotun bildirim belgeleri eski kişide kalır ve plan ile
        // bildirimler/push bildirimleri birbirine düşerdi.
        if (slotKorumaliMi(gun, vakit)) continue;

        slotBildirimleri.forEach((bildirimDoc) => {
          gunBatch.delete(bildirimDoc.ref);
        });

        const atama = gunPlan[gun][vakit];

        // 1 saatlik mazeret/vekalet penceresinin sunucu tarafı damgası (bkz.
        // `haftaMazeretPencereleri` ve firestore.rules `mazeretPenceresiAcik`).
        // Hesaplanamadıysa alan hiç yazılmaz — pencere kural tarafında kapalı
        // sayılır, cron veri geldiğinde damgayı tamamlar.
        const pencereDamgasi = mazeretPencereleri[slotKey];
        const pencereAlani = pencereDamgasi ? { mazeretSonBasvuru: pencereDamgasi } : {};

        // Bildirim ID'leri deterministiktir (haftaId_tarih_vakit_tip) — bkz.
        // firestore.rules `isBackupPromotionFromMazeret` ve scripts/haftalikPlanOlustur.ts.
        if (atama.asil !== 'Sistem') {
          gunBatch.set(doc(db, 'bildirimler', `${haftaId}_${gun}_${vakit}_asil`), {
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
          gunBatch.set(doc(db, 'bildirimler', `${haftaId}_${gun}_${vakit}_yedek`), {
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

      await gunBatch.commit();
    }

    const sonBatch = writeBatch(db);

    sonBatch.set(
      planRef,
      {
        haftaBaslangic: startStr,
        haftaBitis: haftaBitisStr,
        durum: 'yayinda',
        olusturmaTarihi: mevcutPlanSnap.exists() ? mevcutPlanSnap.data().olusturmaTarihi : Timestamp.now(),
        sonGuncelleme: Timestamp.now(),
        gunler: gunPlan,
      },
      { merge: true }
    );

    // Dedup önceden yalnızca listenin İLK gününe bakıyordu — o gün için zaten
    // çözülmemiş bir uyarı varsa, listeye SONRADAN eklenen farklı bir gün
    // (ör. önce Pazartesi yedeksiz kaldı, sonra ayrıca Perşembe de yedeksiz
    // kaldı) için hiç yeni uyarı açılmıyordu (premium hata analizi PL-O7). Her
    // gün kendi başına, tarihe özgü olarak kontrol edilir.
    if (kapsamsizGunler.length > 0) {
      for (const gun of kapsamsizGunler) {
        if (await cozulmemisUyariVarMi('planOlusturulamadi', gun)) continue;
        sonBatch.set(doc(collection(db, 'adminUyarilari')), {
          tip: 'planOlusturulamadi',
          mesaj: `${haftaId} haftasında ${gun} için HİÇ KİMSE müsait değil (herkes izinli/haftalık izin gününde). Acilen kadro/izin durumunu kontrol edin.`,
          tarih: gun,
          vakit: null,
          cozuldu: false,
          olusturmaTarihi: Timestamp.now(),
        });
      }
    }
    if (tekKisiliGunler.length > 0) {
      for (const gun of tekKisiliGunler) {
        if (await cozulmemisUyariVarMi('zincirTukendi', gun)) continue;
        sonBatch.set(doc(collection(db, 'adminUyarilari')), {
          tip: 'zincirTukendi',
          mesaj: `${haftaId} haftasında ${gun} yalnızca tek kişiyle (yedeksiz) planlandı. Kadro müsaitliğini kontrol edin.`,
          tarih: gun,
          vakit: null,
          cozuldu: false,
          olusturmaTarihi: Timestamp.now(),
        });
      }
    }

    await sonBatch.commit();
  } catch (err) {
    if (err instanceof PlanEszamanlilikCakismasi) throw err;
    // Çevrimdışı engeli gerçek bir Firestore hatası değil — kullanıcıya
    // gösterilecek mesajı hazır taşıyor ve telemetriye hata olarak düşmemeli.
    if (err instanceof PlanCevrimdisiEngellendi) throw err;
    throw handleFirestoreError(err, OperationType.WRITE, path);
  }
}
