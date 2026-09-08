import { describe, it, expect } from 'vitest';
import { addDays } from 'date-fns';
import {
  parseHijriDate,
  isRamazanBayram,
  isKurbanBayram,
  isArefe,
  isTesrikGunu,
  isSonTesrikGunu,
  isRamazanBayramArife,
  isKurbanBayramArife,
  isRamazanArifeOncesi,
  isKurbanArifeOncesi,
  isRamazan,
  isRamazanBaslangiciOncesi,
  isRegaibKandili,
  isMiracKandili,
  isBeratKandili,
  isKadirGecesi,
  isMevlidKandili,
  isHicriYilbasi,
  isAsureGunu,
} from '../../src/lib/islamicCalendar';

/**
 * Bu testlerin çoğu, sabit bir "bilinen" miladi tarihi doğru hicri karşılığıyla
 * bağımsız olarak eşleştirmek yerine (Ramazan'ın 29 mu 30 gün sürdüğü yıldan
 * yıla değiştiğinden bu kırılgan olurdu — bkz. kod denetimi), fonksiyonlar
 * ARASINDAKİ ilişkileri (arife her zaman bayramdan 1 gün önce, teşrik her
 * zaman 9-13 Zilhicce vb.) doğrular — asıl hatalı-değişiklik riski (off-by-one)
 * tam olarak bu ilişkilerde çıkar. getHijriDate/parseHijriDate'in kendisi
 * (dateUtils.ts) zaten canlı uygulamanın tüm dini özellik setinin temeli
 * olduğundan burada ayrıca test edilmiyor; bu dosya yalnızca islamicCalendar.ts'in
 * KENDİ mantığını (getHijriDate üzerine kurulu tespit kuralları) hedefler.
 */

describe('parseHijriDate', () => {
  it('metni { day, month, year, monthName } olarak ayrıştırır', () => {
    const parsed = parseHijriDate(new Date(2025, 0, 1));
    expect(parsed.day).toBeGreaterThanOrEqual(1);
    expect(parsed.day).toBeLessThanOrEqual(30);
    expect(parsed.month).toBeGreaterThanOrEqual(1);
    expect(parsed.month).toBeLessThanOrEqual(12);
    expect(parsed.monthName).toBeTruthy();
  });
});

describe('Bayram / Arefe ilişkileri', () => {
  it('Kurban Bayramı Arefesi tam olarak isArefe ile örtüşür (9 Zilhicce)', () => {
    // isKurbanBayramArife kendi tanımı gereği isArefe'nin bir takma adı —
    // ikisinin farklı davranmaya başlaması (birinin değiştirilip diğerinin
    // unutulması) burada yakalanır.
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      expect(isKurbanBayramArife(d)).toBe(isArefe(d));
    }
  });

  it('Kurban Bayramı Arefesi her zaman Kurban Bayramından tam 1 gün öncedir', () => {
    let found = 0;
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      if (isKurbanBayram(d)) {
        found++;
        expect(isKurbanBayramArife(addDays(d, -1))).toBe(true);
        expect(isKurbanBayram(addDays(d, -1))).toBe(false);
      }
    }
    expect(found).toBeGreaterThanOrEqual(2); // 800 gün ≈ 2.2 hicri yıl
  });

  it('Ramazan Bayramı Arefesi her zaman Ramazan Bayramından tam 1 gün öncedir', () => {
    let found = 0;
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      if (isRamazanBayram(d)) {
        found++;
        expect(isRamazanBayramArife(addDays(d, -1))).toBe(true);
      }
    }
    expect(found).toBeGreaterThanOrEqual(2);
  });

  it('"...ArifeOncesi" fonksiyonları her zaman kendi Arife tespitinden tam 1 gün öncedir', () => {
    let kurbanFound = 0;
    let ramazanFound = 0;
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      if (isArefe(d)) {
        kurbanFound++;
        expect(isKurbanArifeOncesi(addDays(d, -1))).toBe(true);
      }
      if (isRamazanBayramArife(d)) {
        ramazanFound++;
        expect(isRamazanArifeOncesi(addDays(d, -1))).toBe(true);
      }
    }
    expect(kurbanFound).toBeGreaterThanOrEqual(2);
    expect(ramazanFound).toBeGreaterThanOrEqual(2);
  });

  it('Ramazan başlangıcından 1 gün öncesi, Ramazan ayının kendisiyle çakışmaz', () => {
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      if (isRamazanBaslangiciOncesi(d)) {
        expect(isRamazan(d)).toBe(false);
        expect(isRamazan(addDays(d, 1))).toBe(true);
      }
    }
  });
});

describe('Teşrik günleri (9-13 Zilhicce)', () => {
  it('isTesrikGunu yalnızca Zilhicce ayının 9-13. günlerinde true döner', () => {
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      const { day, month } = parseHijriDate(d);
      const beklenen = month === 12 && day >= 9 && day <= 13;
      expect(isTesrikGunu(d)).toBe(beklenen);
    }
  });

  it("isSonTesrikGunu yalnızca 13 Zilhicce'de true döner ve isTesrikGunu'nun bir alt kümesidir", () => {
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      if (isSonTesrikGunu(d)) {
        expect(isTesrikGunu(d)).toBe(true);
        const { day, month } = parseHijriDate(d);
        expect(month).toBe(12);
        expect(day).toBe(13);
      }
    }
  });

  it('Arefe (9 Zilhicce) teşrik aralığının ilk günüdür', () => {
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      if (isArefe(d)) {
        expect(isTesrikGunu(d)).toBe(true);
        expect(isTesrikGunu(addDays(d, -1))).toBe(false);
      }
    }
  });
});

describe('Kandil geceleri — sabit (ay, gün) tespitleri', () => {
  // Bu modülün KENDİ parseHijriDate'iyle üretilmiş, yerel takvim aritmetiğiyle
  // (new Date(y,m,d) + getDate() — UTC ISO etiketleme DEĞİL, bkz. mimari
  // denetim: ilk doğrulama turunda toISOString() kullanımı Europe/Istanbul
  // gibi UTC'nin önünde bir saat diliminde tarihleri 1 gün geriye kaydırarak
  // yanlış etiketliyordu) çapraz doğrulanmış referans tarihler.
  it('Miraç Kandili: 27 Receb', () => {
    expect(isMiracKandili(new Date(2025, 0, 27))).toBe(true);
    expect(isMiracKandili(new Date(2025, 0, 26))).toBe(false);
    expect(isMiracKandili(new Date(2025, 0, 28))).toBe(false);
  });

  it('Berat Kandili: 15 Şaban', () => {
    expect(isBeratKandili(new Date(2025, 1, 14))).toBe(true);
    expect(isBeratKandili(new Date(2025, 1, 13))).toBe(false);
    expect(isBeratKandili(new Date(2025, 1, 15))).toBe(false);
  });

  it('Kadir Gecesi: 27 Ramazan', () => {
    expect(isKadirGecesi(new Date(2025, 2, 27))).toBe(true);
    expect(isKadirGecesi(new Date(2025, 2, 26))).toBe(false);
    expect(isKadirGecesi(new Date(2025, 2, 28))).toBe(false);
  });

  it('Mevlid Kandili: 12 Rebiülevvel', () => {
    expect(isMevlidKandili(new Date(2025, 8, 5))).toBe(true);
    expect(isMevlidKandili(new Date(2025, 8, 4))).toBe(false);
    expect(isMevlidKandili(new Date(2025, 8, 6))).toBe(false);
  });

  it('her sabit kandil, geniş bir pencerede yılda tam bir kez tetiklenir', () => {
    const gunSayisi = 800; // ≈ 2.2 hicri yıl
    const sayaclar = { mirac: 0, berat: 0, kadir: 0, mevlid: 0 };
    for (let i = 0; i < gunSayisi; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      if (isMiracKandili(d)) sayaclar.mirac++;
      if (isBeratKandili(d)) sayaclar.berat++;
      if (isKadirGecesi(d)) sayaclar.kadir++;
      if (isMevlidKandili(d)) sayaclar.mevlid++;
    }
    // Hicri yıl ~354-355 gün olduğundan 800 günde 2 veya 3 tekrar beklenir.
    for (const sayac of Object.values(sayaclar)) {
      expect(sayac).toBeGreaterThanOrEqual(2);
      expect(sayac).toBeLessThanOrEqual(3);
    }
  });
});

describe('Regaib Kandili — Receb ayının ilk Cuma günü', () => {
  // NOT: isRegaibKandili KAYDIRMASIZ tespit yapar (bkz. islamicCalendar.ts
  // başı yorumu) — "gece" kaydırması (kandil gecesinin bir önceki akşam
  // olması) artık burada değil, tek yerde, useOzelVakitMesaji.ts'in kandil
  // bloğunda ele alınıyor (bkz. kullanıcı doğrulaması).
  it('yalnızca Receb ayının ilk 7 günü içindeki Cuma günü true döner', () => {
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      const { day, month } = parseHijriDate(d);
      const beklenen = month === 7 && day <= 7 && d.getDay() === 5; // 5 = Cuma
      expect(isRegaibKandili(d)).toBe(beklenen);
    }
  });

  it('her Receb ayında tam olarak bir kez tetiklenir (Receb ayının ilk 7 günü tüm haftanın günlerinden birer tane içerir)', () => {
    // 800 gün ≈ 2.26 hicri yıl — bir 7 günlük pencere Cuma'yı tam bir kez
    // içerdiğinden ayda birden fazla veya hiç tetiklenme İMKANSIZ olmalı,
    // ama pencerenin başlangıç fazına göre 2 veya 3 kez düşebilir (diğer
    // kandillerle aynı gerekçe — yukarıdaki toplu sayaç testine bkz.).
    let toplam = 0;
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      if (isRegaibKandili(d)) toplam++;
    }
    expect(toplam).toBeGreaterThanOrEqual(2);
    expect(toplam).toBeLessThanOrEqual(3);
  });

  it('bilinen 2025 tarihiyle örtüşür: 3 Receb 1446 (2025-01-03, Cuma)', () => {
    const gun = new Date(2025, 0, 3);
    expect(gun.getDay()).toBe(5); // Cuma olduğunu doğrula
    expect(isRegaibKandili(gun)).toBe(true);
  });
});

describe('Hicri Yılbaşı (1 Muharrem) ve Aşure Günü (10 Muharrem)', () => {
  it('yalnızca Muharrem ayının ilgili gününde true döner', () => {
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      const { day, month } = parseHijriDate(d);
      expect(isHicriYilbasi(d)).toBe(month === 1 && day === 1);
      expect(isAsureGunu(d)).toBe(month === 1 && day === 10);
    }
  });

  it('Aşure Günü, Hicri Yılbaşından tam 9 gün sonradır', () => {
    let found = 0;
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      if (isHicriYilbasi(d)) {
        found++;
        expect(isAsureGunu(addDays(d, 9))).toBe(true);
      }
    }
    expect(found).toBeGreaterThanOrEqual(2);
  });

  it('yılda tam bir kez tetiklenir', () => {
    const sayaclar = { yilbasi: 0, asure: 0 };
    for (let i = 0; i < 800; i++) {
      const d = addDays(new Date(2025, 0, 1), i);
      if (isHicriYilbasi(d)) sayaclar.yilbasi++;
      if (isAsureGunu(d)) sayaclar.asure++;
    }
    for (const sayac of Object.values(sayaclar)) {
      expect(sayac).toBeGreaterThanOrEqual(2);
      expect(sayac).toBeLessThanOrEqual(3);
    }
  });
});
