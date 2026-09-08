import { GunlukVakit, Vakit, Vakitler, VakitKaydi } from '../types';
import { getTurkeyNow, normalizeVakitSaati, parseVakitToDate } from '../lib/dateUtils';
import { Timestamp } from 'firebase/firestore';

const VAKITLER: Vakit[] = ['sabah', 'ogle', 'ikindi', 'aksam', 'yatsi'];

/**
 * Bir API gün kaydının ALTI vaktini de normalize eder; herhangi biri
 * ayrıştırılamıyorsa `null` döner ve çağıran o günü tamamen atlar.
 *
 * KAYNAKTA DOĞRULAMA (kod denetimi — "ezan saati biçim asimetrisi"): bu üç
 * ayrıştırıcı (`parseDiyanetResponse`, `parseAladhanResponse` ve
 * scripts/lib/diyanetResmiApi.ts `parseResmiResponse`) ham `unknown` değerleri
 * doğrudan `VakitKaydi`'ye cast edip Firestore'a yazıyordu. `"9:05"` (tek
 * haneli saat) veya `"abc"` gibi tek bir bozuk değer, aşağı akıştaki iki
 * tüketicinin FARKLI davranması nedeniyle sessiz bir fail-open'a dönüşüyordu
 * (ayrıntı: src/lib/dateUtils.ts `normalizeVakitSaati`). Kök neden çözümü,
 * bozuk verinin `vakitler` belgesine HİÇ ulaşmamasıdır; tüketici taraftaki
 * fail-closed davranış ise savunma derinliğidir.
 */
export function vakitKaydiniNormalize(ham: Record<string, unknown>): VakitKaydi | null {
  const alanlar: (keyof VakitKaydi)[] = ['sabah', 'gunes', 'ogle', 'ikindi', 'aksam', 'yatsi'];
  const sonuc = {} as VakitKaydi;
  for (const alan of alanlar) {
    const saat = normalizeVakitSaati(ham[alan]);
    if (!saat) return null;
    sonuc[alan] = saat;
  }
  return sonuc;
}

/**
 * NAMAZ VAKTİ SERVİSİ — Master Level Implementation
 * Clean Code, SOLID, ve Yüksek Performans odaklı refaktör edildi.
 */

/**
 * Dış API'lerden aylık ezan vakti verilerini çeker (Fallback mekanizması).
 * @param yil Yıl (örn: 2026)
 * @param ay Ay (1-12)
 * @param ilceId Diyanet İlçe ID (örn: 9148)
 * @param ilceAdi İlçe Adı (örn: Ceyhan)
 */
export async function aylikVakitleriCek(yil: number, ay: number, ilceId: string, ilceAdi: string): Promise<Vakitler> {
  try {
    // 1. Tercih: Diyanet API (e-mushaf proxy)
    const diyanetUrl = `https://ezanvakti.emushaf.net/vakitler/${ilceId}`;
    const response = await fetch(diyanetUrl);

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const parsed = parseDiyanetResponse(data, ilceId);
        // Bu uç nokta (yil, ay) parametrelerini yok sayar, "şimdi"den itibaren
        // kayan bir pencere döner — ay sınırında (ör. 31 Ağustos'ta yarının ait
        // olduğu Eylül'ü isterken) pencere henüz bir sonraki aya geçmemiş
        // olabilir. HTTP 200 + boş-olmayan dizi TEK BAŞINA yeterli değil;
        // döndürülen günlerin GERÇEKTEN istenen aya ait olup olmadığı da
        // doğrulanmalı — aksi halde çağıran, hiç sahip olmadığı bir ay için
        // "başarılı" bir yanıt alıp Aladhan'a hiç düşmez (bkz. 2026-08-31 →
        // 2026-09-01 canlı arızası: emushaf o an yalnızca Ağustos döndürüyordu,
        // Eylül verisi bu kontrol olmadan hiç yazılmamıştı).
        const ayOneki = `${yil}-${String(ay).padStart(2, '0')}`;
        const ayiKapsiyor = Object.keys(parsed.gunler).some((tarih) => tarih.startsWith(ayOneki));
        if (ayiKapsiyor) {
          return parsed;
        }
        throw new Error(`Diyanet verisi istenen ayı (${ayOneki}) kapsamıyor, Aladhan deneniyor.`);
      }
    }

    throw new Error('Diyanet verisi alınamadı, Aladhan deneniyor.');
  } catch (err) {
    console.warn('Diyanet API hatası, Aladhan API devreye giriyor:', err);

    // 2. Tercih: Aladhan API (City/Country bazlı)
    // Not: Aladhan API ay bazlı veri döner
    let city = ilceAdi;
    let country = 'Turkey';
    if (ilceAdi.includes(',')) {
      const parts = ilceAdi.split(',');
      city = parts[0].trim();
      country = parts[1].trim();
    } else {
      const lowerCity = ilceAdi.toLowerCase();
      if (
        lowerCity.includes('mekke') ||
        lowerCity.includes('mecca') ||
        lowerCity.includes('medine') ||
        lowerCity.includes('medina') ||
        lowerCity.includes('riyad')
      ) {
        country = 'Saudi Arabia';
      } else if (lowerCity.includes('london') || lowerCity.includes('londra')) {
        country = 'United Kingdom';
      }
    }

    // method=13, Aladhan'ın kendi metod listesinde birebir "Diyanet İşleri
    // Başkanlığı, Turkey" olarak tanımlı (18°/17° tan açılarıyla) — ama
    // Aladhan bunu kendi listesinde "(experimental)" diye işaretliyor, yani
    // resmi/sertifikalı bir garanti değil. Ceyhan/9148 için gerçek Diyanet
    // (emushaf) verisiyle aynı gün karşılaştırıldığında (bkz. yetki/kota
    // denetimi, 2026-08-29) sapma en fazla ±1 dakikaydı — bu, yalnızca SON
    // ÇARE fallback olarak (emushaf/resmi Diyanet API'si başarısız olduğunda)
    // kullanıldığından kabul edilebilir bir tolerans.
    const aladhanUrl = `https://api.aladhan.com/v1/calendarByCity/${yil}/${ay}?city=${city}&country=${country}&method=13`;
    const response = await fetch(aladhanUrl);

    if (!response.ok) throw new Error('Ezan vakti servislerine erişilemiyor.');

    const result = (await response.json()) as { data?: unknown };
    if (!Array.isArray(result?.data)) {
      throw new Error('Ezan vakti servisi beklenmeyen bir yanıt döndü.');
    }
    return parseAladhanResponse(result.data, ilceId);
  }
}

/** Tek bir aya ait, `guncellenmeTarihi` içermeyen vakit grubu — bu alan
 * yazım anında (client SDK'sı client, admin SDK'sı `firebase-admin/firestore`
 * Timestamp'ı kullandığından) her çağıran tarafından ayrıca eklenir. */
export type AylikVakitGrubu = Pick<Vakitler, 'ilceId' | 'kaynakApi'> & { gunler: Vakitler['gunler'] };

/**
 * `aylikVakitleriCek`'in döndürdüğü (Diyanet kaynağı için `yil`/`ay`
 * parametrelerini yok sayan, bugünden itibaren ~30-32 günlük kayan bir
 * pencere döndüren — bkz. yukarıdaki fonksiyon) veriyi gerçek takvim ayına
 * göre gruplar. Hem `scripts/aylikEzanTakvimiGuncelle.ts` (gece cron'u) hem
 * `src/services/vakitCacheServisi.ts` (istemci senkronu) bunu kullanır —
 * eskiden istemci tarafı bu gruplamayı YAPMIYORDU, aynı karışık pencereyi
 * hem "bu ay" hem "gelecek ay" doc'una kopyalıyordu (bkz. mimari denetim O5).
 */
export function aylikVakitleriGrupla(vakitler: Vakitler): Record<string, AylikVakitGrubu> {
  const aylar: Record<string, AylikVakitGrubu> = {};
  Object.entries(vakitler.gunler).forEach(([tarih, kayit]) => {
    const ayId = tarih.slice(0, 7); // YYYY-MM
    if (!aylar[ayId]) {
      aylar[ayId] = { ilceId: vakitler.ilceId, kaynakApi: vakitler.kaynakApi, gunler: {} };
    }
    aylar[ayId].gunler[tarih] = kayit;
  });
  return aylar;
}

/**
 * Mevcut namaz vaktini hesaplar.
 */
export function mevcutVaktiHesapla(bugunVakitler: GunlukVakit): Vakit {
  const şimdi = getTurkeyNow();

  // Sondan başa doğru kontrol ederek içinde olduğumuz en son vakti buluyoruz
  for (let i = VAKITLER.length - 1; i >= 0; i--) {
    const vakit = VAKITLER[i];
    const vakitZamani = parseVakitToDate(bugunVakitler.tarih, bugunVakitler[vakit]);

    if (vakitZamani && şimdi >= vakitZamani) {
      return vakit;
    }
  }

  // Gece yarısından sabah namazına kadar olan süreyi yatsı periyodu sayıyoruz
  return 'yatsi';
}

/**
 * Bir sonraki namaz vaktini ve ilgili kilit zamanlarını hesaplar.
 */
export function sonrakiVaktiHesapla(
  bugunVakitler: GunlukVakit,
  yarinVakitler?: GunlukVakit
): {
  vakit: Vakit;
  ezanSaati: Date;
  baslangicZamani: Date;
  okudumAcilisZamani: Date;
  t1KilitZamani: Date;
} | null {
  const şimdi = getTurkeyNow();
  let oncekiVakitZamani: Date | null = null;

  for (let i = 0; i < VAKITLER.length; i++) {
    const vakit = VAKITLER[i];
    const ezanSaati = parseVakitToDate(bugunVakitler.tarih, bugunVakitler[vakit]);
    if (!ezanSaati) continue;

    // Görev bitişi: ezandan 1 dakika sonra (tam saniye bazlı kontrol için buffer)
    const gorevBitisZamani = new Date(ezanSaati.getTime() + 60 * 1000);

    if (gorevBitisZamani > şimdi) {
      // Önceki vakit zamanını belirle (progress bar ve kilitler için)
      if (i > 0) {
        oncekiVakitZamani = parseVakitToDate(bugunVakitler.tarih, bugunVakitler[VAKITLER[i - 1]]);
      } else {
        // Sabah namazı için önceki vakit (dünkü yatsı) yaklaşık 2 saat önce gibi varsayılabilir
        // veya spesifik mantık eklenebilir.
        oncekiVakitZamani = new Date(ezanSaati.getTime() - 2 * 60 * 60 * 1000);
      }

      return {
        vakit,
        ezanSaati,
        baslangicZamani: oncekiVakitZamani || new Date(ezanSaati.getTime() - 3600000),
        okudumAcilisZamani: new Date(ezanSaati.getTime()),
        t1KilitZamani: new Date(ezanSaati.getTime() - 60 * 60 * 1000),
      };
    }
  }

  // Eğer bugünün tüm vakitleri geçtiyse, yarına bakıyoruz
  if (yarinVakitler) {
    const yarinSabah = parseVakitToDate(yarinVakitler.tarih, yarinVakitler.sabah);
    if (yarinSabah) {
      const bugunYatsi = parseVakitToDate(bugunVakitler.tarih, bugunVakitler.yatsi);
      return {
        vakit: 'sabah',
        ezanSaati: yarinSabah,
        baslangicZamani: bugunYatsi || new Date(yarinSabah.getTime() - 3 * 3600000),
        okudumAcilisZamani: new Date(yarinSabah.getTime()),
        t1KilitZamani: new Date(yarinSabah.getTime() - 60 * 60 * 1000),
      };
    }
  }

  return null;
}

// --- Yardımcı Parsers ---

/** Diyanet (e-mushaf proxy) API'sinin ham gün kaydı şekli — alan adları
 *  API'nin kendi Türkçe/PascalCase adlandırmasını birebir izler. */
interface DiyanetGunRaw {
  MiladiTarihKisa?: unknown;
  Imsak?: unknown;
  Gunes?: unknown;
  Ogle?: unknown;
  Ikindi?: unknown;
  Aksam?: unknown;
  Yatsi?: unknown;
}

/** Aladhan API'sinin ham gün kaydı şekli (calendarByCity uç noktası). */
interface AladhanGunRaw {
  date?: { gregorian?: { date?: unknown } };
  timings?: Record<string, unknown>;
}

function parseDiyanetResponse(data: DiyanetGunRaw[], ilceId: string): Vakitler {
  const gunler: Record<string, VakitKaydi> = {};
  data.forEach((gun) => {
    const rawDate = gun?.MiladiTarihKisa;
    if (typeof rawDate !== 'string' || !rawDate) {
      console.warn('Diyanet API: gün verisi eksik/bozuk, atlandı:', gun);
      return;
    }
    let dateKey = rawDate;
    if (dateKey.includes('.')) {
      const [d, m, y] = dateKey.split('.');
      dateKey = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const kayit = vakitKaydiniNormalize({
      sabah: gun.Imsak,
      gunes: gun.Gunes,
      ogle: gun.Ogle,
      ikindi: gun.Ikindi,
      aksam: gun.Aksam,
      yatsi: gun.Yatsi,
    });
    if (!kayit) {
      console.warn('Diyanet API: vakit saati biçimi bozuk, gün atlandı:', dateKey, gun);
      return;
    }
    gunler[dateKey] = kayit;
  });
  return {
    ilceId,
    gunler,
    kaynakApi: 'diyanet',
    guncellenmeTarihi: Timestamp.now(),
  };
}

function parseAladhanResponse(data: AladhanGunRaw[], ilceId: string): Vakitler {
  const gunler: Record<string, VakitKaydi> = {};
  data.forEach((gun) => {
    const tarih = gun?.date?.gregorian?.date; // 20-04-2026
    const timings = gun?.timings;
    if (typeof tarih !== 'string' || !timings) {
      console.warn('Aladhan API: gün verisi eksik/bozuk, atlandı:', gun);
      return;
    }
    const [d, m, y] = tarih.split('-');
    const formattedDate = `${y}-${m}-${d}`;
    const vaktiAyikla = (key: string): string | undefined =>
      typeof timings[key] === 'string' ? (timings[key] as string).split(' ')[0] : undefined;
    const kayit = vakitKaydiniNormalize({
      sabah: vaktiAyikla('Fajr'),
      gunes: vaktiAyikla('Sunrise'),
      ogle: vaktiAyikla('Dhuhr'),
      ikindi: vaktiAyikla('Asr'),
      aksam: vaktiAyikla('Maghrib'),
      yatsi: vaktiAyikla('Isha'),
    });
    if (!kayit) {
      console.warn('Aladhan API: vakit saati biçimi bozuk, gün atlandı:', formattedDate, timings);
      return;
    }
    gunler[formattedDate] = kayit;
  });
  return {
    ilceId,
    gunler,
    kaynakApi: 'aladhan',
    guncellenmeTarihi: Timestamp.now(),
  };
}
