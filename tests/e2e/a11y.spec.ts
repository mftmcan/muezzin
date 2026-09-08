import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bu paketin var oluş nedeni: premium denetim bölüm 2 — kod tabanında sıfır
// aria-live, SegmentedTabs'te ok-tuşu navigasyonu olmadan roving tabindex,
// form label ilişkilendirme eksiklikleri vb. CI'da HİÇBİRİ yakalanmıyordu
// (bkz. P0.6 eslint-plugin-jsx-a11y — statik analiz; bu dosya ÇALIŞMA
// ZAMANI/DOM tabanlı denetim, ikisi birbirini tamamlar).
let seed: { tokenAdmin: string; tokenMuezzin: string };

test.beforeAll(() => {
  const raw = execFileSync('npx', ['tsx', path.join(__dirname, 'seed-a11y.ts')], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim();
  seed = JSON.parse(raw);
});

async function girisYap(page: Page, token: string) {
  await page.goto('/');
  await page.waitForFunction(() => window.__testSignIn !== undefined, { timeout: 15000 });
  await page.evaluate((t) => window.__testSignIn!(t), token);
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

for (const theme of ['light', 'dark'] as const) {
  test.describe(`a11y — ${theme} tema`, () => {
    test(`giriş ekranı (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await page.goto('/');
      await expect(page.getByRole('button', { name: /google/i })).toBeVisible();

      const results = await taramaYap(page);
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });

    test(`ana ekran (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await girisYap(page, seed.tokenMuezzin);
      // 'networkidle' Firestore'un kalıcı WebChannel bağlantısı yüzünden
      // hiç tetiklenmiyor (gerçek zamanlı onSnapshot dinleyicileri ağı asla
      // "boşta" bırakmıyor) — Layout.tsx'in her zaman render ettiği
      // #main-content'i (bkz. P1.13 skip-link hedefi) bekleyip kısa bir
      // yerleşme payı vermek daha güvenilir.
      await page.waitForSelector('#main-content');
      await page.waitForTimeout(1500);

      const results = await taramaYap(page);
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });

    test(`haftalık takvim (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await girisYap(page, seed.tokenMuezzin);
      await page.goto('/takvim');
      // 'networkidle' Firestore'un kalıcı WebChannel bağlantısı yüzünden
      // hiç tetiklenmiyor (gerçek zamanlı onSnapshot dinleyicileri ağı asla
      // "boşta" bırakmıyor) — Layout.tsx'in her zaman render ettiği
      // #main-content'i (bkz. P1.13 skip-link hedefi) bekleyip kısa bir
      // yerleşme payı vermek daha güvenilir.
      await page.waitForSelector('#main-content');
      await page.waitForTimeout(1500);

      const results = await taramaYap(page);
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });

    test(`profil (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await girisYap(page, seed.tokenMuezzin);
      await page.goto('/profil');
      // 'networkidle' Firestore'un kalıcı WebChannel bağlantısı yüzünden
      // hiç tetiklenmiyor (gerçek zamanlı onSnapshot dinleyicileri ağı asla
      // "boşta" bırakmıyor) — Layout.tsx'in her zaman render ettiği
      // #main-content'i (bkz. P1.13 skip-link hedefi) bekleyip kısa bir
      // yerleşme payı vermek daha güvenilir.
      await page.waitForSelector('#main-content');
      await page.waitForTimeout(1500);

      const results = await taramaYap(page);
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });

    test(`admin paneli (${theme})`, async ({ page }) => {
      await temaAyarla(page, theme);
      await girisYap(page, seed.tokenAdmin);
      await page.goto('/admin');
      // 'networkidle' Firestore'un kalıcı WebChannel bağlantısı yüzünden
      // hiç tetiklenmiyor (gerçek zamanlı onSnapshot dinleyicileri ağı asla
      // "boşta" bırakmıyor) — Layout.tsx'in her zaman render ettiği
      // #main-content'i (bkz. P1.13 skip-link hedefi) bekleyip kısa bir
      // yerleşme payı vermek daha güvenilir.
      await page.waitForSelector('#main-content');
      await page.waitForTimeout(1500);

      const results = await taramaYap(page);
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  });
}
