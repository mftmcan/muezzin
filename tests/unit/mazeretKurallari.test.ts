import { describe, it, expect } from 'vitest';
import {
  mazeretKapaliMi,
  mazeretSonBasvuruAni,
  mazeretSonBasvuruHesapla,
  MAZERET_SON_BASVURU_DAKIKA,
} from '../../src/lib/mazeretKurallari';
import { ezanAniUtc, normalizeVakitSaati, oncekiGunTarihi, parseVakitToDate } from '../../src/lib/dateUtils';

// 2026-08-06 Perşembe (Cuma değil), 2026-08-07 Cuma — bkz. planlamaCekirdegi.test.ts'teki
// aynı doğrulanmış tarih aralığı.
const PERSEMBE = new Date(2026, 7, 6);
const CUMA = new Date(2026, 7, 7);

describe('mazeretKapaliMi', () => {
  it('Cuma günü, vakit veya zamandan bağımsız olarak her zaman kapalıdır', () => {
    const ogleVakti = new Date(2026, 7, 7, 13, 0);
    const cokErken = new Date(2026, 7, 7, 6, 0); // ogle'den çok saatler önce

    const durum = mazeretKapaliMi({ gunTarihi: CUMA, vakit: 'ogle', vakitSaati: ogleVakti, oncekiGunYatsiSaati: null }, cokErken);

    expect(durum.kapali).toBe(true);
    expect(durum.sebep).toMatch(/Cuma/);
  });

  it('Cuma dışı bir vakitte, ezana 1 saatten fazla varsa açıktır', () => {
    const ikindiVakti = new Date(2026, 7, 6, 16, 0);
    const suAn = new Date(2026, 7, 6, 14, 30); // 1.5 saat önce

    const durum = mazeretKapaliMi({ gunTarihi: PERSEMBE, vakit: 'ikindi', vakitSaati: ikindiVakti, oncekiGunYatsiSaati: null }, suAn);

    expect(durum.kapali).toBe(false);
  });

  it('Cuma dışı bir vakitte, ezana tam 1 saat kala kapanır', () => {
    const ikindiVakti = new Date(2026, 7, 6, 16, 0);
    const tamBirSaatKala = new Date(ikindiVakti.getTime() - MAZERET_SON_BASVURU_DAKIKA * 60000);

    const acikDurum = mazeretKapaliMi(
      { gunTarihi: PERSEMBE, vakit: 'ikindi', vakitSaati: ikindiVakti, oncekiGunYatsiSaati: null },
      new Date(tamBirSaatKala.getTime() - 1000)
    );
    const kapaliDurum = mazeretKapaliMi(
      { gunTarihi: PERSEMBE, vakit: 'ikindi', vakitSaati: ikindiVakti, oncekiGunYatsiSaati: null },
      tamBirSaatKala
    );

    expect(acikDurum.kapali).toBe(false);
    expect(kapaliDurum.kapali).toBe(true);
  });

  it('sabah vaktinde pencere, sabahın kendi saatine değil önceki günün yatsısına göre kapanır', () => {
    // Sabah 04:30, önceki gün yatsı 21:00. Normal kuralda (sabah-1sa) pencere
    // 03:30'da kapanırdı; sabah istisnasında ise yatsı+1sa = 22:00'de kapanır.
    const oncekiGunYatsi = new Date(2026, 7, 5, 21, 0); // Çarşamba yatsı (Perşembe sabahının öncesi)

    const yatsidan45DakikaSonra = new Date(2026, 7, 5, 21, 45); // hâlâ açık olmalı (1 saat dolmadı)
    const yatsidan75DakikaSonra = new Date(2026, 7, 5, 22, 15); // artık kapalı olmalı

    const acikDurum = mazeretKapaliMi(
      { gunTarihi: PERSEMBE, vakit: 'sabah', vakitSaati: null, oncekiGunYatsiSaati: oncekiGunYatsi },
      yatsidan45DakikaSonra
    );
    const kapaliDurum = mazeretKapaliMi(
      { gunTarihi: PERSEMBE, vakit: 'sabah', vakitSaati: null, oncekiGunYatsiSaati: oncekiGunYatsi },
      yatsidan75DakikaSonra
    );

    expect(acikDurum.kapali).toBe(false);
    expect(kapaliDurum.kapali).toBe(true);
    expect(kapaliDurum.sebep).toMatch(/[Ss]abah/);
  });

  // FAIL-CLOSED regresyonları (kod denetimi — "ezan saati biçim asimetrisi").
  // Bu davranış eskiden TERSİYDİ: veri yoksa/bozuksa kısıtlama hiç
  // uygulanmıyordu, yani eksik bir kayıt sessizce pencereyi sonsuza kadar
  // açık bırakıyordu.
  it('referans saat bilinmiyorsa (veri yoksa) FAIL-CLOSED davranır', () => {
    const durum = mazeretKapaliMi(
      { gunTarihi: PERSEMBE, vakit: 'yatsi', vakitSaati: null, oncekiGunYatsiSaati: null },
      new Date(2026, 7, 6, 23, 0)
    );

    expect(durum.kapali).toBe(true);
    expect(durum.sebep).toMatch(/ezan vakti bilinmediği/);
  });

  it('sabah vaktinde önceki günün yatsısı bilinmiyorsa FAIL-CLOSED davranır', () => {
    const durum = mazeretKapaliMi(
      { gunTarihi: PERSEMBE, vakit: 'sabah', vakitSaati: new Date(2026, 7, 6, 4, 30), oncekiGunYatsiSaati: null },
      new Date(2026, 7, 5, 18, 0)
    );

    expect(durum.kapali).toBe(true);
  });

  it('referans saat Invalid Date ise FAIL-CLOSED davranır (sessiz false karşılaştırması regresyonu)', () => {
    // `suAn >= InvalidDate` HER ZAMAN false'tur — eski kod bunu "pencere hâlâ
    // açık" olarak yorumluyordu.
    const durum = mazeretKapaliMi(
      { gunTarihi: PERSEMBE, vakit: 'ikindi', vakitSaati: new Date('gecersiz'), oncekiGunYatsiSaati: null },
      new Date(2026, 7, 6, 15, 59)
    );

    expect(durum.kapali).toBe(true);
  });
});

describe('normalizeVakitSaati', () => {
  it('geçerli biçimleri sıfır dolgulu HH:MM olarak normalize eder', () => {
    expect(normalizeVakitSaati('09:05')).toBe('09:05');
    // Cron'un eski KATI /^\d{2}:\d{2}$/ regex'i bunu reddedip null'a
    // düşürüyordu (→ "ezan geçmedi" fail-open); istemci ise hiç
    // doğrulamıyordu. Artık iki taraf da aynı normalize sonucunu görür.
    expect(normalizeVakitSaati('9:05')).toBe('09:05');
    expect(normalizeVakitSaati('  21:18  ')).toBe('21:18');
    expect(normalizeVakitSaati('21:18:00')).toBe('21:18');
  });

  it('ayrıştırılamayan/aralık dışı değerleri reddeder', () => {
    for (const bozuk of ['abc', '', '25:00', '12:60', '12', '12:5', ':45', null, undefined, 1245, {}]) {
      expect(normalizeVakitSaati(bozuk)).toBeNull();
    }
  });
});

describe('parseVakitToDate — bozuk girdi', () => {
  it('bozuk saat/tarih dizgesinde Invalid Date yerine null döner', () => {
    expect(parseVakitToDate('2026-08-06', 'abc')).toBeNull();
    expect(parseVakitToDate('2026-08-06', '25:00')).toBeNull();
    expect(parseVakitToDate('gecersiz', '12:45')).toBeNull();
    expect(parseVakitToDate('2026-8-6', '12:45')).toBeNull();
  });

  it('tek haneli saatli bir değeri de doğru ayrıştırır', () => {
    const d = parseVakitToDate('2026-08-06', '9:05');
    expect(d).not.toBeNull();
    expect(d!.getHours()).toBe(9);
    expect(d!.getMinutes()).toBe(5);
  });
});

describe('ezanAniUtc / oncekiGunTarihi', () => {
  it('Türkiye saatini (sabit UTC+3) gerçek UTC anına çevirir', () => {
    // 2026-08-06 12:45 TRT = 09:45 UTC — çalıştığı makinenin saat diliminden
    // bağımsız olmalı (GitHub Actions runner'ı UTC, geliştirici makinesi TRT).
    expect(ezanAniUtc('2026-08-06', '12:45')!.toISOString()).toBe('2026-08-06T09:45:00.000Z');
    expect(ezanAniUtc('2026-08-06', '9:05')!.toISOString()).toBe('2026-08-06T06:05:00.000Z');
    // Gece yarısı öncesi TRT saati bir ÖNCEKİ UTC gününe düşer.
    expect(ezanAniUtc('2026-08-06', '01:30')!.toISOString()).toBe('2026-08-05T22:30:00.000Z');
  });

  it('bozuk girdide null döner', () => {
    expect(ezanAniUtc('2026-08-06', 'abc')).toBeNull();
    expect(ezanAniUtc('abc', '12:45')).toBeNull();
  });

  it('ay ve yıl sınırlarını doğru geçer', () => {
    expect(oncekiGunTarihi('2026-08-01')).toBe('2026-07-31');
    expect(oncekiGunTarihi('2026-01-01')).toBe('2025-12-31');
    expect(oncekiGunTarihi('2028-03-01')).toBe('2028-02-29');
    expect(oncekiGunTarihi('bozuk')).toBeNull();
  });
});

describe('mazeretSonBasvuruHesapla (sunucu tarafı damga)', () => {
  it('sabah dışı vakitlerde ezandan 1 saat öncesini üretir', () => {
    const an = mazeretSonBasvuruHesapla('2026-08-06', 'ikindi', '16:30', null);
    expect(an!.toISOString()).toBe('2026-08-06T12:30:00.000Z'); // 15:30 TRT
  });

  it('sabah vaktinde önceki günün yatsısından 1 saat sonrasını üretir', () => {
    const an = mazeretSonBasvuruHesapla('2026-08-06', 'sabah', null, '21:18');
    // 2026-08-05 21:18 TRT + 1sa = 2026-08-05 22:18 TRT = 19:18 UTC
    expect(an!.toISOString()).toBe('2026-08-05T19:18:00.000Z');
  });

  it('ay sınırında sabah vakti için önceki AYIN yatsısını kullanır', () => {
    const an = mazeretSonBasvuruHesapla('2026-08-01', 'sabah', null, '21:30');
    expect(an!.toISOString()).toBe('2026-07-31T19:30:00.000Z');
  });

  it('bozuk/eksik ezan saatinde null döner (damga yazılmaz → kural fail-closed)', () => {
    expect(mazeretSonBasvuruHesapla('2026-08-06', 'ikindi', 'abc', null)).toBeNull();
    expect(mazeretSonBasvuruHesapla('2026-08-06', 'ikindi', undefined, null)).toBeNull();
    expect(mazeretSonBasvuruHesapla('2026-08-06', 'sabah', null, '99:99')).toBeNull();
    expect(mazeretSonBasvuruAni('ogle', null)).toBeNull();
    expect(mazeretSonBasvuruAni('ogle', new Date('gecersiz'))).toBeNull();
  });
});
