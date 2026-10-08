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
 * `IntersectionObserver`'la kademeli yüklenen bölümleri (bkz. Profil.tsx
 * `LazySection`) DETERMİNİSTİK biçimde tetikler: hedef bölümün içeriği
 * (ör. 'KİŞİSEL HİZMET GÜNLÜĞÜ' başlığı) DOM'a girene dek sayfanın altına
 * tekrar tekrar scroll eder.
 *
 * Neden "skeleton kalmayınca çık" YANLIŞ, "hedef görünene dek sürdür"
 * DOĞRU (bkz. 2026-10-08 CI koşusu 37830747078 ve teşhisi): profil sayfası
 * "VERİLER SENKRONİZE EDİLİYOR" spinner'ından ~2400px'lik içeriğe büyür ve
 * spinner-döneminde sayfa tamamen boşken `.skeleton-shimmer` sayısı ZATEN
 * 0'dır — skeleton-0 koşulu boş sayfada anında geçer, yardımcı TEK scroll
 * bile yapmadan çıkar; bölümler SONRA mount olur, gözlemci hiçbir zaman
 * scroll görmez ve `ekranHazirBekle` 20 sn'de zaman aşımına düşer. Hedef
 * başlık yalnızca lazy bölüm monte olup verisini istemeye başladığında
 * görünür — o ana ulaşana dek sürmek iki yarışı da (boş sayfa, kısa sayfa)
 * kapatır.
 *
 * Bu işlev kendisi bir "veri bekleme" DEĞİLDİR: verinin hazır olduğu yine
 * `ekranHazirBekle`'nin sinyal-bağlı iddialarıyla doğrulanır. Hedef hiç
 * görünmezse (gerçek bir hata) döngü biter ve `ekranHazirBekle` önceki gibi
 * düşer — hata maskelenmez.
 */
export async function lazyBolumleriTetikle(page: Page, hedef: { count(): Promise<number> }, toplamSureMs = 20_000) {
  const adimMs = 400;
  for (let gecen = 0; gecen < toplamSureMs; gecen += adimMs) {
    if ((await hedef.count()) > 0) return;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(adimMs);
  }
}

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
