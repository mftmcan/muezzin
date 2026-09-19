import { expect, type Page } from '@playwright/test';

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
export const YERLESME_PAYI_MS = 700;

/**
 * "Ekran gerçekten yüklendi" beklemesi — keyfi süre YOK.
 *
 * `visual.spec.ts` ve `a11y.spec.ts` ORTAK bu fonksiyonu kullanır — önceden
 * a11y.spec.ts kendi `waitForSelector('#main-content') + waitForTimeout(1500)`
 * kopyasını taşıyordu (4 testte birebir aynı 3 satır), bu da CLAUDE.md'nin
 * yasakladığı "veri gelsin diye bekleme" kalıbıydı (bkz. kod denetimi,
 * premium/kurumsal SaaS standardı analizi).
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
export async function ekranHazirBekle(page: Page) {
  await page.waitForSelector('#main-content');
  await expect(page.locator('[data-ekran-hazir="hayir"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.skeleton-shimmer')).toHaveCount(0, { timeout: 20_000 });
  // `document.fonts.ready` bir FontFaceSet'e çözülür — serialize edilemediği
  // için bilerek undefined'a düşürülüyor.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(YERLESME_PAYI_MS);
}
