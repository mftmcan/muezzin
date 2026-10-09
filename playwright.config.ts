import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  // HER ZAMAN 1 worker — yalnızca CPU/ağ kaynak çekişmesi için değil
  // (bkz. önceki CI flake'leri), asıl gerekçe: spec'lerin seed script'leri
  // AYNI emülatörde AYNI deterministik belge ID'lerine yazıyor (ör. hem
  // seed-mazeret.ts hem seed-vekalet.ts `bildirimler/${haftaId}_${todayStr}_
  // yatsi_asil` belgesine yazar; seed-haftalik-plan.ts'in clearWeekBildirimleri
  // bugünkü haftanın TÜM bildirimlerini süpürür). Paralel koşumda bir spec'in
  // seed'i diğerininkini silebilir/ezebilir — bu, workers>1 ile tekrarlanabilir
  // bir veri yarışı üretir. Küçük test setinde hız kaybı ihmal edilebilir
  // (sıralı koşum ~3 dk); karlılık değil kararlılık esastır.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: process.platform === 'win32' ? 'npm.cmd run dev' : 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 120_000,
    // E2E testleri production Firestore/Auth'a değil, yerel emülatörlere
    // karşı çalışsın (bkz. src/lib/firebase.ts, tests/e2e/seed-mazeret.ts).
    // Emülatörlerin de `firebase emulators:start --only firestore,auth`
    // ile ayrıca çalışıyor olması gerekir (bkz. .github/workflows/test.yml).
    env: {
      VITE_USE_EMULATOR: '1',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
