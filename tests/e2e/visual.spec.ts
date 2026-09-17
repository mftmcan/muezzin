import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { GORSEL_SABIT_TARIH } from './gorselSabitTarih.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Görsel tasarım denetiminin (bkz. plan V14) beklediği görsel regresyon
 * kapsamı: 5 ekran × 2 tema. `!important` kaldırma (V20) gibi CSS-seviyesi
 * değişikliklerin "121 kullanım noktasından biri sessizce bozuldu" türü
 * regresyonları CI'da YAKALAMASI için — önceden bu sınıf bir hata (spatial-
 * glass'ın override'ları sessizce eziyor olması) yalnızca elle canlı DOM
 * testiyle bulunabiliyordu.
 *
 * Saat artık `saatiSabitle()` ile DONDURULUYOR (`page.clock.setFixedTime`).
 * Önceden `page.clock.pauseAt`/`install` denenmiş ve terk edilmişti çünkü
 * Date/setInterval/setTimeout'u TAMAMEN durduruyor, Firebase SDK'sının
 * bağlantı/retry zamanlayıcılarını da dondurup sayfanın #main-content'e hiç
 * ulaşmamasına yol açıyordu. `setFixedTime` FARKLI bir API: yalnızca
 * `Date`/`Date.now()`'u sabitler, gerçek zamanlayıcılar (Firebase dahil)
 * normal çalışmaya devam eder (bkz. Playwright resmi dokümantasyonu —
 * "the recommended approach is to use setFixedTime"). Sonuç: `mevcutVakit`,
 * görev akışı kart durumları, mazeret penceresi açık/kapalı gibi TÜM saat-
 * bağımlı render artık baseline üretimiyle CI karşılaştırması arasında
 * SABİT — 2026-09-15'te "Kişisel Görevlerim" bölümünün (maskelenmemiş,
 * `data-testid` bile taşımıyordu) saat ilerledikçe kart/düğme durumu
 * değiştirip sayfa YÜKSEKLİĞİNİ kaydırması ve baseline'ı defalarca kırması
 * üzerine eklendi (kök neden analizi: bu dosyanın PR'ı).
 *
 * `saatiSabitle` artık TARİHİ de sabitler — `gorselSabitTarih.ts`'teki TEK
 * gerçek-olmayan günü (Çarşamba) SAAT ile (Türkiye saatiyle 11:00,
 * güneş[06:30]-öğle[13:02] arası, her iki kerahat penceresinden de uzak)
 * birlikte dondurur, SABIT_TARIH (seed-visual.ts) AYNI günü kullanır —
 * ikisi birbirine bağımlı, tarih ile saat uyuşmazsa uygulama "bugünün
 * vakit tablosu yok" durumuna düşer. Önceden yalnızca SAAT donduruluyor,
 * TARİH gerçek "bugün"e bağlı kalıyordu — bu yüzden "Kişisel Görevlerim"
 * (ana ekran) ve gün numarası/"BUGÜN" rozeti (haftalık takvim) her gerçek
 * takvim günü ilerledikçe baseline'dan kaçınılmaz olarak sapıp CI'ı
 * kırıyordu (bkz. gorselSabitTarih.ts — 2026-09-16 CI kök neden analizi).
 * Tarih artık sabit olduğundan bayram/kandil ve Cuma'ya özgü kenar durumları
 * da kalıcı olarak devre dışı (seçilen gün bilerek Çarşamba) — `display:none`
 * zorlaması (aşağıda) yine de savunma amaçlı duruyor.
 *
 * LiveClock/geri sayım rakamları saat donduğundan artık pratikte hiç
 * TİKLEMİYOR (her okuma aynı sabit anı döndürüyor) — ama maskeler
 * (`saniyeMaskeleri`) savunma amaçlı KALDIRILMADI: `Date` dışında bir
 * zaman kaynağı (`performance.now()` vb.) kullanan olası bir bileşen için
 * ek güvenlik katmanı.
 */
let seed: { tokenAdmin: string; tokenMuezzin: string };

test.beforeAll(() => {
  const raw = execFileSync('npx', ['tsx', path.join(__dirname, 'seed-visual.ts')], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim();
  seed = JSON.parse(raw);
});

async function temaAyarla(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    localStorage.setItem('muezzin-theme-storage', JSON.stringify({ state: { theme: t }, version: 0 }));
  }, theme);
}

// Türkiye UTC+3 sabit (DST yok) — "11:00 Türkiye" = "08:00 UTC". Runner'ın
// yerel saat dilimine bağlı kalmamak için doğrudan Date.UTC ile inşa edilir.
// Tarih kısmı GORSEL_SABIT_TARIH'ten gelir — SABIT_TARIH (seed-visual.ts)
// ile AYNI (gerçek-olmayan) güne denk gelmesi ZORUNLU.
async function saatiSabitle(page: Page) {
  const [yil, ay, gun] = GORSEL_SABIT_TARIH.split('-').map(Number);
  const donmusAn = new Date(Date.UTC(yil, ay - 1, gun, 8, 0, 0));
  await page.clock.setFixedTime(donmusAn);
  // Burada AYRICA `globalThis.__timeOffset`'i salt-okunur 0'a sabitleyen bir
  // `addInitScript` bantajı vardı. Gerekçesi: `src/lib/timeSync.ts`
  // (initTimeSync, App.tsx'te her sayfa yüklemesinde çalışır) gerçek Firebase
  // RTDB sunucusuna bağlanıp GERÇEK saat farkını `__timeOffset`'e yazıyor,
  // `getTurkeyNow()` de bunu mocklanmış Date'e EKLİYORDU — sahte tarihimiz
  // (GORSEL_SABIT_TARIH) gerçek "bugün"den aylarca uzak olduğu için offset
  // gelir gelmez dondurmayı sessizce iptal edip sayfayı GERÇEK tarihe geri
  // döndürüyordu (bkz. 2026-09-16 CI: ana-ekran başlığı "16 Eylül 2026"
  // gösterip vakit verisi bulunamadığından sonsuz "güncelleniyor"
  // spinner'ına düşüyordu).
  //
  // Bantaj KALDIRILDI çünkü kök neden kaynağında çözüldü: `initTimeSync()`
  // artık `VITE_USE_EMULATOR === '1'` iken RTDB'ye HİÇ bağlanmıyor, yani
  // emülatör modunda `__timeOffset` hiç yazılmıyor ve `dateUtils.ts` onu
  // kalıcı olarak 0 kabul ediyor. Aynı kök neden mazeret-flow.spec.ts'te de
  // ayrı bir bantajla (RTDB host'una giden istek/WebSocket'i abort etme)
  // örtülmüştü, o da kaldırıldı.
}

async function girisYap(page: Page, token: string) {
  await page.goto('/');
  await page.waitForFunction(() => window.__testSignIn !== undefined, { timeout: 15000 });
  await page.evaluate((t) => window.__testSignIn!(t), token);
}

function saniyeMaskeleri(page: Page) {
  return [page.getByTestId('live-clock'), page.getByTestId('countdown-timer')];
}

// `saniyeMaskeleri`nin ötesinde, yalnızca "ana ekran"a özgü iki bölge daha
// vakit bazlı (saniyelik değil ama günde ~6 kez) değişiyor: vakit matrisindeki
// aktif/sıradaki vurgusu ve geri sayım halkasının rengi/ilerlemesi + dönem
// başlığı (`geri-sayim`, `countdown-timer`'ı da kapsar). Maskelenmezse
// baseline yalnızca üretildiği vaktin penceresinde geçerli kalır, bir sonraki
// vakte geçildiğinde gerçek bir regresyon olmadan CI'ı kırar.
function anaEkranMaskeleri(page: Page) {
  return [...saniyeMaskeleri(page), page.getByTestId('vakit-matrisi'), page.getByTestId('geri-sayim')];
}

const SS_OPTS = { maxDiffPixelRatio: 0.02 } as const;

// Ekran görüntüsünden hemen önceki TEK sabit bekleme. `reducedMotion:'reduce'`
// ve `toHaveScreenshot`'ın `animations:'disabled'`'ı transform animasyonlarını
// ve CSS/WAAPI geçişlerini durdurur, ama motion/react `reducedMotion="user"`
// altında OPAKLIK geçişlerini bilerek oynatmaya devam eder (bkz. App.tsx
// MotionConfig). Bu paydaki en uzun opaklık geçişi AnaEkranHero'nun
// yükleniyor→içerik `AnimatePresence` geçişi (0.55s) — 700ms onu kapsar.
// DİKKAT: bu, "veri gelsin diye bekleme" DEĞİLDİR; veri beklemesi aşağıdaki
// `ekranHazirBekle` içinde tamamen sinyale bağlıdır. Bu ayrım önemli: eski
// `waitForTimeout(3000)` İKİ işi birden yapıyordu ve CI'da emülatörün
// değişken teslim süresiyle yarıştığı için defalarca kırıldı.
const YERLESME_PAYI_MS = 700;

/**
 * "Ekran gerçekten yüklendi" beklemesi — keyfi süre YOK.
 *
 * Katmanlar:
 *  1. `#main-content` (Layout) DOM'a girdi mi,
 *  2. `data-ekran-hazir` bayrağı (yalnızca onu taşıyan sayfalarda): ilgili
 *     sayfanın TÜM Firestore kaynakları ilk snapshot'ını teslim etti mi
 *     (MuezzinAnaEkran.tsx / AdminPanel.tsx — salt test-gözlemlenebilirliği),
 *  3. `.skeleton-shimmer`: lazy modül Suspense fallback'leri ve liste
 *     iskeletleri DOM'dan çıktı mı (iç içe alt modülleri de kapsar),
 *  4. web fontları yüklendi mi (yüklenmemiş font metin genişliğini ve
 *     dolayısıyla sayfa yüksekliğini kaydırır),
 *  5. tek, kısa ve gerekçeli animasyon yerleşme payı.
 *
 * `toHaveCount(0)` hiç eşleşme olmayan sayfada anında geçer — bu yüzden
 * bayrağı/iskeleti olmayan ekranlarda da güvenle çağrılabilir.
 */
async function ekranHazirBekle(page: Page) {
  await page.waitForSelector('#main-content');
  await expect(page.locator('[data-ekran-hazir="hayir"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.skeleton-shimmer')).toHaveCount(0, { timeout: 20_000 });
  // `document.fonts.ready` bir FontFaceSet'e çözülür — serialize edilemediği
  // için bilerek undefined'a düşürülüyor.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(YERLESME_PAYI_MS);
}

// App.tsx'teki `<MotionConfig reducedMotion="user">` tüm motion/react
// animasyonlarını `prefers-reduced-motion` tercihine bağlıyor — burada
// context'i 'reduce' olarak emüle etmek giriş/stagger animasyonlarını
// (ör. HaftalikTakvim.tsx'teki her gün kartının `delay: idx*0.05` ile
// kayarak belirmesi) neredeyse anlık hale getirir. Playwright'ın
// `toHaveScreenshot` varsayılan `animations:'disabled'`'ı yalnızca CSS
// animasyon/geçişlerini ve Web Animations API'yi durdurur, motion/react'in
// kendi rAF/WAAPI sürüşünü KAPSAMAZ — bu yüzden onsuz haftalık takvim gibi
// stagger'lı sayfalarda ekran görüntüsü animasyon yarı yoldayken
// yakalanabiliyordu (bkz. 2026-09-16 CI koşusu köküneden analizi).
test.use({ contextOptions: { reducedMotion: 'reduce' } });

// `@gorsel` etiketi, CI'ın bu dosyayı diğer e2e testlerinden AYIRMASINI
// sağlar (.github/workflows/test.yml): fonksiyonel e2e `--grep-invert @gorsel`
// ile deploy'u BLOKLAYAN `test` job'ında, görsel regresyon ise `--grep @gorsel`
// ile deploy'u bloklamayan ayrı bir job'da koşar. Ayrım BİLEREK dosya
// yoluyla/test başlığıyla değil etiketle yapılıyor: yeni eklenen bir spec
// dosyası hiçbir şey yapılmadan fonksiyonel (bloklayan) tarafa düşer —
// yani varsayılan FAIL-CLOSED'dır; bir testin deploy kapısından çıkması
// ancak bu etiketin BİLİNÇLİ olarak eklenmesiyle olur.
for (const theme of ['light', 'dark'] as const) {
  test.describe(`görsel — ${theme} tema`, { tag: '@gorsel' }, () => {
    test(`giriş ekranı (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await saatiSabitle(page);
      await page.goto('/');
      await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
      await expect(page).toHaveScreenshot(`giris-${theme}.png`, SS_OPTS);
    });

    test(`ana ekran (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await saatiSabitle(page);
      await girisYap(page, seed.tokenMuezzin);
      // 'networkidle' Firestore'un kalıcı WebChannel bağlantısı yüzünden hiç
      // tetiklenmiyor (bkz. a11y.spec.ts'teki aynı not). Önceden burada
      // `#main-content` + KEYFİ bir yerleşme payı vardı; pay 1500ms'ten
      // 3000ms'e çıkarılmıştı çünkü CI'da emülatörün ilk Firestore verisini
      // teslim etme süresi değişken ve 1500ms bazen yetmeyip sayfayı
      // yükleniyor durumundayken yakalıyordu (ör. admin-paneli-dark 1217px
      // yerine 2728px, haftalik-takvim-light 1306px yerine 2394px — gerçek
      // regresyon değil, bu yarış koşuluydu, bkz. 2026-09-15 CI koşu
      // geçmişi). Sabit süreyi BÜYÜTMEK bu sınıfı çözmez, yalnızca yarışın
      // kaybedilme olasılığını düşürür — bekleme artık gerçek bir "veri
      // yüklendi" sinyaline bağlı.
      await ekranHazirBekle(page);
      // OzelVakitBanner (kerahat/teheccüd/bayram) ve RamazanHub, gerçek
      // saatle karşılaştırılarak KOŞULLU monte ediliyor — `mask` yalnızca
      // var olan pikselleri kapatabilir, DOM'a hiç girmeyen/çıkan bir
      // bölümün toplam sayfa YÜKSEKLİĞİNİ değiştirmesini engelleyemez. Baseline
      // üretimiyle bir sonraki CI çalıştırması arasında bir pencere açılıp
      // kapanırsa ~800px'lik bir yükseklik farkı oluşup gerçek bir regresyon
      // olmadan testi kırıyordu (bkz. performans/deploy denetimi). Bu yüzden
      // ekran görüntüsünden hemen önce bu iki bölge DOM'dan kaldırılmış gibi
      // (display:none) gizlenir — sıfır-veya-daha-fazla eşleşmede de güvenli.
      await page.locator('[data-testid="ozel-vakit-banner"], [data-testid="ramazan-hub"]').evaluateAll((els) => {
        els.forEach((el) => {
          (el as HTMLElement).style.display = 'none';
        });
      });
      await expect(page).toHaveScreenshot(`ana-ekran-${theme}.png`, {
        ...SS_OPTS,
        fullPage: true,
        mask: anaEkranMaskeleri(page),
      });
    });

    test(`haftalık takvim (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await saatiSabitle(page);
      await girisYap(page, seed.tokenMuezzin);
      await page.goto('/takvim');
      // Sabit 3000ms, emülatörün plan/bildirim verisini geç teslim ettiği
      // durumlarda HaftalikTakvim.tsx'in `AnimatePresence` "loading"
      // iskeletinden "plan" içeriğine geçişini kaçırıp ekran görüntüsünü
      // hâlâ iskelet (`.skeleton-shimmer`) gösterirken yakalayabiliyordu
      // (bkz. 2026-09-16 CI: %3 piksel farkı). İskeletin gerçekten
      // kaybolmasını bekleme artık ortak `ekranHazirBekle` içinde.
      await ekranHazirBekle(page);
      await expect(page).toHaveScreenshot(`haftalik-takvim-${theme}.png`, { ...SS_OPTS, fullPage: true });
    });

    test(`profil (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await saatiSabitle(page);
      await girisYap(page, seed.tokenMuezzin);
      await page.goto('/profil');
      // Profil.tsx `loading` (auth + muezzin store senkronu) true olduğu
      // sürece tam içerik yerine "VERİLER SENKRONİZE EDİLİYOR" spinner'ını
      // (çok daha kısa bir sayfa yüksekliğiyle) gösteriyor. Sabit 3000ms
      // emülatörün gecikmesiyle yarışıyordu ve bazen spinner hâlâ
      // ekrandayken yakalanıyordu (bkz. 2026-09-16 CI: 1655px yerine
      // 823px). Bu spinner bir `.skeleton-shimmer` DEĞİL (ekranHazirBekle
      // onu göremez), bu yüzden sayfaya özgü bekleme burada kalıyor —
      // hiç görünmediyse `toBeHidden` anında geçer.
      await expect(page.getByText('VERİLER SENKRONİZE EDİLİYOR')).toBeHidden({ timeout: 15000 });
      // Profil.tsx'teki `LazySection`, `PersonalHistoryCard`'ı yalnızca bir
      // `IntersectionObserver` ile viewport'a girince monte eder (performans
      // için kasıtlı — bkz. Profil.tsx yorumu). `mobile-chrome`'un dar/kısa
      // viewport'unda bu bölüm sayfa yüklenince görünür alanın dışında
      // kalıyor; `toHaveScreenshot({fullPage:true})` scroll'u KENDİ İÇİNDE
      // yönetir ama bu, IntersectionObserver'ın (root'u varsayılan viewport)
      // ateşlenmesini garanti etmiyor — sonuç: `.skeleton-shimmer` (Suspense
      // fallback'i) hiç kaybolmuyor, `ekranHazirBekle` 20 sn'de zaman aşımına
      // uğruyordu (bkz. 2026-09-17 baseline-yenileme koşusu). Gerçek
      // kullanıcı için sorun değil (fiilen scroll etmek observer'ı tetikler)
      // — burada yalnızca ekran görüntüsünden önce aynı tetiklemeyi elle
      // (deterministik) yapıyoruz.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await ekranHazirBekle(page);
      await expect(page).toHaveScreenshot(`profil-${theme}.png`, { ...SS_OPTS, fullPage: true });
    });

    test(`admin paneli (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await saatiSabitle(page);
      await girisYap(page, seed.tokenAdmin);
      await page.goto('/admin');
      // "GERÇEKTEN admin panelindeyiz" kapısı — `ekranHazirBekle`'DEN ÖNCE VE
      // SONRA. Gerekçe (yerelde gözlemlendi, bu testin geçmişteki
      // açıklanamayan kırılmalarının da muhtemel sebebi): AdminPanel,
      // `!authLoading && isAdmin === false` iken kendini `/`'a yönlendiriyor
      // (AdminPanel.tsx). Tam sayfa yeniden yüklemede rol Firestore'dan
      // gelene kadar `isAdmin` false; normalde `authLoading` true olduğu için
      // yönlendirme tetiklenmiyor, AMA useAuthStore'un 6 sn'lik "snapshot
      // failsafe"i devreye girerse `loading` rol ÇÖZÜLMEDEN false'a düşüyor
      // ve panel gerçekten ana ekrana geri atıyor. O durumda test sessizce
      // YANLIŞ sayfayı (müezzin ana ekranı) bekliyor/çekiyordu — hata
      // "toHaveCount(0) başarısız" gibi tamamen alakasız görünüyordu.
      // `document.title` yalnızca /admin rotasında bu değeri alıyor (App.tsx
      // ROUTE_TITLES), viewport'tan bağımsız ve yönlendirmede hemen geri
      // dönüyor — yani bu iki satır hatayı gerçek sebebiyle raporlar.
      // NOT: bu, uygulamadaki yarışı ÇÖZMEZ, yalnızca görünür kılar.
      await expect(page).toHaveTitle(/Yönetim Paneli/, { timeout: 15_000 });
      // Ana ekrandaki ile aynı gerekçe (bkz. yukarıdaki not) — admin panelinin
      // `data-ekran-hazir` bayrağı müezzin/alarm/izin store'larının ilk
      // snapshot'ını ve `useTransition` sekme geçişini de kapsıyor.
      await ekranHazirBekle(page);
      await expect(page).toHaveTitle(/Yönetim Paneli/);
      await expect(page).toHaveScreenshot(`admin-paneli-${theme}.png`, {
        ...SS_OPTS,
        fullPage: true,
        mask: saniyeMaskeleri(page),
      });
    });
  });
}
