import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  gpsHataTuruBelirle,
  kibleAcisiHesapla,
  kibleMesafesiHesapla,
  konumVakitleriniCek,
  ilceKoordinatlariniCek,
} from '../../src/services/gpsVakitServisi';
import { getTurkeyDateString, getTurkeyNow } from '../../src/lib/dateUtils';

function gpsHatasi(code: 1 | 2 | 3): GeolocationPositionError {
  return {
    code,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
    message: 'test',
  } as GeolocationPositionError;
}

describe('gpsHataTuruBelirle', () => {
  it('GeolocationPositionError PERMISSION_DENIED -> izin_reddi', () => {
    expect(gpsHataTuruBelirle(gpsHatasi(1))).toBe('izin_reddi');
  });

  it('GeolocationPositionError POSITION_UNAVAILABLE -> konum_belirlenemedi', () => {
    expect(gpsHataTuruBelirle(gpsHatasi(2))).toBe('konum_belirlenemedi');
  });

  it('GeolocationPositionError TIMEOUT -> zaman_asimi', () => {
    expect(gpsHataTuruBelirle(gpsHatasi(3))).toBe('zaman_asimi');
  });

  it('mesajında "desteklemiyor" geçen Error -> desteklenmiyor', () => {
    expect(gpsHataTuruBelirle(new Error('Bu tarayıcı konumu desteklemiyor.'))).toBe('desteklenmiyor');
  });

  it('tanınmayan hata -> bilinmeyen', () => {
    expect(gpsHataTuruBelirle(new Error('beklenmedik ağ hatası'))).toBe('bilinmeyen');
    expect(gpsHataTuruBelirle('düz string')).toBe('bilinmeyen');
    expect(gpsHataTuruBelirle(null)).toBe('bilinmeyen');
  });
});

describe('kibleAcisiHesapla', () => {
  it('İstanbul için bilinen aralıkta bir açı döner (~151°, güneydoğu)', () => {
    const aci = kibleAcisiHesapla(41.0082, 28.9784);
    expect(aci).toBeGreaterThan(145);
    expect(aci).toBeLessThan(157);
  });

  it('Ceyhan için bilinen aralıkta bir açı döner (~166°)', () => {
    const aci = kibleAcisiHesapla(37.0298, 35.8164);
    expect(aci).toBeGreaterThan(160);
    expect(aci).toBeLessThan(172);
  });

  it('sonuç her zaman [0, 360) aralığındadır', () => {
    const aci = kibleAcisiHesapla(-33.8688, 151.2093); // Sidney - negatif enlem
    expect(aci).toBeGreaterThanOrEqual(0);
    expect(aci).toBeLessThan(360);
  });
});

describe('kibleMesafesiHesapla', () => {
  it('Kabe koordinatının kendisi için mesafe ~0', () => {
    const mesafe = kibleMesafesiHesapla(21.422487, 39.826206);
    expect(mesafe).toBeLessThan(1);
  });

  it('Ceyhan için bilinen aralıkta bir mesafe döner (~1780 km)', () => {
    // Uygulamanın kendi arayüzünde (KiblePusulasiModal) Ceyhan için
    // gösterilen değer ~1.778 km — burada geniş bir tolerans aralığı
    // kullanılıyor (kesin haversine sonucu formülün kendisini doğrular).
    const mesafe = kibleMesafesiHesapla(37.0298, 35.8164);
    expect(mesafe).toBeGreaterThan(1700);
    expect(mesafe).toBeLessThan(1850);
  });
});

describe('konumVakitleriniCek', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(opts: {
    aladhanOk?: boolean;
    aladhanTimings?: Record<string, unknown> | null;
    geoBehavior?: 'ok' | 'not-ok' | 'throw';
  }) {
    const { aladhanOk = true, aladhanTimings, geoBehavior = 'ok' } = opts;
    const timings = aladhanTimings ?? {
      Imsak: '04:12 (+03)',
      Sunrise: '05:41 (+03)',
      Dhuhr: '12:47 (+03)',
      Asr: '16:34 (+03)',
      Maghrib: '19:43 (+03)',
      Isha: '21:09 (+03)',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('aladhan.com')) {
          return {
            ok: aladhanOk,
            json: async () => ({ data: { timings } }),
          } as Response;
        }
        // Nominatim reverse geocoding
        if (geoBehavior === 'throw') throw new Error('ağ hatası');
        if (geoBehavior === 'not-ok') return { ok: false } as Response;
        return {
          ok: true,
          json: async () => ({
            name: 'Test Konum',
            address: { suburb: 'Merkez', province: 'Adana' },
          }),
        } as Response;
      })
    );
  }

  it('başarılı yolda Aladhan alanlarını doğru GunlukVakit alanlarına eşler', async () => {
    stubFetch({});
    const sonuc = await konumVakitleriniCek(37.0298, 35.8164);

    expect(sonuc.vakitler.sabah).toBe('04:12');
    expect(sonuc.vakitler.gunes).toBe('05:41');
    expect(sonuc.vakitler.ogle).toBe('12:47');
    expect(sonuc.vakitler.ikindi).toBe('16:34');
    expect(sonuc.vakitler.aksam).toBe('19:43');
    expect(sonuc.vakitler.yatsi).toBe('21:09');
    expect(sonuc.konumAdi).toBe('Merkez, Adana');
    expect(sonuc.coords).toEqual({ latitude: 37.0298, longitude: 35.8164 });
  });

  it("tarih her zaman Türkiye takvim gününe göre etiketlenir (API'nin yerel tarihine göre değil)", async () => {
    stubFetch({});
    const beklenenTarih = getTurkeyDateString(getTurkeyNow());
    const sonuc = await konumVakitleriniCek(37.0298, 35.8164);

    expect(sonuc.date).toBe(beklenenTarih);
    expect(sonuc.vakitler.tarih).toBe(beklenenTarih);
  });

  it('Aladhan yanıtı ok:false ise hata fırlatır', async () => {
    stubFetch({ aladhanOk: false });
    await expect(konumVakitleriniCek(37.0298, 35.8164)).rejects.toThrow('Konum bazlı ezan vakitlerine erişilemiyor.');
  });

  it('Aladhan yanıtı beklenmeyen şekilde geldiğinde (eksik alan) hata fırlatır', async () => {
    stubFetch({ aladhanTimings: { Imsak: '04:12 (+03)' } }); // diğer alanlar eksik
    await expect(konumVakitleriniCek(37.0298, 35.8164)).rejects.toThrow('Ezan vakti servisi beklenmeyen bir yanıt döndü.');
  });

  it('geocoding ağ hatası atsa bile vakit hesaplaması başarısız olmaz, "Yakın Konum" fallback\'ine düşer', async () => {
    stubFetch({ geoBehavior: 'throw' });
    const sonuc = await konumVakitleriniCek(37.0298, 35.8164);

    expect(sonuc.konumAdi).toBe('Yakın Konum');
    expect(sonuc.vakitler.ogle).toBe('12:47');
  });

  it('geocoding ok:false dönerse de vakit hesaplaması başarısız olmaz', async () => {
    stubFetch({ geoBehavior: 'not-ok' });
    const sonuc = await konumVakitleriniCek(37.0298, 35.8164);

    expect(sonuc.konumAdi).toBe('Yakın Konum');
  });
});

describe('ilceKoordinatlariniCek', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('boş/whitespace girdi için null döner, ağ çağrısı yapmaz', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await ilceKoordinatlariniCek('   ')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("başarılı geocoding sonucunda koordinat döner ve sessionStorage'a yazar", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => [{ lat: '37.5', lon: '36.2' }],
          }) as Response
      )
    );

    const sonuc = await ilceKoordinatlariniCek('Kozan');
    expect(sonuc).toEqual({ lat: 37.5, lng: 36.2 });
    expect(sessionStorage.getItem('ilce_geo_kozan')).toBe(JSON.stringify(sonuc));
  });

  it('ikinci çağrıda sessionStorage önbelleğini kullanır, tekrar fetch yapmaz', async () => {
    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => [{ lat: '37.5', lon: '36.2' }],
        }) as Response
    );
    vi.stubGlobal('fetch', fetchSpy);

    await ilceKoordinatlariniCek('Kozan');
    await ilceKoordinatlariniCek('Kozan');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('ağ hatasında (fırlatılsa bile) null döner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ağ hatası');
      })
    );
    expect(await ilceKoordinatlariniCek('BilinmeyenYer')).toBeNull();
  });

  it('sonuç boş dizi veya geçersiz koordinat içeriyorsa null döner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => [],
          }) as Response
      )
    );
    expect(await ilceKoordinatlariniCek('OlmayanYer')).toBeNull();
  });
});
