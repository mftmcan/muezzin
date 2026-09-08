import { Vakit } from '../types';
import { ezanAniUtc, isFriday, oncekiGunTarihi } from './dateUtils';

/**
 * Mazeret bildirimi/görev devri son başvuru süresi: ezan vaktine 1 saat
 * kalana kadar açık. Sabah vakti istisnası aşağıda `mazeretKapaliMi`'de
 * ayrıca ele alınır (bkz. dosya başı açıklaması).
 */
export const MAZERET_SON_BASVURU_DAKIKA = 60;

export interface MazeretZamanGirdisi {
  /** Görevin ait olduğu günün takvim tarihi (Cuma kontrolü için). */
  gunTarihi: Date;
  vakit: Vakit;
  /** Bugünün ilgili vaktinin ezan saati — sabah dışındaki vakitlerde kullanılır. */
  vakitSaati: Date | null;
  /** Bir önceki günün yatsı ezan saati — yalnızca vakit==='sabah' iken kullanılır. */
  oncekiGunYatsiSaati: Date | null;
}

export interface MazeretDurumu {
  kapali: boolean;
  sebep?: string;
}

function gecerliTarihMi(d: Date | null | undefined): d is Date {
  return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Bir görev için mazeret/görev devri penceresinin KAPANDIĞI anı, verilen
 * referans ezan anından hesaplar — kuralın TEK aritmetik kaynağı.
 *
 *  - sabah dışı vakitler: o vaktin ezanından 1 saat ÖNCE,
 *  - sabah: bir önceki günün yatsı ezanından 1 saat SONRA (kullanıcıdan gece
 *    yarısından sonra mazeret girmesi beklenemez).
 *
 * Referans an bilinmiyorsa/geçersizse `null` döner — çağıran taraf bunu
 * FAIL-CLOSED (pencere kapalı) yorumlamalıdır (bkz. `mazeretKapaliMi`).
 */
export function mazeretSonBasvuruAni(vakit: Vakit, referansEzanAni: Date | null): Date | null {
  if (!gecerliTarihMi(referansEzanAni)) return null;
  const isaret = vakit === 'sabah' ? 1 : -1;
  return new Date(referansEzanAni.getTime() + isaret * MAZERET_SON_BASVURU_DAKIKA * 60000);
}

/**
 * `mazeretSonBasvuruAni`'nin ham ("HH:MM" dizgesi) girdiyle çalışan,
 * ORTAM-BAĞIMSIZ (gerçek UTC anı üreten) sürümü.
 *
 * Bu, `bildirimler.mazeretSonBasvuru` alanının (firestore.rules'un
 * `request.time` ile karşılaştırdığı SUNUCU TARAFI son başvuru damgası)
 * TEK üretim noktasıdır — hem gece cron'u (scripts/haftalikPlanOlustur.ts,
 * scripts/mazeretPenceresiBackfill.ts) hem istemci self-healing
 * (src/services/planServisi.ts) bunu çağırır.
 *
 * Girdi dizgeleri `normalizeVakitSaati` ile doğrulanır: bozuk/eksik bir ezan
 * saati `null` üretir, `mazeretSonBasvuru` alanı hiç yazılmaz ve kural
 * tarafında pencere KAPALI sayılır (fail-closed) — eskiden bozuk bir saat
 * dizgesi sessizce "pencere açık" anlamına geliyordu (bkz.
 * `normalizeVakitSaati` yorumu).
 */
export function mazeretSonBasvuruHesapla(
  tarih: string,
  vakit: Vakit,
  /** `tarih` gününün `vakit` ezanı (ham "HH:MM"); sabah için kullanılmaz. */
  vakitSaatiHam: unknown,
  /** Bir önceki günün yatsı ezanı (ham "HH:MM"); yalnızca sabah için kullanılır. */
  oncekiGunYatsiHam: unknown
): Date | null {
  if (vakit === 'sabah') {
    const oncekiGun = oncekiGunTarihi(tarih);
    if (!oncekiGun) return null;
    return mazeretSonBasvuruAni(vakit, ezanAniUtc(oncekiGun, oncekiGunYatsiHam));
  }
  return mazeretSonBasvuruAni(vakit, ezanAniUtc(tarih, vakitSaatiHam));
}

/**
 * Bir görev için mazeret bildirimi/görev devri penceresinin açık olup
 * olmadığına karar verir (saf fonksiyon — Firestore'dan çekilen ezan
 * saatleri çağıran tarafça hazırlanır, bkz. src/services/mazeretServisi.ts).
 *
 * Kurallar:
 *  1. Cuma günleri (hangi vakit olursa olsun) mazeret tamamen kapalıdır —
 *     haftalık Cuma nöbetinin aksamaması için (bkz. aynı kısıtlamanın izin
 *     taleplerindeki karşılığı: src/components/VacationRequestCard.tsx).
 *  2. Sabah vakti hariç: pencere, o vaktin ezanına 1 saat kalana kadar açık.
 *  3. Sabah vakti: kullanıcıdan gece yarısından sonra (uykudayken) mazeret
 *     girmesi beklenemeyeceği için pencere, sabahın kendi saatine göre değil,
 *     bir önceki akşamki yatsı ezanından 1 saat sonrasına göre kapanır.
 *  4. Referans ezan saati bilinmiyorsa veya ayrıştırılamıyorsa pencere
 *     KAPALI sayılır (fail-closed) — bkz. aşağıdaki not.
 *
 * DİKKAT — bu fonksiyon artık yalnızca bir UX/erken-ret katmanıdır. 1 saatlik
 * pencerenin OTORİTER uygulaması sunucu tarafındadır: firestore.rules
 * `mazeretPenceresiAcik()` fonksiyonu, plan üretiminde önceden hesaplanıp
 * saklanan `bildirimler.mazeretSonBasvuru` damgasını Firestore'un KENDİ
 * güvenilir `request.time` değeriyle karşılaştırır. Buradaki `suAn` çağıran
 * tarafça `getTurkeyNow()` ile üretilir ve o da (RTDB zaman senkronu hiç
 * çalışmamışsa) CİHAZIN saatine düşebilir — bu yüzden istemci kontrolü
 * hiçbir zaman bir güvenlik sınırı değildir (bkz. CLAUDE.md "Mazeret / Cuma
 * kısıtlaması").
 */
export function mazeretKapaliMi(girdi: MazeretZamanGirdisi, suAn: Date): MazeretDurumu {
  if (!gecerliTarihMi(girdi.gunTarihi)) {
    return { kapali: true, sebep: 'Görev tarihi okunamadı; mazeret bildirimi/görev devri kullanılamaz.' };
  }
  if (isFriday(girdi.gunTarihi)) {
    return { kapali: true, sebep: 'Cuma günleri için mazeret bildirimi/görev devri kullanılamaz.' };
  }
  if (!gecerliTarihMi(suAn)) {
    return { kapali: true, sebep: 'Geçerli zaman okunamadı; mazeret bildirimi/görev devri kullanılamaz.' };
  }

  const sabahIstisnasi = girdi.vakit === 'sabah';
  const referansSaat = sabahIstisnasi ? girdi.oncekiGunYatsiSaati : girdi.vakitSaati;
  const sonBasvuru = mazeretSonBasvuruAni(girdi.vakit, referansSaat ?? null);

  // FAIL-CLOSED (kod denetimi — "ezan saati biçim asimetrisi"): referans saat
  // bilinmiyorsa ya da ayrıştırılamıyorsa (bozuk "9:05"/"abc" değeri, henüz
  // önbelleğe alınmamış ay) pencere KAPALI sayılır. Önceden burada
  // `{ kapali: false }` dönülüyordu — yani eksik/bozuk veri sessizce
  // kısıtlamayı tamamen kaldırıyordu. Aynı fail-open, `Invalid Date`
  // karşılaştırmalarının her zaman `false` dönmesi üzerinden de oluşuyordu;
  // `parseVakitToDate` artık bu durumda `null` döndürüyor ve buraya düşüyor.
  // Sunucu tarafı da AYNI yönde davranır: `mazeretSonBasvuru` damgası yoksa
  // firestore.rules yazımı reddeder.
  if (!sonBasvuru) {
    return {
      kapali: true,
      sebep: 'Bu görevin ezan vakti bilinmediği için mazeret bildirimi/görev devri penceresi doğrulanamıyor.',
    };
  }

  if (suAn >= sonBasvuru) {
    return {
      kapali: true,
      sebep: sabahIstisnasi
        ? 'Sabah vakti için mazeret bildirimi süresi (yatsıdan 1 saat sonrası) doldu.'
        : 'Ezan vaktine 1 saatten az kaldığı için görev devri/mazeret bildirimi kapalıdır.',
    };
  }

  return { kapali: false };
}
