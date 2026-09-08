// NOT: `firebase/firestore` (Admin SDK'nın Timestamp'i DEĞİL) — src/types.ts
// `Vakitler.guncellenmeTarihi` bu tiple tanımlı ve src/services/ezanVaktiServisi.ts'in
// mevcut parser'ları (parseDiyanetResponse/parseAladhanResponse) da aynı
// deseni izliyor. Zararsız: her iki çağıran script de (aylikEzanTakvimiGuncelle.ts,
// vakitVeriSagligiKontrol.ts) Firestore'a yazmadan önce bu alanı kendi
// Admin SDK Timestamp'iyle zaten YENİDEN YAZIYOR — burası yalnızca ara
// tip uyumu için var, hiçbir zaman bu haliyle Firestore'a gitmiyor.
import { Timestamp } from 'firebase/firestore';
import type { Vakitler, VakitKaydi } from '../../src/types.ts';
import { aylikVakitleriCek, vakitKaydiniNormalize } from '../../src/services/ezanVaktiServisi.ts';
import { db, Timestamp as AdminTimestamp } from './firebaseAdminInit.ts';
import { getTurkeyNow } from '../../src/lib/dateUtils.ts';

/**
 * DİYANET RESMİ NAMAZ VAKTİ API'Sİ (awqatsalah.diyanet.gov.tr)
 * ---------------------------------------------------------------
 * `src/services/ezanVaktiServisi.ts`'teki mevcut zincir (emushaf.net proxy →
 * Aladhan) tamamen ANAHTARSIZ (public) API'lere dayanıyor — bu yüzden hem
 * tarayıcıdan hem sunucudan güvenle çağrılabiliyor. Resmi Diyanet servisi
 * ise e-posta/şifre ile JWT login gerektiriyor; bu kimlik bilgileri
 * TARAYICI paketine asla girmemeli (herkese açık bundle'da sızar). Bu
 * yüzden bu dosya BİLİNÇLİ OLARAK `scripts/lib/` altında, yalnızca Admin
 * SDK bağlamında çalışan `aylikEzanTakvimiGuncelle.ts` (aylık cron)
 * tarafından import edilecek şekilde tutuluyor — `src/services/
 * ezanVaktiServisi.ts` (hem tarayıcı hem sunucu tarafından paylaşılan
 * modül) bu dosyayı ASLA import etmemeli. `vakitVeriSagligiKontrol.ts`
 * (GÜNLÜK sağlık kontrolü) BİLİNÇLİ OLARAK bu dosyayı KULLANMIYOR — aksi
 * halde bir kesinti sırasında (verinin gerçekten eksik olduğu, tam da
 * resmi API'ye en çok ihtiyaç duyulan an) her gün tekrar tekrar denenip
 * aylık kotayı hızla tüketirdi; günlük kontrol mevcut anahtarsız zincirde
 * (emushaf/Aladhan) kalmaya devam ediyor.
 *
 * Kota: Kullanıcının bildirdiği bilgiye göre bazı uç noktalar (ör.
 * DateRange) konum başına AYLIK 10 istekle sınırlı; genel "Standart Rol"
 * kılavuzu ise endpoint+parametre başına GÜNLÜK 5 istekten bahsediyor.
 * Hangi sınırın `Monthly`/`CityDetail`'e tam olarak uygulandığı belgeden
 * kesin çıkarılamadığından, EN SIKI olası okumaya (aylık 10) göre
 * davranılır: `AYLIK_ISTEK_LIMITI` ile ay başına en fazla 8 "deneme"ye
 * (güvenlik payı bırakılarak) izin verilir — bkz. `kotaRezerveEt`. Aylık
 * cron zaten ayda yalnızca 1 kez zamanlanmış çalışır; bu sayaç asıl olarak
 * manuel `workflow_dispatch` tekrarlarının (test/hata ayıklama) kotayı
 * kazara tüketmesine karşı bir güvenlik ağı.
 */

const AYLIK_ISTEK_LIMITI = 8;
const KOTA_DOC = 'diyanetResmiApiKota';

/**
 * Firestore'da `config/diyanetResmiApiKota` belgesinde ay başına bir
 * "deneme" sayacı tutar (transaction ile atomik) — limitine ulaşılmışsa
 * `false` döner ve hiçbir HTTP isteği yapılmadan (Login dahil) doğrudan
 * mevcut zincire düşülür. Bir "deneme" burada Login+CityDetail+Monthly'nin
 * TAMAMINI (başarılı ya da başarısız fark etmeksizin) kapsıyor — kısmi bir
 * başarısızlık bile gerçek kota tüketimi olduğundan yalnızca başarıyı
 * saymak yanıltıcı olurdu.
 */
async function kotaRezerveEt(): Promise<boolean> {
  const ref = db.collection('config').doc(KOTA_DOC);
  // `getTurkeyNow()` zaten LOKAL getter'ları Türkiye saatini verecek
  // şekilde kaydırılmış bir Date döner — `.toISOString()` bunu tekrar
  // UTC'ye çevirdiğinden ÇİFT KAYDIRMAYA yol açıyordu (düşük öncelikli
  // bulgu). UTC runner'da (localOffset==0) tesadüfen doğru sonuç çıkıyordu,
  // ama Türkiye'deki bir geliştirici makinesinde ayın 1'i 00:00-03:00
  // arası önceki ayın kota kovasını kullanabiliyordu. Kod tabanının geri
  // kalanı bu iş için lokal getter'ları kullanıyor (bkz. getTurkeyDateString).
  const simdi = getTurkeyNow();
  const ay = `${simdi.getFullYear()}-${String(simdi.getMonth() + 1).padStart(2, '0')}`; // "YYYY-MM"

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const veri = snap.exists ? (snap.data() as { ay?: string; istekSayisi?: number }) : {};
    const guncelSayisi = veri.ay === ay ? veri.istekSayisi || 0 : 0;

    if (guncelSayisi >= AYLIK_ISTEK_LIMITI) return false;

    // `merge:true` olmadan bu yazım `dususNedeniniKaydet`'in (altta) aynı
    // belgeye yazdığı sonDususNedeni/sonDususMesaji/sonDususTarihi
    // gözlemlenebilirlik alanlarını her koşuda siliyordu — "zamanla
    // kalibre etmek için" tutulan bu veri hiç birikemiyordu (düşük
    // öncelikli bulgu, FR-O6 ile aynı dosya).
    tx.set(ref, { ay, istekSayisi: guncelSayisi + 1 }, { merge: true });
    return true;
  });
}

const BASE_URL = 'https://awqatsalah.diyanet.gov.tr';

interface LoginResponse {
  data?: { accessToken?: string; refreshToken?: string };
  success?: boolean;
  message?: string | null;
}

interface CityDetailResponse {
  data?: { id?: string | number; name?: string };
  success?: boolean;
  message?: string | null;
}

interface MonthlyGunRaw {
  fajr?: string;
  sunrise?: string;
  dhuhr?: string;
  asr?: string;
  maghrib?: string;
  isha?: string;
  /** Örn: "2026-08-29T00:00:00.0000000+03:00" — tarih kısmı gerçekten
   *  ISO-8601. `gregorianDateShortIso8601` alanı adına rağmen "dd.mm.yyyy"
   *  formatındadır (resmi kılavuzdaki örnek de böyle), bu yüzden
   *  kasıtlı olarak KULLANILMIYOR. */
  gregorianDateLongIso8601?: string;
}

interface MonthlyResponse {
  data?: MonthlyGunRaw[];
  success?: boolean;
  message?: string | null;
}

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/Auth/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const result = (await response.json().catch(() => null)) as LoginResponse | null;
  if (!response.ok || !result?.success || !result.data?.accessToken) {
    throw new Error(`Diyanet resmi API girişi başarısız (HTTP ${response.status}): ${result?.message || 'bilinmeyen hata'}`);
  }
  return result.data.accessToken;
}

/**
 * `ilceId` (uygulamanın settings/system'de tuttuğu, emushaf.net proxy'siyle
 * paylaşılan klasik Diyanet ilçe kodu) resmi API'nin `cityId`'siyle AYNI
 * numaralandırmayı mı kullanıyor bilinmiyor — iki servis ayrı sistemler.
 * Körü körüne güvenmek yerine `/api/Place/CityDetail/{ilceId}` ile
 * doğrulanır: dönen `name` beklenen `ilceAdi` ile (büyük/küçük harf ve
 * Türkçe karakter farkını yok sayarak) örtüşmüyorsa cityId YANLIŞ demektir
 * — bu durumda resmi API katmanı atlanır (çağıran taraf mevcut zincire
 * düşer), yanlış ilçenin vakitleri asla yazılmaz.
 */
function turkceNormalize(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]/g, '');
}

async function cityIdDogrula(accessToken: string, ilceId: string, ilceAdi: string): Promise<boolean> {
  const response = await fetch(`${BASE_URL}/api/Place/CityDetail/${ilceId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = (await response.json().catch(() => null)) as CityDetailResponse | null;
  if (!response.ok || !result?.success || !result.data?.name) return false;

  const donenAd = turkceNormalize(result.data.name);
  const beklenenAd = turkceNormalize(ilceAdi.split(',')[0] || ilceAdi);
  return donenAd === beklenenAd || donenAd.includes(beklenenAd) || beklenenAd.includes(donenAd);
}

function parseResmiResponse(data: MonthlyGunRaw[], ilceId: string): Vakitler {
  const gunler: Record<string, VakitKaydi> = {};
  data.forEach((gun) => {
    const isoUzun = gun.gregorianDateLongIso8601;
    if (typeof isoUzun !== 'string' || isoUzun.length < 10) {
      console.warn('Diyanet resmi API: gün verisi eksik/bozuk, atlandı:', gun);
      return;
    }
    const dateKey = isoUzun.slice(0, 10); // "YYYY-MM-DD"
    // Alan varlığı + BİÇİM doğrulaması tek noktada (bkz.
    // src/services/ezanVaktiServisi.ts `vakitKaydiniNormalize` yorumu —
    // "kaynakta doğrulama"): eskiden yalnızca "alan dolu mu" bakılıyor,
    // "9:05"/"abc" gibi ayrıştırılamayan bir değer Firestore'a olduğu gibi
    // yazılıyordu.
    const kayit = vakitKaydiniNormalize({
      sabah: gun.fajr,
      gunes: gun.sunrise,
      ogle: gun.dhuhr,
      ikindi: gun.asr,
      aksam: gun.maghrib,
      yatsi: gun.isha,
    });
    if (!kayit) {
      console.warn('Diyanet resmi API: vakit alanı eksik/biçimi bozuk, atlandı:', dateKey);
      return;
    }
    gunler[dateKey] = kayit;
  });

  if (Object.keys(gunler).length === 0) {
    throw new Error('Diyanet resmi API: ayrıştırılabilir gün verisi bulunamadı.');
  }

  return {
    ilceId,
    gunler,
    // firestore.rules `isValidVakitCache` ve src/types.ts `Vakitler.kaynakApi`
    // ile senkron tutulmalı — emushaf proxy'sinden ayırt edebilmek için AYRI
    // bir değer (ikisi de "Diyanet" kaynaklı olsa da, hangisinin fiilen
    // kullanıldığını admin panelinde (EzanOnbellegi.tsx) görebilmek
    // için).
    kaynakApi: 'diyanet-resmi',
    guncellenmeTarihi: Timestamp.now(),
  };
}

/**
 * Resmi Diyanet API'sinden aylık vakit çeker. Kimlik bilgileri eksikse
 * (henüz `DIYANET_API_EMAIL`/`DIYANET_API_PASSWORD` secret'ları
 * eklenmemişse) veya herhangi bir adımda hata olursa fırlatır — çağıran
 * taraf (bkz. `vakitleriCekOncelikli` altta) mevcut public zincire düşer.
 */
export async function resmiDiyanetVakitleriCek(ilceId: string, ilceAdi: string): Promise<Vakitler> {
  const email = process.env.DIYANET_API_EMAIL;
  const password = process.env.DIYANET_API_PASSWORD;
  if (!email || !password) {
    throw new Error('DIYANET_API_EMAIL/DIYANET_API_PASSWORD tanımlı değil, resmi API atlanıyor.');
  }

  const accessToken = await login(email, password);

  const cityIdGecerli = await cityIdDogrula(accessToken, ilceId, ilceAdi);
  if (!cityIdGecerli) {
    throw new Error(
      `Diyanet resmi API: ilçe ID doğrulanamadı (ilceId=${ilceId}, beklenen ad="${ilceAdi}") — cityId numaralandırması emushaf.net ile örtüşmüyor olabilir.`
    );
  }

  const response = await fetch(`${BASE_URL}/api/PrayerTime/Monthly/${ilceId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = (await response.json().catch(() => null)) as MonthlyResponse | null;
  if (!response.ok || !result?.success || !Array.isArray(result.data)) {
    throw new Error(`Diyanet resmi API: aylık vakit isteği başarısız (HTTP ${response.status}): ${result?.message || 'bilinmeyen hata'}`);
  }

  return parseResmiResponse(result.data, ilceId);
}

/**
 * Resmi API atlanıp fallback zincirine (emushaf/Aladhan) düşüldüğünde,
 * nedeni zaten kota sayacını tuttuğumuz `config/diyanetResmiApiKota`
 * belgesine `merge: true` ile ekler (ayrı bir koleksiyon/admin uyarısı
 * AÇMADAN) — `AYLIK_ISTEK_LIMITI`'nin gerçek Diyanet kotasıyla ne kadar
 * örtüştüğünü zamanla kalibre edebilmek için. Yazım en iyi çaba
 * (best-effort): başarısız olursa yalnızca konsola uyarı düşer, cron'un asıl
 * işini (fallback verisini yazmayı) hiçbir şekilde engellemez.
 */
async function dususNedeniniKaydet(neden: 'kota' | 'hata', mesaj: string): Promise<void> {
  try {
    await db.collection('config').doc(KOTA_DOC).set(
      {
        sonDususNedeni: neden,
        sonDususMesaji: mesaj,
        sonDususTarihi: AdminTimestamp.now(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('Düşüş nedeni kota belgesine yazılamadı (yalnızca gözlemlenebilirlik, cron devam ediyor):', err);
  }
}

/**
 * Sunucu bağlamındaki (Admin SDK) çağıranlar için TEK giriş noktası: önce
 * resmi Diyanet API'sini dener, herhangi bir sebeple başarısız olursa
 * (kimlik bilgisi yok, kota, ağ hatası, cityId uyuşmazlığı) mevcut public
 * zincire (emushaf.net → Aladhan, bkz. `aylikVakitleriCek`) düşer — bu
 * script'lerin daha önce sahip olduğu dayanıklılığı KORUR, yalnızca yeni bir
 * tercih edilen birincil kaynak ekler.
 */
export async function vakitleriCekOncelikli(yil: number, ay: number, ilceId: string, ilceAdi: string): Promise<Vakitler> {
  const kotaMusait = await kotaRezerveEt();
  if (!kotaMusait) {
    const mesaj = `Diyanet resmi API: aylık deneme kotası (${AYLIK_ISTEK_LIMITI}) dolu, mevcut zincire (emushaf/Aladhan) düşülüyor — hiçbir istek yapılmadı.`;
    console.warn(mesaj);
    await dususNedeniniKaydet('kota', mesaj);
    return aylikVakitleriCek(yil, ay, ilceId, ilceAdi);
  }

  try {
    const sonuc = await resmiDiyanetVakitleriCek(ilceId, ilceAdi);
    console.log(`Diyanet resmi API'den ${Object.keys(sonuc.gunler).length} gün alındı (ilceId=${ilceId}).`);
    return sonuc;
  } catch (err) {
    const hataMesaji = err instanceof Error ? err.message : String(err);
    console.warn('Diyanet resmi API başarısız, mevcut zincire (emushaf/Aladhan) düşülüyor:', hataMesaji);
    await dususNedeniniKaydet('hata', hataMesaji);
    return aylikVakitleriCek(yil, ay, ilceId, ilceAdi);
  }
}
