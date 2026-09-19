import { describe, it, expect } from 'vitest';
import {
  toJsDate,
  getMinutesDiff,
  normalizeVakitSaati,
  ezanAniUtc,
  oncekiGunTarihi,
  parseVakitToDate,
  isFriday,
  kisiGunIcinMusaitMi,
  getHaftaIdFromDate,
  getOncekiHafta,
} from '../../src/lib/dateUtils';

/**
 * Bu dosyadaki tarihlerin gerçek gün karşılıkları (doğrulanmış — bkz.
 * mazeretKurallari.test.ts'teki aynı aralık):
 *   2026-08-03 Pazartesi   2026-08-06 Perşembe   2026-08-07 CUMA
 *   2026-08-09 Pazar       2025-12-29 Pazartesi  2025-12-30 Salı
 *   2026-01-04 Pazar (2025-12-29 haftasının son günü — yıl sınırını aşar)
 * Artık yıl kontrolü: 2026 artık yıl DEĞİL, 2028 artık yıl.
 *
 * GENEL NOT — "geçersiz girdi → null" testleri:
 * `normalizeVakitSaati`, `ezanAniUtc` ve `parseVakitToDate`'in `null` dönüşü
 * bir EKSİKLİK ya da "unutulmuş fallback" DEĞİLDİR; mazeret/vekalet
 * penceresinin FAIL-CLOSED sözleşmesinin temelidir (bkz. CLAUDE.md →
 * "Mazeret / Cuma kısıtlaması" ve `dateUtils.ts`'te `normalizeVakitSaati`
 * üstündeki kök-neden yorumu). Bozuk bir ezan saati dizgesi (`"abc"`,
 * `"25:00"`) daha önce `Invalid Date` üretiyordu; `suAn >= InvalidDate`
 * HER ZAMAN `false` olduğundan bu, pencerenin sessizce sonsuza kadar AÇIK
 * kalması (fail-open) anlamına geliyordu. Aşağıdaki `toBeNull()`
 * assertion'larını "kullanıcı dostu bir varsayılana" çevirmek o güvenlik
 * açığını geri getirir.
 */

describe('normalizeVakitSaati — FAIL-CLOSED biçim matrisi', () => {
  it('kabul edilen biçimleri sıfır dolgulu "HH:MM" olarak normalize eder', () => {
    const kabulEdilenler: [unknown, string][] = [
      ['09:05', '09:05'],
      // Tek haneli saat KABUL EDİLİR — cron'un eski katı /^\d{2}:\d{2}$/
      // regex'i bunu reddedip "ezan geçmedi" varsayıyordu (fail-open kök neden).
      ['9:05', '09:05'],
      ['0:00', '00:00'],
      ['00:00', '00:00'],
      ['23:59', '23:59'],
      // Saniyeli biçim kabul edilir, saniye atılır.
      ['12:00:00', '12:00'],
      ['21:18:45', '21:18'],
      // Baştaki/sondaki boşluk kırpılır.
      ['  09:05  ', '09:05'],
      ['\t21:18\n', '21:18'],
    ];

    for (const [girdi, beklenen] of kabulEdilenler) {
      expect(normalizeVakitSaati(girdi)).toBe(beklenen);
    }
  });

  it('ayrıştırılamayan/aralık dışı değerlerde null döner (fail-closed, bug DEĞİL)', () => {
    const reddedilenler: unknown[] = [
      '25:00', // saat > 23
      '24:00', // saat > 23 — "gün sonu" gösterimi de kabul edilmez
      '99:99',
      '12:60', // dakika > 59
      '', // boş dizge
      '   ', // yalnızca boşluk
      'abc',
      '12', // iki nokta yok
      '12:5', // dakika tek haneli — regex \d{2} istiyor
      ':45', // saat yok
      '123:45', // saat üç haneli — regex \d{1,2}
      '09:05:', // sondaki iki nokta artık karakter bırakır
      '09-05',
      null,
      undefined,
      123, // sayı — `typeof raw !== 'string'` dalı
      1245,
      {},
      [],
      new Date(),
    ];

    for (const bozuk of reddedilenler) {
      // Her biri için null = "bu değere GÜVENME, pencereyi KAPALI say".
      expect(normalizeVakitSaati(bozuk)).toBeNull();
    }
  });
});

describe('ezanAniUtc — sabit UTC+3 varsayımı', () => {
  it('Türkiye saatini (UTC+3) gerçek UTC anına çevirir', () => {
    // Formül: Date.UTC(y, m-1, d, hh-3, mm)
    expect(ezanAniUtc('2026-08-06', '12:45')!.toISOString()).toBe('2026-08-06T09:45:00.000Z');
    expect(ezanAniUtc('2026-08-06', '21:18')!.toISOString()).toBe('2026-08-06T18:18:00.000Z');
    // Tek haneli saat de aynı yoldan geçer (normalizeVakitSaati normalize eder).
    expect(ezanAniUtc('2026-08-06', '9:05')!.toISOString()).toBe('2026-08-06T06:05:00.000Z');
    // Saniyeli girdi: saniye atılır.
    expect(ezanAniUtc('2026-08-06', '12:45:59')!.toISOString()).toBe('2026-08-06T09:45:00.000Z');
  });

  it('TRT saati 03:00 altındayken UTC anı bir ÖNCEKİ güne taşar (hh-3 negatif)', () => {
    // `hh! - 3` negatif olur ve Date.UTC bunu otomatik olarak önceki güne
    // taşır. Bu, "Türkiye günü" ile "UTC günü"nün aynı olmadığı tek aralıktır
    // ve sunucu tarafı damga (mazeretSonBasvuru) bu kaymaya bağlıdır.
    expect(ezanAniUtc('2026-08-06', '00:00')!.toISOString()).toBe('2026-08-05T21:00:00.000Z');
    expect(ezanAniUtc('2026-08-06', '01:30')!.toISOString()).toBe('2026-08-05T22:30:00.000Z');
    expect(ezanAniUtc('2026-08-06', '02:59')!.toISOString()).toBe('2026-08-05T23:59:00.000Z');
    // Tam 03:00 sınırı aynı güne düşer.
    expect(ezanAniUtc('2026-08-06', '03:00')!.toISOString()).toBe('2026-08-06T00:00:00.000Z');
    // Ay sınırı + negatif saat birlikte.
    expect(ezanAniUtc('2026-08-01', '02:00')!.toISOString()).toBe('2026-07-31T23:00:00.000Z');
    // Yıl sınırı + negatif saat birlikte.
    expect(ezanAniUtc('2026-01-01', '01:00')!.toISOString()).toBe('2025-12-31T22:00:00.000Z');
  });

  it('bozuk tarih veya bozuk saatte null döner (fail-closed, bug DEĞİL)', () => {
    // Geçersiz SAAT — damga hesaplanamaz, çağıran pencereyi kapalı sayar.
    expect(ezanAniUtc('2026-08-06', 'abc')).toBeNull();
    expect(ezanAniUtc('2026-08-06', '25:00')).toBeNull();
    expect(ezanAniUtc('2026-08-06', '12:60')).toBeNull();
    expect(ezanAniUtc('2026-08-06', '')).toBeNull();
    expect(ezanAniUtc('2026-08-06', null)).toBeNull();
    expect(ezanAniUtc('2026-08-06', undefined)).toBeNull();

    // Geçersiz TARİH — parseTarihParcalari katı /^\d{4}-\d{2}-\d{2}$/ ister.
    expect(ezanAniUtc('abc', '12:45')).toBeNull();
    expect(ezanAniUtc('2026-8-6', '12:45')).toBeNull(); // sıfır dolgusuz
    expect(ezanAniUtc('2026-13-01', '12:45')).toBeNull(); // ay > 12
    expect(ezanAniUtc('2026-00-10', '12:45')).toBeNull(); // ay < 1
    expect(ezanAniUtc('2026-08-32', '12:45')).toBeNull(); // gün > 31
    expect(ezanAniUtc('2026-08-00', '12:45')).toBeNull(); // gün < 1
    expect(ezanAniUtc('', '12:45')).toBeNull();
    expect(ezanAniUtc(null, '12:45')).toBeNull();
    expect(ezanAniUtc(undefined, '12:45')).toBeNull();
    expect(ezanAniUtc(20260806, '12:45')).toBeNull(); // dizge değil
    expect(ezanAniUtc(new Date('2026-08-06'), '12:45')).toBeNull(); // Date de dizge değil
  });
});

describe('oncekiGunTarihi', () => {
  it('ay, artık yıl ve yıl sınırlarını doğru geçer', () => {
    const tablo: [string, string][] = [
      ['2026-08-06', '2026-08-05'], // sıradan gün
      ['2026-08-01', '2026-07-31'], // ay başı (31 günlük önceki ay)
      ['2026-03-01', '2026-02-28'], // 2026 artık yıl DEĞİL
      ['2028-03-01', '2028-02-29'], // 2028 artık yıl
      ['2026-01-01', '2025-12-31'], // yıl başı
      ['2026-05-01', '2026-04-30'], // 30 günlük önceki ay
    ];

    for (const [girdi, beklenen] of tablo) {
      expect(oncekiGunTarihi(girdi)).toBe(beklenen);
    }
  });

  it('bozuk biçimde null döner (fail-closed, bug DEĞİL)', () => {
    // Sabah vaktinin penceresi ÖNCEKİ günün yatsısına bağlıdır; bu fonksiyon
    // null dönerse çağıran o yatsıyı hiç okuyamaz ve pencereyi kapalı sayar.
    for (const bozuk of ['abc', '', '2026-13-01', '2026-00-01', '2026-08-32', '2026-8-6', '06.08.2026', null, undefined, 20260806, {}]) {
      expect(oncekiGunTarihi(bozuk)).toBeNull();
    }
  });
});

describe('parseVakitToDate', () => {
  it('geçerli girdide yerel (Türkiye çerçevesi) yıl/ay/gün/saat/dakika alanlarını kurar', () => {
    // NOT: `getTurkeyNow()` tabanlı olduğundan mutlak epoch değeri "gerçek an"
    // DEĞİLDİR (bkz. kaynak yorum: ezanAniUtc'ten kasıtlı farkı) — bu yüzden
    // yalnızca alanlar assert edilir.
    const d = parseVakitToDate('2026-08-06', '12:45');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7); // 0-tabanlı: Ağustos
    expect(d!.getDate()).toBe(6);
    expect(d!.getHours()).toBe(12);
    expect(d!.getMinutes()).toBe(45);
    expect(d!.getSeconds()).toBe(0);
    expect(d!.getMilliseconds()).toBe(0);
  });

  it('tek haneli ve saniyeli saat biçimlerini de normalize ederek kabul eder', () => {
    const tekHaneli = parseVakitToDate('2026-08-06', '9:05');
    expect(tekHaneli!.getHours()).toBe(9);
    expect(tekHaneli!.getMinutes()).toBe(5);

    const saniyeli = parseVakitToDate('2026-08-06', '21:18:30');
    expect(saniyeli!.getHours()).toBe(21);
    expect(saniyeli!.getMinutes()).toBe(18);
    expect(saniyeli!.getSeconds()).toBe(0); // saniye atılır
  });

  it('yıl/ay sınırındaki bir tarihi setFullYear taşması olmadan kurar', () => {
    // setFullYear(y, m, d) üç alanı TEK seferde yazar; bu yüzden "bugün ayın
    // 31'i" gibi bir durumda Şubat'a geçerken ara taşma oluşmaz.
    const d = parseVakitToDate('2028-02-29', '05:07');
    expect(d!.getFullYear()).toBe(2028);
    expect(d!.getMonth()).toBe(1);
    expect(d!.getDate()).toBe(29);
    expect(d!.getHours()).toBe(5);
    expect(d!.getMinutes()).toBe(7);
  });

  it('bozuk saat veya bozuk tarihte Invalid Date yerine null döner (fail-closed, bug DEĞİL)', () => {
    // Bu null'lar `if (!date)` kontrolünün gerçekten çalışmasını sağlar;
    // Invalid Date döndüğü dönemde o kontrol sessizce geçiyordu.
    expect(parseVakitToDate('2026-08-06', 'abc')).toBeNull();
    expect(parseVakitToDate('2026-08-06', '25:00')).toBeNull();
    expect(parseVakitToDate('2026-08-06', '12:60')).toBeNull();
    expect(parseVakitToDate('2026-08-06', '')).toBeNull();
    expect(parseVakitToDate('gecersiz', '12:45')).toBeNull();
    expect(parseVakitToDate('2026-8-6', '12:45')).toBeNull();
    expect(parseVakitToDate('2026-13-01', '12:45')).toBeNull();
    expect(parseVakitToDate('', '12:45')).toBeNull();
  });
});

describe('getMinutesDiff', () => {
  it('gece yarısını aşan farkı en kısa yöne sararak normalize eder', () => {
    // 00:02 - 23:58 ham hesapta -1436 çıkar; gerçek fark +4 dakikadır.
    expect(getMinutesDiff('23:58', '00:02')).toBe(4);
    // Ters yön: 23:58 - 00:02 ham hesapta +1436; gerçek fark -4.
    expect(getMinutesDiff('00:02', '23:58')).toBe(-4);
  });

  it('gün içi normal farkları işaretiyle birlikte döner', () => {
    expect(getMinutesDiff('12:00', '13:30')).toBe(90);
    expect(getMinutesDiff('13:30', '12:00')).toBe(-90);
    expect(getMinutesDiff('05:07', '05:08')).toBe(1);
    // Tek haneli saat burada normalize EDİLMEZ ama split/Number yine doğru çalışır.
    expect(getMinutesDiff('9:05', '10:05')).toBe(60);
  });

  it('eşit saatlerde 0 döner', () => {
    expect(getMinutesDiff('16:30', '16:30')).toBe(0);
    expect(getMinutesDiff('00:00', '00:00')).toBe(0);
  });

  it('±720 dakikalık sarma eşiğini tam sınırda doğru uygular', () => {
    // 720 sarılmaz (`diff > 720` katı büyüktür), 721 sarılır.
    expect(getMinutesDiff('00:00', '12:00')).toBe(720);
    expect(getMinutesDiff('00:00', '12:01')).toBe(-719);
    expect(getMinutesDiff('12:00', '00:00')).toBe(-720);
    expect(getMinutesDiff('12:01', '00:00')).toBe(719);
  });

  it('eksik girdide (undefined/boş) 0 döner', () => {
    // Burada 0 kasıtlı bir "fark yok" nötr değeridir — bu fonksiyon bir
    // güvenlik kapısı değil, gösterim yardımcısıdır.
    expect(getMinutesDiff(undefined, '12:00')).toBe(0);
    expect(getMinutesDiff('12:00', undefined)).toBe(0);
    expect(getMinutesDiff(undefined, undefined)).toBe(0);
    expect(getMinutesDiff('', '12:00')).toBe(0);
    expect(getMinutesDiff('12:00', '')).toBe(0);
  });
});

describe('getHaftaIdFromDate / getOncekiHafta', () => {
  it('Pazartesi verildiğinde kendi haftasının ID’sini döner', () => {
    expect(getHaftaIdFromDate('2026-08-03')).toBe('W2026-08-03'); // Pazartesi
  });

  it('hafta içi ve PAZAR verildiğinde AYNI haftanın (o haftanın Pazartesi’sinin) ID’sini döner', () => {
    // Off-by-one riski: Pazar, date-fns'in varsayılan (weekStartsOn: 0)
    // ayarında BİR SONRAKİ haftaya düşerdi. Burada weekStartsOn: 1 olduğundan
    // Pazar hâlâ aynı haftanın son günüdür.
    expect(getHaftaIdFromDate('2026-08-06')).toBe('W2026-08-03'); // Perşembe
    expect(getHaftaIdFromDate('2026-08-07')).toBe('W2026-08-03'); // Cuma
    expect(getHaftaIdFromDate('2026-08-09')).toBe('W2026-08-03'); // PAZAR
  });

  it('yıl sınırını aşan haftada önceki yılın Pazartesi’sini döner', () => {
    // 2025-12-30 Salı → haftanın başı 2025-12-29 Pazartesi.
    expect(getHaftaIdFromDate('2025-12-30')).toBe('W2025-12-29');
    // Aynı haftanın Pazar'ı ARTIK 2026'dadır ama hafta ID'si 2025 kalır.
    expect(getHaftaIdFromDate('2026-01-04')).toBe('W2025-12-29'); // Pazar
    // Bir sonraki Pazartesi yeni haftayı açar.
    expect(getHaftaIdFromDate('2026-01-05')).toBe('W2026-01-05');
  });

  it('getOncekiHafta, bir önceki haftanın ID’sini ve o haftanın PAZAR gününü döner', () => {
    const onceki = getOncekiHafta('W2026-08-03');
    expect(onceki.haftaId).toBe('W2026-07-27');
    expect(onceki.sonGun).toBe('2026-08-02');
    // sonGun gerçekten Pazar olmalı — SOS/dinlenme kuralı bu güne bakar.
    expect(new Date(2026, 7, 2).getDay()).toBe(0);
  });

  it('getOncekiHafta yıl sınırını doğru geçer ve sonGun her zaman Pazar’dır', () => {
    const onceki = getOncekiHafta('W2026-01-05');
    expect(onceki.haftaId).toBe('W2025-12-29');
    expect(onceki.sonGun).toBe('2026-01-04'); // önceki haftanın Pazar'ı yeni yıla düşer
    expect(new Date(2026, 0, 4).getDay()).toBe(0);
  });

  it('getOncekiHafta ile getHaftaIdFromDate birbirinin tersidir', () => {
    // Döngüsel tutarlılık: önceki haftanın son gününün hafta ID'si, önceki
    // haftanın ID'sinin kendisi olmalıdır.
    for (const haftaId of ['W2026-08-03', 'W2026-01-05', 'W2026-03-02']) {
      const onceki = getOncekiHafta(haftaId);
      expect(getHaftaIdFromDate(onceki.sonGun)).toBe(onceki.haftaId);
    }
  });
});

describe('kisiGunIcinMusaitMi', () => {
  const kisi = { id: 'muezzin-1' };

  it('onaylı izni olmayan ve sabit izin günü tutmayan kişi müsaittir', () => {
    expect(kisiGunIcinMusaitMi(kisi, '2026-08-06', [])).toBe(true);
  });

  it('onaylı izin aralığının İÇİNDE müsait değildir', () => {
    const izinler = [{ uid: 'muezzin-1', baslangic: '2026-08-05', bitis: '2026-08-08' }];
    expect(kisiGunIcinMusaitMi(kisi, '2026-08-06', izinler)).toBe(false);
  });

  it('izin aralığının her iki SINIRI da dahildir (>= / <=)', () => {
    const izinler = [{ uid: 'muezzin-1', baslangic: '2026-08-05', bitis: '2026-08-08' }];
    expect(kisiGunIcinMusaitMi(kisi, '2026-08-05', izinler)).toBe(false); // baslangic günü
    expect(kisiGunIcinMusaitMi(kisi, '2026-08-08', izinler)).toBe(false); // bitis günü
  });

  it('izin aralığının DIŞINDA müsaittir', () => {
    const izinler = [{ uid: 'muezzin-1', baslangic: '2026-08-05', bitis: '2026-08-08' }];
    expect(kisiGunIcinMusaitMi(kisi, '2026-08-04', izinler)).toBe(true); // bir gün önce
    expect(kisiGunIcinMusaitMi(kisi, '2026-08-09', izinler)).toBe(true); // bir gün sonra
  });

  it('BAŞKA bir kişinin izni bu kişiyi etkilemez (uid eşleşmesi)', () => {
    const izinler = [{ uid: 'muezzin-2', baslangic: '2026-08-05', bitis: '2026-08-08' }];
    expect(kisiGunIcinMusaitMi(kisi, '2026-08-06', izinler)).toBe(true);
  });

  it('sabit haftalık izin gününde müsait değildir (Pazartesi=1 … Pazar=7 ölçeği)', () => {
    // gunIndex = (getDay() + 6) % 7  →  Pazartesi=0 … Pazar=6
    // haftalikIzinGunu === gunIndex + 1  →  Pazartesi=1 … Pazar=7 (GUNLER_TR ile aynı).
    const tablo: [string, number][] = [
      ['2026-08-03', 1], // Pazartesi
      ['2026-08-06', 4], // Perşembe
      ['2026-08-07', 5], // Cuma
      ['2026-08-09', 7], // Pazar — (0 + 6) % 7 = 6 → 7
    ];

    for (const [tarih, izinGunu] of tablo) {
      expect(kisiGunIcinMusaitMi({ id: 'm', haftalikIzinGunu: izinGunu }, tarih, [])).toBe(false);
      // Komşu bir gün numarası eşleşmemeli (off-by-one koruması).
      expect(kisiGunIcinMusaitMi({ id: 'm', haftalikIzinGunu: (izinGunu % 7) + 1 }, tarih, [])).toBe(true);
    }
  });

  it('haftalikIzinGunu tanımsızsa sabit izin kuralı hiç tetiklenmez', () => {
    // `undefined === gunIndex + 1` asla doğru olamaz; 0 da (1..7 ölçeğinde
    // geçersiz) hiçbir güne denk gelmez.
    expect(kisiGunIcinMusaitMi({ id: 'm' }, '2026-08-06', [])).toBe(true);
    expect(kisiGunIcinMusaitMi({ id: 'm', haftalikIzinGunu: 0 }, '2026-08-06', [])).toBe(true);
  });

  it('hem onaylı izin hem sabit izin günü aynı anda geçerliyse yine müsait değildir', () => {
    const izinler = [{ uid: 'm', baslangic: '2026-08-06', bitis: '2026-08-06' }];
    expect(kisiGunIcinMusaitMi({ id: 'm', haftalikIzinGunu: 4 }, '2026-08-06', izinler)).toBe(false);
  });
});

describe('isFriday', () => {
  it('bilinen bir Cuma için true döner', () => {
    expect(isFriday(new Date(2026, 7, 7))).toBe(true); // 2026-08-07 Cuma
    expect(isFriday(new Date(2026, 7, 14))).toBe(true); // bir sonraki Cuma
  });

  it('Cuma olmayan günler için false döner', () => {
    expect(isFriday(new Date(2026, 7, 6))).toBe(false); // Perşembe
    expect(isFriday(new Date(2026, 7, 8))).toBe(false); // Cumartesi
    expect(isFriday(new Date(2026, 7, 3))).toBe(false); // Pazartesi
    expect(isFriday(new Date(2026, 7, 9))).toBe(false); // Pazar
  });

  it('günün saatinden bağımsızdır (gün sınırlarında da doğru)', () => {
    expect(isFriday(new Date(2026, 7, 7, 0, 0, 0))).toBe(true);
    expect(isFriday(new Date(2026, 7, 7, 23, 59, 59))).toBe(true);
  });
});

describe('toJsDate', () => {
  it('Firestore Timestamp benzeri bir objeyi toDate() ile çevirir', () => {
    const hedef = new Date('2026-08-06T09:45:00.000Z');
    expect(toJsDate({ toDate: () => hedef })).toBe(hedef);
  });

  it('{seconds} biçimindeki (serileştirilmiş Timestamp) objeyi saniyeden milisaniyeye çevirir', () => {
    expect(toJsDate({ seconds: 1754473500 })!.toISOString()).toBe(new Date(1754473500 * 1000).toISOString());
    // toDate varsa o önceliklidir — iki alan birlikte gelebilir.
    const hedef = new Date('2020-01-01T00:00:00.000Z');
    expect(toJsDate({ toDate: () => hedef, seconds: 1754473500 })).toBe(hedef);
  });

  it('ISO dizgesini, epoch sayısını ve Date örneğini çevirir', () => {
    expect(toJsDate('2026-08-06T09:45:00.000Z')!.toISOString()).toBe('2026-08-06T09:45:00.000Z');
    expect(toJsDate(1754473500000)!.getTime()).toBe(1754473500000);
    const d = new Date('2026-08-06T09:45:00.000Z');
    expect(toJsDate(d)!.getTime()).toBe(d.getTime());
  });

  it('ayrıştırılamayan veya boş değerlerde null döner (fail-closed, bug DEĞİL)', () => {
    // Çağıranların `if (!date)` kontrolü buna dayanır; Invalid Date dönseydi
    // o kontrol sessizce geçer ve sonraki her karşılaştırma false olurdu.
    for (const bozuk of [null, undefined, '', 'abc', 'gecersiz-tarih', NaN, false]) {
      expect(toJsDate(bozuk)).toBeNull();
    }
    // 0 (epoch başlangıcı) da falsy olduğu için null döner — bu bilinen ve
    // kabul edilmiş bir davranıştır: sıfır zaman damgası bu uygulamada
    // "değer yok" anlamına gelir.
    expect(toJsDate(0)).toBeNull();
  });
});
