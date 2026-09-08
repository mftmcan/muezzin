import { Muezzin, Vakit, VakitAtama } from '../types';
import { tieBreakerSirala, YEDEK_YUK_CARPANI } from '../utils/tieBreaker';
import { isFriday as isFridayTarih } from './dateUtils';

export const VAKITLER: Vakit[] = ['sabah', 'ogle', 'ikindi', 'aksam', 'yatsi'];
export const SISTEM_ATAMA: VakitAtama = { asil: 'Sistem', yedek: 'Sistem' };
// YEDEK_YUK_CARPANI artık src/utils/tieBreaker.ts'te tanımlı (kalıcı aylık
// yedek sayacı da aynı ağırlığı kullanmak zorunda — bkz. mimari denetim K6);
// burada geriye dönük uyumluluk için yeniden dışa aktarılıyor.
export { YEDEK_YUK_CARPANI };

export interface OnayliIzin {
  uid: string;
  baslangic: string;
  bitis: string;
}

/**
 * Bir personelin nöbete atanabilir olup olmadığını belirler — çağıran
 * taraflar (scripts/haftalikPlanOlustur.ts, src/services/planServisi.ts)
 * `haftalikPlanUret`'e geçirdikleri `muezzinler` listesini bununla filtreler.
 * `onayBekliyor: true` olan (admin henüz onaylamamış) bir davetli, kendi
 * profilini oluşturduğu andan itibaren `aktif: true` olsa da nöbete
 * atanmamalı — `AuthGuard` ona zaten bir bekleme ekranı gösterdiğinden,
 * atandığı vakit kimsenin göremeyeceği şekilde sessizce boş kalıyordu (bkz.
 * mimari denetim Y4).
 */
export function nobeteAtanabilirMi(m: Pick<Muezzin, 'role' | 'onayBekliyor'>): boolean {
  return m.role === 'muezzin' && m.onayBekliyor !== true;
}

export type MuezzinAday = Muezzin & { id: string };

/**
 * Belirli bir GÜN için onaylı izinde olan uid'ler. `haftalikPlanUret`'in
 * kendi izin filtresi de bunu kullanır — böylece "onaylı izindeki personel
 * asla atanmaz" kuralının tarih aralığı yorumu TEK bir yerde tanımlı kalır.
 * `src/services/planServisi.ts` bunu ayrıca, koruma altındaki bir slotun
 * onaylı izin nedeniyle ezilip ezilmeyeceğine karar vermek için çağırır
 * (bkz. src/lib/slotKorumasi.ts `korumaliSlotMu`).
 */
export function gunIzinliUidler(onayliIzinler: OnayliIzin[], gun: string): string[] {
  return onayliIzinler.filter((izin) => gun >= izin.baslangic && gun <= izin.bitis).map((izin) => izin.uid);
}

/**
 * Belirli bir gün+vakit için mevcut/korunmuş bir atama varsa döndürür (ör.
 * zaten onaylanmış/reddedilmiş ya da görev çağrısı yapılmış bir bildirim).
 * Böyle bir atama varsa taze hesaplama YAPILMAZ, doğrudan bu kullanılır —
 * ancak haftalık yük dengesine yine de dahil edilir.
 *
 * `asilYukSayilmasin`/`yedekYukSayilmasin`: mazeret bildirilmiş (durum
 * 'reddedildi') bir slot için `true` — bu kişi bu görevi ARTIK YAPMAYACAK
 * (scripts/mazeretDevirleriniIsle.ts bir yedeği terfi ettirecek, ~10-15 dk
 * gecikmeli), ama görüntüde slot hâlâ onun uid'ini taşıyor (bkz.
 * planServisi.ts `korunmusAtama` — bildirim belgesinin `uid` alanı reddedilme
 * anında DEĞİŞMEZ). Bu bayrak olmadan `gunlukKrediHesaplama.ts` bu kişiye
 * ASLA kalıcı kredi vermezken (reddedildi = kredi yok), buradaki haftalık
 * yük dengesi onu bu görevi YAPMIŞ gibi sayıyordu — kişi o hafta haksız
 * yere "yüklü" görünüp diğer görevlerden muaf tutuluyordu (premium hata
 * analizi PL-O5). Belirtilmezse (`undefined`) varsayılan `false`'tur —
 * geriye dönük uyumlu.
 */
export type KorunmusAtamaResolver = (
  gun: string,
  vakit: Vakit
) => (VakitAtama & { asilYukSayilmasin?: boolean; yedekYukSayilmasin?: boolean }) | null;

/**
 * Bir önceki haftanın gün planına bakarak, o haftanın bitişinde her kişinin
 * ART ARDA kaç gündür (yalnızca) yedek kaldığını hesaplar — `oncekiHaftaSonEkibi`
 * ile aynı gerekçeyle, ARD_ARDA_YEDEK_ESIGI kilidinin hafta sınırında
 * sıfırlanmasını önlemek için (premium hata analizi PL-O2; `oncekiHaftaSonEkibi`
 * SOS için taşınırken bu sayaç unutulmuştu). Son günden geriye doğru tarar,
 * bir kişi asil olduğu ya da hiç görev almadığı (izin/kadro dışı) bir güne
 * rastlayınca o kişi için sayım durur. Önceki hafta hiç üretilmemişse
 * (soğuk başlangıç) boş obje döner.
 */
export function oncekiHaftaninArdArdaYedekSayilariniHesapla(
  oncekiGunPlan: Record<string, Record<Vakit, VakitAtama>> | undefined,
  muezzinIds: string[]
): Record<string, number> {
  const sonuc: Record<string, number> = {};
  if (!oncekiGunPlan) return sonuc;

  const gunler = Object.keys(oncekiGunPlan).sort().reverse();
  const durdu = new Set<string>();

  for (const gun of gunler) {
    const vakitler = oncekiGunPlan[gun];
    if (!vakitler) continue;
    const gunAsilUidleri = new Set<string>();
    const gunYedekUidleri = new Set<string>();
    for (const vakit of VAKITLER) {
      const atama = vakitler[vakit];
      if (!atama) continue;
      if (atama.asil && atama.asil !== 'Sistem' && atama.asil !== 'SISTEM') gunAsilUidleri.add(atama.asil);
      if (atama.yedek && atama.yedek !== 'Sistem' && atama.yedek !== 'SISTEM') gunYedekUidleri.add(atama.yedek);
    }
    for (const uid of muezzinIds) {
      if (durdu.has(uid)) continue;
      const sadeceYedekKaldi = gunYedekUidleri.has(uid) && !gunAsilUidleri.has(uid);
      if (sadeceYedekKaldi) {
        sonuc[uid] = (sonuc[uid] || 0) + 1;
      } else {
        durdu.add(uid);
      }
    }
  }

  return sonuc;
}

/**
 * Bir haftalık nöbet planını (gün → vakit → {asil, yedek}) saf (yan etkisiz)
 * biçimde üretir. Bu, hem gece cron'unun (scripts/haftalikPlanOlustur.ts)
 * hem de istemci "self-healing" servisinin (src/services/planServisi.ts)
 * kullandığı TEK atama çekirdeğidir — atama kuralları (onaylı izindeki veya
 * sabit haftalık izin gününde olan personel ASLA atanmaz, haftalık yük
 * dengesi, Cuma ağırlığı, art arda dinlenme) yalnızca burada tanımlıdır.
 *
 * `korunmusAtama` verilirse (self-heal senaryosu), o gün/vakit için zaten
 * var olan bir atama varsa taze hesaplama atlanır; sonuç yine de haftalık
 * yük dengesine ve "önceki vakit" dinlenme kuralına dahil edilir.
 */
export function haftalikPlanUret(
  gunler: string[],
  muezzinler: MuezzinAday[],
  onayliIzinler: OnayliIzin[],
  korunmusAtama?: KorunmusAtamaResolver,
  /** Bir önceki haftanın son vaktinin (Pazar yatsı) ASİLİ — hafta sınırında
   * dinlenme kuralının sıfırlanmasını önlemek için (bkz. algoritma denetimi,
   * çağıran taraf src/lib/dateUtils.ts `getOncekiHafta` ile hesaplar).
   * SADECE asil taşınır — bkz. aşağıdaki SOS yorumu (premium hata analizi
   * PL-K1): dünkü yedek bugün SOS'tan muaf, dolayısıyla bu listeye girmez. */
  oncekiHaftaSonEkibi: string[] = [],
  /** `oncekiHaftaninArdArdaYedekSayilariniHesapla`'nın çıktısı — verilmezse
   * (varsayılan boş obje) art arda yedek sayacı hafta başında 0'dan başlar
   * (eski, PL-O2 öncesi davranışla geriye dönük uyumlu). */
  oncekiArdArdaYedekSayilari: Record<string, number> = {}
): Record<string, Record<Vakit, VakitAtama>> {
  const buHaftakiYukler: Record<string, number> = {};
  const aylikCumaSayilari: Record<string, number> = {};
  // Art arda kaç gündür yedek kalındığı — bkz. src/utils/tieBreaker.ts
  // ARD_ARDA_YEDEK_ESIGI, mimari denetim K6.
  const ardArdaYedekSayilari: Record<string, number> = {};
  muezzinler.forEach((m) => {
    buHaftakiYukler[m.id] = 0;
    aylikCumaSayilari[m.id] = m.aylikCumaSayisi || 0;
    ardArdaYedekSayilari[m.id] = oncekiArdArdaYedekSayilari[m.id] || 0;
  });

  const gunPlan: Record<string, Record<Vakit, VakitAtama>> = {};
  let oncekiVakitUidler: string[] = oncekiHaftaSonEkibi;

  for (const gun of gunler) {
    gunPlan[gun] = {} as Record<Vakit, VakitAtama>;

    const [gY, gM, gD] = gun.split('-').map(Number);
    const gunTarihi = new Date(gY, gM - 1, gD);
    // Pazartesi=1 ... Pazar=7 (haftalikIzinGunu ile aynı ölçek)
    const gunIndex = (gunTarihi.getDay() + 6) % 7;
    const isFriday = isFridayTarih(gunTarihi);

    const bugunIzinliUidler = gunIzinliUidler(onayliIzinler, gun);

    const musaitMuezzinler = muezzinler.filter((m) => {
      const isOnIzin = bugunIzinliUidler.includes(m.id);
      const isFixedDayOff = m.haftalikIzinGunu === gunIndex + 1;
      return !isOnIzin && !isFixedDayOff;
    });

    let gunlukTazeAtama: VakitAtama = SISTEM_ATAMA;
    if (musaitMuezzinler.length >= 2) {
      const sirali = tieBreakerSirala(
        musaitMuezzinler,
        buHaftakiYukler,
        oncekiVakitUidler,
        isFriday,
        aylikCumaSayilari,
        ardArdaYedekSayilari
      );
      gunlukTazeAtama = { asil: sirali[0].id, yedek: sirali[1].id };
    } else if (musaitMuezzinler.length === 1) {
      gunlukTazeAtama = { asil: musaitMuezzinler[0].id, yedek: 'Sistem' };
    }

    // O gün en az bir vakitte asil/yedek olanların kümesi — normal (taze)
    // üretimde gün boyu tek bir ekip kullanıldığından bu iki küme pratikte
    // ya boş ya da tek bir kişilik olur; yalnızca korunmusAtama bir günün
    // vakitlerini birbirinden farklı atadığında (self-healing kenar durumu)
    // gerçek fark yaratır (bkz. aşağıdaki ardArdaYedekSayilari güncellemesi).
    const gunAsilUidleri = new Set<string>();
    const gunYedekUidleri = new Set<string>();

    // "Cuma vakitleri 1.5x ağırlıklı" (bkz. CLAUDE.md) kuralının TEK uygulama
    // noktası. Önceden bu ağırlık yalnızca tieBreaker.ts'in tier 2
    // karşılaştırmasında (o haftanın TOPLAMINI Cuma günü GEÇİCİ olarak 1.5 ile
    // çarpan ayrı bir mekanizma) yaşıyordu; haftalık yük BİRİKİMİNİN kendisinde
    // hiç uygulanmıyordu — yani Cuma yapan biri hafta içi kalan günlerdeki
    // karşılaştırmalarda normal bir gün yapmış gibi görünüyordu (premium hata
    // analizi PL-O3). Ağırlık buraya taşındıktan sonra tier 2'deki geçici
    // çarpan hem gereksiz hem zararlı kaldığı için KALDIRILDI (bkz.
    // tieBreaker.ts tier 2 yorumu): tieBreakerSirala gün başında, o günün yükü
    // daha eklenmeden çağrıldığından oradaki çarpan Cuma'nın kendi yükünü
    // değil, Pazartesi–Perşembe birikimini ölçekliyordu. Artık 1.5 TEK bir
    // yerde, TEK bir kez uygulanır: Cuma gününün kendi katkısı birikime 1.5
    // katıyla girer ve sonraki tüm karşılaştırmalara olduğu gibi taşınır.
    const cumaCarpani = isFriday ? 1.5 : 1;

    for (const vakit of VAKITLER) {
      const korunmus = korunmusAtama?.(gun, vakit);
      // Temiz {asil, yedek} nesnesi kurulur — `korunmus` içindeki
      // asilYukSayilmasin/yedekYukSayilmasin gibi ek alanlar yalnızca BU
      // döngü içinde kullanılan bir sinyaldir, gunPlan'a (dolayısıyla
      // Firestore'a) asla sızmamalı.
      const atama: VakitAtama = korunmus ? { asil: korunmus.asil, yedek: korunmus.yedek } : gunlukTazeAtama;
      gunPlan[gun][vakit] = atama;

      // Mazeret bildirilmiş (reddedildi) bir slot — bu kişi bu görevi
      // ARTIK YAPMAYACAK, dolayısıyla ne haftalık yüke ne SOS/art-arda-yedek
      // defterine dahil edilir (bkz. yukarıdaki KorunmusAtamaResolver
      // yorumu, PL-O5).
      if (atama.asil && atama.asil !== 'Sistem' && atama.asil !== 'SISTEM' && !korunmus?.asilYukSayilmasin) {
        buHaftakiYukler[atama.asil] = (buHaftakiYukler[atama.asil] || 0) + 1 * cumaCarpani;
        gunAsilUidleri.add(atama.asil);
      }
      if (atama.yedek && atama.yedek !== 'Sistem' && atama.yedek !== 'SISTEM' && !korunmus?.yedekYukSayilmasin) {
        buHaftakiYukler[atama.yedek] = (buHaftakiYukler[atama.yedek] || 0) + YEDEK_YUK_CARPANI * cumaCarpani;
        gunYedekUidleri.add(atama.yedek);
      }
    }

    // SOS (bir sonraki gün için dinlenme bloğu): SADECE bugünün ASİLİ bloklanır
    // — yedek çoğu zaman fiilen görev yapmaz, bu yüzden bugün yedek kalan biri
    // yarın asil olabilir (premium hata analizi PL-K1 düzeltmesi). Önceden
    // asil+yedek birlikte bloklanıyordu; 3 kişilik kadroda bu, geriye tek
    // (bloklanmamış) aday bırakıp Cuma/aylık adalet kademelerinin asil
    // seçimine hiç karışamamasına yol açıyordu — çünkü sirali[0] için tek
    // aday kalıyordu. Yalnızca asili bloklamak, tek sayılı kadrolarda bile en
    // az 2 adayı tier 1.5+ için serbest bırakır.
    oncekiVakitUidler = Array.from(gunAsilUidleri);

    // Art arda yedek sayacını güncelle: o gün EN AZ BİR vakitte yedek olup
    // HİÇBİR vakitte asil olmayan kişi için artır, diğerleri (o gün asil
    // olan ya da hiç görev almayan) için sıfırla (bkz. ARD_ARDA_YEDEK_ESIGI).
    // Önceden yalnızca günün SON vaktine (yatsı) bakılıyordu — korunmusAtama
    // bir günün vakitlerini birbirinden farklı atadığında (self-healing
    // kenar durumu) bu, kişinin o günkü gerçek yükünü yanlış yansıtabiliyordu
    // (bkz. görsel/mantık denetimi).
    muezzinler.forEach((m) => {
      const sadeceYedekKaldi = gunYedekUidleri.has(m.id) && !gunAsilUidleri.has(m.id);
      ardArdaYedekSayilari[m.id] = sadeceYedekKaldi ? (ardArdaYedekSayilari[m.id] || 0) + 1 : 0;
    });
  }

  return gunPlan;
}

/**
 * Üretilmiş bir gün planında, en az bir vakti tek kişiyle (yedeksiz) kalan
 * günleri tespit eder — çağıran taraf bunun için admin'e "bu hafta X günü
 * yedeksiz kalıyor" uyarısı üretebilir (bkz. algoritma denetimi). Hiç
 * kimsenin müsait olmadığı (asil de Sistem) vakitler bu koşula dahil
 * edilmez — o durum ayrı bir fonksiyonla (`kapsamsizGunleriBul`, aşağıda)
 * tespit edilir; eskiden bu durumun cron'daki toplam kadro uyarısıyla
 * kapsandığı iddia ediliyordu ama o uyarı yalnızca kadro mevcuduna
 * bakıyordu, belirli bir günün tamamen boş kalmasına değil (bkz. mimari
 * denetim O3).
 *
 * DİKKAT: koşul `.some(...)` — günün TÜM vakitleri değil, TEK BİR vakti bile
 * (ör. yatsı) asil-var/yedek-yok ise gün listeye girer. Önceden `.every(...)`
 * kullanıyordu, yani günün kalan vakitleri (sabah/öğle/ikindi/akşam) gerçek
 * yedeklerle kapsansa bile TEK bir vakit (operasyonel olarak en kritik olan
 * yatsı dahil) yedeksiz kalırsa hiç uyarı üretilmiyordu (bkz. kod denetimi
 * bulgusu — client self-heal yolunda, planServisi.ts `korunmusAtama`, tam
 * olarak bu şekilde tek bir vakit 'Sistem' yedekle kalabiliyor).
 *
 * Ayrıca iki "karışık gün" durumu daha yakalanır (premium hata analizi
 * PL-O4 — önceden ikisi de sessiz kalıyordu):
 * - asil 'Sistem' ama yedek dolu (bozuk/tutarsız `korunmusAtama` çıktısı —
 *   asil bildirimi silinmiş, yedek bildirimi onaylı kalmış olabilir).
 * - Günün BİR vakti tamamen boş (asil de 'Sistem') iken AYNI günün başka
 *   bir vakti gerçek kişilerle dolu — `kapsamsizGunleriBul` bunu yakalamaz
 *   çünkü o yalnızca günün TÜM vakitleri boşsa tetiklenir.
 */
export function tekKisiliGunleriBul(gunPlan: Record<string, Record<Vakit, VakitAtama>>): string[] {
  return Object.entries(gunPlan)
    .filter(([, vakitler]) => {
      const gunuDoluBirVaktiVarMi = VAKITLER.some((v) => vakitler[v].asil !== 'Sistem');
      return VAKITLER.some((v) => {
        const { asil, yedek } = vakitler[v];
        const eksikYedek = asil !== 'Sistem' && yedek === 'Sistem';
        const eksikAsil = asil === 'Sistem' && yedek !== 'Sistem';
        const kismenBosVakit = asil === 'Sistem' && yedek === 'Sistem' && gunuDoluBirVaktiVarMi;
        return eksikYedek || eksikAsil || kismenBosVakit;
      });
    })
    .map(([gun]) => gun)
    .sort();
}

/**
 * Üretilmiş bir gün planında, HİÇ KİMSENİN müsait olmadığı (tüm vakitlerde
 * asil de 'Sistem' kalan) günleri tespit eder — sistemdeki en ağır durum.
 * `tekKisiliGunleriBul`'un eski docstring'i bu durumun cron'daki toplam kadro
 * uyarısıyla zaten kapsandığını iddia ediyordu, ama o uyarı yalnızca
 * `muezzinler.length < 2` (kadro mevcudu) koşuluna bakıyor — belirli bir
 * günde herkesin izinli/haftalık izin gününde olmasıyla ilgisi yok. Sonuç:
 * kadro yeterliyken bile herkesin izinli olduğu bir gün hiçbir uyarı
 * üretmeden sessizce geçiyordu (bkz. mimari denetim O3).
 */
export function kapsamsizGunleriBul(gunPlan: Record<string, Record<Vakit, VakitAtama>>): string[] {
  return Object.entries(gunPlan)
    .filter(([, vakitler]) => VAKITLER.every((v) => vakitler[v].asil === 'Sistem'))
    .map(([gun]) => gun)
    .sort();
}
