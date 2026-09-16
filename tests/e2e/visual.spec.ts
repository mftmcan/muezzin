import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

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
 * `saatiSabitle`, TARİHİ değiştirmez — SABIT_TARIH (seed-visual.ts) hâlâ
 * gerçek "bugün"e yazılıyor, yalnızca SAAT'i (Türkiye saatiyle 11:00,
 * güneş[06:30]-öğle[13:02] arası, her iki kerahat penceresinden de uzak)
 * sabitliyoruz — tarih ile saat uyuşmazsa uygulama "bugünün vakit tablosu
 * yok" durumuna düşer. Bilinen KALAN sınır: gerçek "bugün" bir bayram/kandil
 * gününe denk gelirse (tarihe bağlı, saate bağlı değil) özel banner'lar yine
 * tetiklenebilir — bunun için `display:none` zorlaması (aşağıda) hâlâ
 * duruyor. Gerçek "bugün" Cuma'ya denk gelirse Cuma'ya özgü vurgular da
 * (tarihe bağlı, saate bağlı değil) etkilenebilir — bu, saat dondurmanın
 * kapsamı dışında, önceden de var olan bilinen bir sınır.
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
// Tarih kısmı `new Date()`'in UTC bileşenlerinden alınır — SABIT_TARIH
// (seed-visual.ts) ile aynı "bugün"e denk gelmesi ZORUNLU.
async function saatiSabitle(page: Page) {
  const simdi = new Date();
  const donmusAn = new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth(), simdi.getUTCDate(), 8, 0, 0));
  await page.clock.setFixedTime(donmusAn);
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

for (const theme of ['light', 'dark'] as const) {
  test.describe(`görsel — ${theme} tema`, () => {
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
      // tetiklenmiyor (bkz. a11y.spec.ts'teki aynı not) — #main-content'i
      // bekleyip kısa bir yerleşme payı vermek daha güvenilir. Pay 1500ms'den
      // 3000ms'e çıkarıldı: CI'da emülatörün ilk Firestore verisini
      // teslim etme süresi değişken — 1500ms bazen yetmeyip sayfayı yükleniyor
      // durumundayken yakalıyordu (ör. admin-paneli-dark 1217px yerine 2728px,
      // haftalik-takvim-light 1306px yerine 2394px — her ikisi de gerçek bir
      // regresyon değil, bu yarış koşuluydu, bkz. 2026-09-15 CI koşu geçmişi).
      await page.waitForSelector('#main-content');
      await page.waitForTimeout(3000);
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
      await page.waitForSelector('#main-content');
      // Sabit 3000ms, emülatörün plan/bildirim verisini geç teslim ettiği
      // durumlarda HaftalikTakvim.tsx'in `AnimatePresence` "loading"
      // iskeletinden "plan" içeriğine geçişini kaçırıp ekran görüntüsünü
      // hâlâ iskelet (`.skeleton-shimmer`) gösterirken yakalayabiliyordu
      // (bkz. 2026-09-16 CI: %3 piksel farkı). Sabit süre yerine iskeletin
      // gerçekten kaybolmasını bekle — zaten yoksa (yükleme daha önce
      // bittiyse) `toBeHidden` anında geçer.
      await expect(page.locator('.skeleton-shimmer').first()).toBeHidden({ timeout: 15000 });
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`haftalik-takvim-${theme}.png`, { ...SS_OPTS, fullPage: true });
    });

    test(`profil (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await saatiSabitle(page);
      await girisYap(page, seed.tokenMuezzin);
      await page.goto('/profil');
      await page.waitForSelector('#main-content');
      // Profil.tsx `loading` (auth + muezzin store senkronu) true olduğu
      // sürece tam içerik yerine "VERİLER SENKRONİZE EDİLİYOR" spinner'ını
      // (çok daha kısa bir sayfa yüksekliğiyle) gösteriyor. Sabit 3000ms
      // emülatörün gecikmesiyle yarışıyordu ve bazen spinner hâlâ
      // ekrandayken yakalanıyordu (bkz. 2026-09-16 CI: 1655px yerine
      // 823px). Spinner metninin kaybolmasını bekle — hiç görünmediyse
      // `toBeHidden` anında geçer.
      await expect(page.getByText('VERİLER SENKRONİZE EDİLİYOR')).toBeHidden({ timeout: 15000 });
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`profil-${theme}.png`, { ...SS_OPTS, fullPage: true });
    });

    test(`admin paneli (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await saatiSabitle(page);
      await girisYap(page, seed.tokenAdmin);
      await page.goto('/admin');
      await page.waitForSelector('#main-content');
      await page.waitForTimeout(3000);
      await expect(page).toHaveScreenshot(`admin-paneli-${theme}.png`, {
        ...SS_OPTS,
        fullPage: true,
        mask: saniyeMaskeleri(page),
      });
    });
  });
}
