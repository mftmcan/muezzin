import { describe, it, expect } from 'vitest';
import { personelFormSemasi, duyuruFormSemasi, sistemAyarlariFormSemasi, izinFormSemasiOlustur, LIMITLER } from '../../src/lib/validation';

describe('personelFormSemasi', () => {
  const gecerli = { email: 'test@ornek.com', ad: 'Ahmet', soyad: 'Yılmaz', role: 'muezzin' as const, haftalikIzinGunu: 0 };

  it('geçerli veriyi kabul eder', () => {
    expect(personelFormSemasi.safeParse(gecerli).success).toBe(true);
  });

  it('Cuma (5) haftalık izin günü olarak reddedilir', () => {
    const sonuc = personelFormSemasi.safeParse({ ...gecerli, haftalikIzinGunu: 5 });
    expect(sonuc.success).toBe(false);
  });

  it('4 ve 6 haftalık izin günü olarak kabul edilir (sınır komşuları)', () => {
    expect(personelFormSemasi.safeParse({ ...gecerli, haftalikIzinGunu: 4 }).success).toBe(true);
    expect(personelFormSemasi.safeParse({ ...gecerli, haftalikIzinGunu: 6 }).success).toBe(true);
  });

  it('geçersiz e-postayı reddeder', () => {
    expect(personelFormSemasi.safeParse({ ...gecerli, email: 'gecersiz' }).success).toBe(false);
  });

  it(`e-posta ${LIMITLER.muezzinEmailMax} karakter sınırını aşınca reddeder`, () => {
    const uzunEmail = `${'a'.repeat(LIMITLER.muezzinEmailMax)}@x.com`;
    expect(personelFormSemasi.safeParse({ ...gecerli, email: uzunEmail }).success).toBe(false);
  });

  it(`birleşik ad+soyad ${LIMITLER.muezzinDisplayNameMax} karakteri aşınca reddeder`, () => {
    const sonuc = personelFormSemasi.safeParse({
      ...gecerli,
      ad: 'A'.repeat(60),
      soyad: 'B'.repeat(60),
    });
    expect(sonuc.success).toBe(false);
  });

  it('geçersiz rolü reddeder', () => {
    const sonuc = personelFormSemasi.safeParse({ ...gecerli, role: 'superadmin' });
    expect(sonuc.success).toBe(false);
  });

  it('boş ad/soyad reddedilir', () => {
    expect(personelFormSemasi.safeParse({ ...gecerli, ad: '' }).success).toBe(false);
    expect(personelFormSemasi.safeParse({ ...gecerli, soyad: '  ' }).success).toBe(false);
  });
});

describe('duyuruFormSemasi', () => {
  const gecerli = { baslik: 'Başlık', icerik: 'İçerik metni', tip: 'duyuru' as const };

  it('geçerli veriyi kabul eder', () => {
    expect(duyuruFormSemasi.safeParse(gecerli).success).toBe(true);
  });

  it(`başlık tam ${LIMITLER.duyuruBaslikMax} karakterde kabul edilir`, () => {
    expect(duyuruFormSemasi.safeParse({ ...gecerli, baslik: 'a'.repeat(LIMITLER.duyuruBaslikMax) }).success).toBe(true);
  });

  it(`başlık ${LIMITLER.duyuruBaslikMax + 1} karakterde reddedilir`, () => {
    expect(duyuruFormSemasi.safeParse({ ...gecerli, baslik: 'a'.repeat(LIMITLER.duyuruBaslikMax + 1) }).success).toBe(false);
  });

  it(`içerik ${LIMITLER.duyuruIcerikMax + 1} karakterde reddedilir`, () => {
    expect(duyuruFormSemasi.safeParse({ ...gecerli, icerik: 'a'.repeat(LIMITLER.duyuruIcerikMax + 1) }).success).toBe(false);
  });

  it('boş başlık/içerik reddedilir', () => {
    expect(duyuruFormSemasi.safeParse({ ...gecerli, baslik: '' }).success).toBe(false);
    expect(duyuruFormSemasi.safeParse({ ...gecerli, icerik: '   ' }).success).toBe(false);
  });

  it('geçersiz tip reddedilir', () => {
    expect(duyuruFormSemasi.safeParse({ ...gecerli, tip: 'gecersiz' }).success).toBe(false);
  });
});

describe('sistemAyarlariFormSemasi', () => {
  const gecerli = { ilceId: '9541', ilceAdi: 'Merkez', hicriDuzeltme: 0 };

  it('geçerli veriyi kabul eder', () => {
    expect(sistemAyarlariFormSemasi.safeParse(gecerli).success).toBe(true);
  });

  it('harf içeren ilçe kodunu reddeder', () => {
    expect(sistemAyarlariFormSemasi.safeParse({ ...gecerli, ilceId: '95a1' }).success).toBe(false);
  });

  it(`ilçe kodu ${LIMITLER.ilceIdMin - 1} karakterde reddedilir`, () => {
    expect(sistemAyarlariFormSemasi.safeParse({ ...gecerli, ilceId: '1'.repeat(LIMITLER.ilceIdMin - 1) }).success).toBe(false);
  });

  it(`hicriDuzeltme sınır değerleri ${LIMITLER.hicriDuzeltmeMin}/${LIMITLER.hicriDuzeltmeMax} kabul edilir`, () => {
    expect(sistemAyarlariFormSemasi.safeParse({ ...gecerli, hicriDuzeltme: LIMITLER.hicriDuzeltmeMin }).success).toBe(true);
    expect(sistemAyarlariFormSemasi.safeParse({ ...gecerli, hicriDuzeltme: LIMITLER.hicriDuzeltmeMax }).success).toBe(true);
  });

  it(`hicriDuzeltme ${LIMITLER.hicriDuzeltmeMax + 1} reddedilir`, () => {
    expect(sistemAyarlariFormSemasi.safeParse({ ...gecerli, hicriDuzeltme: LIMITLER.hicriDuzeltmeMax + 1 }).success).toBe(false);
  });
});

describe('izinFormSemasiOlustur', () => {
  const yarin = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const otekiGun = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  // "yarın" testin çalıştığı güne bağlı olarak bir Cuma'ya denk gelebilir
  // (flaky test riski) — Cuma'yla ilgisiz senaryolarda bilinen, sabit bir
  // Pazartesi (2027-01-04) kullanılır; yalnızca "bugünden önce" gibi gerçek
  // relative-date mantığı test edilen case'lerde yarin/otekiGun kullanılır.
  const sabitPazartesi = '2027-01-04';

  it('geçerli haftalık izin talebini kabul eder (Cuma içermeyen aralık)', () => {
    const sema = izinFormSemasiOlustur(30);
    const sonuc = sema.safeParse({ baslangic: sabitPazartesi, bitis: sabitPazartesi, tip: 'haftalik', sebep: 'Test gerekçesi' });
    expect(sonuc.success).toBe(true);
  });

  it('bugünden önceki başlangıcı reddeder', () => {
    const sema = izinFormSemasiOlustur(30);
    const dun = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    expect(sema.safeParse({ baslangic: dun, bitis: dun, tip: 'haftalik', sebep: 'Test' }).success).toBe(false);
  });

  it('bitiş başlangıçtan önce olunca reddeder', () => {
    const sema = izinFormSemasiOlustur(30);
    expect(sema.safeParse({ baslangic: otekiGun, bitis: yarin, tip: 'haftalik', sebep: 'Test' }).success).toBe(false);
  });

  it('Cuma içeren aralığı reddeder (bilinen bir Cuma: 2027-01-01)', () => {
    const sema = izinFormSemasiOlustur(30);
    // 2027-01-01 bir Cuma'dır (sabit, deterministik referans tarih).
    const sonuc = sema.safeParse({ baslangic: '2027-01-01', bitis: '2027-01-01', tip: 'haftalik', sebep: 'Test' });
    expect(sonuc.success).toBe(false);
  });

  it('yıllık izin kotasını aşan talebi reddeder', () => {
    const sema = izinFormSemasiOlustur(1);
    const baslangic = '2027-01-04'; // Pazartesi, Cuma içermeyen kısa aralık
    const bitis = '2027-01-06';
    const sonuc = sema.safeParse({ baslangic, bitis, tip: 'yillik', sebep: 'Test' });
    expect(sonuc.success).toBe(false);
  });

  it('mazeret tipinde yıllık kota sınırı uygulanmaz', () => {
    const sema = izinFormSemasiOlustur(0);
    const sonuc = sema.safeParse({ baslangic: '2027-01-04', bitis: '2027-01-06', tip: 'mazeret', sebep: 'Test' });
    expect(sonuc.success).toBe(true);
  });

  it('boş gerekçeyi reddeder', () => {
    const sema = izinFormSemasiOlustur(30);
    expect(sema.safeParse({ baslangic: sabitPazartesi, bitis: sabitPazartesi, tip: 'haftalik', sebep: '  ' }).success).toBe(false);
  });
});
