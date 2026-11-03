import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { ekranHazirBekle, lazyBolumleriTetikle } from './ekranHazirBekle.ts';
import { GORSEL_SABIT_TARIH } from './gorselSabitTarih.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bu paketin var oluş nedeni: premium denetim bölüm 2 — kod tabanında sıfır
// aria-live, SegmentedTabs'te ok-tuşu navigasyonu olmadan roving tabindex,
// form label ilişkilendirme eksiklikleri vb. CI'da HİÇBİRİ yakalanmıyordu
// (bkz. P0.6 eslint-plugin-jsx-a11y — statik analiz; bu dosya ÇALIŞMA
// ZAMANI/DOM tabanlı denetim, ikisi birbirini tamamlar).
let seed: { tokenAdmin: string; tokenMuezzin: string };
const browserConsoleIssues = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  // Seed ile aynı sabit tarih: suite gerçek gün değişiminden ve dış ezan API
  // verisinin kayan penceresinden bağımsız kalır. setFixedTime zamanlayıcıları
  // durdurmaz; Firebase bağlantı/retry döngüleri normal çalışmaya devam eder.
  const [yil, ay, gun] = GORSEL_SABIT_TARIH.split('-').map(Number);
  await page.clock.setFixedTime(new Date(Date.UTC(yil, ay - 1, gun, 8, 0, 0)));

  const issues: string[] = [];
  browserConsoleIssues.set(page, issues);
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      const sourceUrl = message.location().url;
      issues.push(`[${message.type()}] ${message.text()}${sourceUrl ? ` (${sourceUrl})` : ''}`);
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(browserConsoleIssues.get(page) ?? [], 'Tarayıcı konsolunda beklenmeyen warning/error bulundu').toEqual([]);
});

test.beforeAll(() => {
  const tsxCli = path.resolve(__dirname, '../../node_modules/tsx/dist/cli.mjs');
  const raw = execFileSync(process.execPath, [tsxCli, path.join(__dirname, 'seed-a11y.ts')], {
    encoding: 'utf8',
  }).trim();
  seed = JSON.parse(raw);
});

async function girisYap(page: Page, token: string) {
  await page.goto('/');
  await page.waitForFunction(() => window.__testSignIn !== undefined, { timeout: 15000 });
  await page.evaluate((t) => window.__testSignIn!(t), token);
  // signInWithCustomToken Auth oturumunu tamamlar; rolün Firestore
  // snapshot'ı ve AuthGuard geçişi ise ayrı asenkron adımdır. Hemen ardından
  // page.goto ile tam reload yapılırsa IndexedDB rol geri yüklemesi 6 sn'lik
  // failsafe ile yarışıp sayfayı kalıcı skeleton'da bırakabiliyor. Gerçek
  // authenticated kabuğun açıldığını beklemek bu yarışı kaynağında kapatır.
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 15_000 });
}

async function temaAyarla(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    localStorage.setItem('muezzin-theme-storage', JSON.stringify({ state: { theme: t }, version: 0 }));
  }, theme);
}

async function taramaYap(page: Page) {
  const calistir = () =>
    new AxeBuilder({ page })
      // WCAG 2.1 A/AA kapsamı — 'best-practice' kuralları (ör. bölge/landmark
      // önerileri) kasıtlı dışarıda: bunlar gerçek ihlal değil stil tercihi,
      // dahil edilirse CI gürültüsü gerçek regresyonları boğar.
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

  try {
    return await calistir();
  } catch (err) {
    // Lazy route chunk'ı (React.lazy) axe'in DOM'a script enjekte ettiği anla
    // çakışırsa "Execution context was destroyed" ile tarama çöküyor — bu bir
    // a11y ihlali değil, saf bir zamanlama yarışı. Kısa bir yerleşme payı
    // sonrası TEK seferlik yeniden dene.
    if (err instanceof Error && err.message.includes('Execution context was destroyed')) {
      await page.waitForTimeout(1000);
      return await calistir();
    }
    throw err;
  }
}

async function yatayTasmaBeklenmiyor(page: Page) {
  const olcum = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(olcum.documentWidth, `Belge viewport dışına taşıyor: ${JSON.stringify(olcum)}`).toBeLessThanOrEqual(olcum.viewport + 1);
  expect(olcum.bodyWidth, `Body viewport dışına taşıyor: ${JSON.stringify(olcum)}`).toBeLessThanOrEqual(olcum.viewport + 1);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`a11y — ${theme} tema`, () => {
    test(`giriş ekranı (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await page.goto('/');
      await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
      await yatayTasmaBeklenmiyor(page);

      const results = await taramaYap(page);
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });

    test(`ana ekran (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await girisYap(page, seed.tokenMuezzin);
      // `ekranHazirBekle` (ortak, bkz. visual.spec.ts) 'networkidle'ın
      // Firestore'un kalıcı WebChannel bağlantısı yüzünden hiç tetiklenmediği
      // bu sayfalarda gerçek sinyallere (iskelet kaybı, font yükleme) bağlı
      // bekler — önceden burada sabit bir `waitForTimeout(1500)` vardı.
      await ekranHazirBekle(page);
      await yatayTasmaBeklenmiyor(page);

      const results = await taramaYap(page);
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });

    test(`haftalık takvim (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await girisYap(page, seed.tokenMuezzin);
      await page.goto('/takvim');
      await ekranHazirBekle(page);
      await yatayTasmaBeklenmiyor(page);

      const results = await taramaYap(page);
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });

    test(`profil (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await girisYap(page, seed.tokenMuezzin);
      await page.goto('/profil');
      // Profil.tsx'teki PersonalHistoryCard bölümü `IntersectionObserver` ile
      // yalnızca viewport'a girince monte edilir (bkz. Profil.tsx LazySection
      // yorumu). Tek seferlik scroll, spinner→içerik büyüme yarışında erken
      // kalırsa gözlemci HİÇ ateşlenmez; hedef-başlıklı poll-scroll tetikleyicisi
      // iki yarışı da (boş sayfa, kısa sayfa) kapatır (bkz. ekranHazirBekle.ts
      // `lazyBolumleriTetikle`).
      await lazyBolumleriTetikle(page, page.getByText('KİŞİSEL HİZMET GÜNLÜĞÜ'));
      await ekranHazirBekle(page);
      await yatayTasmaBeklenmiyor(page);

      const results = await taramaYap(page);
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });

    test(`admin paneli (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await girisYap(page, seed.tokenAdmin);
      await page.goto('/admin');
      await ekranHazirBekle(page);
      await yatayTasmaBeklenmiyor(page);

      const results = await taramaYap(page);
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });

    test(`kadro yönetimi ve personel modalı (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await girisYap(page, seed.tokenAdmin);
      await page.goto('/admin?tab=ekip&subtab=kadro');
      await expect(page.getByRole('heading', { name: 'Kadro Yönetimi', level: 2 })).toBeVisible({ timeout: 15_000 });
      await ekranHazirBekle(page);
      await yatayTasmaBeklenmiyor(page);

      const sayfaSonuclari = await taramaYap(page);
      expect(sayfaSonuclari.violations, JSON.stringify(sayfaSonuclari.violations, null, 2)).toEqual([]);

      await page.getByRole('button', { name: 'YENİ PERSONEL TANIMLA' }).click();
      const dialog = page.getByRole('dialog', { name: 'Yeni Personel Tanımı' });
      await expect(dialog).toBeVisible();
      await yatayTasmaBeklenmiyor(page);

      const modalSonuclari = await taramaYap(page);
      expect(modalSonuclari.violations, JSON.stringify(modalSonuclari.violations, null, 2)).toEqual([]);
    });
  });
}
