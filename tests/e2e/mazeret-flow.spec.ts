import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * seed-mazeret.ts her zaman BUGÜN için bir görev seed eder ("Kişisel
 * Görevlerim" ekranı yalnızca bugünün görevlerini gösterdiğinden başka bir
 * gün seçilemez — bkz. useBugunkuGorevlerim.ts). mazeretKurallari.ts'teki
 * kural ise Cuma günleri mazeret bildirimini asil/yedek fark etmeksizin HER
 * ZAMAN kapatır (bkz. CLAUDE.md "Mazeret / Cuma kısıtlaması"). Bu ikisi bir
 * araya gelince: bu test her Cuma günü, production kodunda hiçbir hata
 * olmadan, salt kuralın doğru çalışması yüzünden "KAYDI TAMAMLA" adımında
 * başarısız oluyordu (bkz. E2E flakiness soruşturması). Kalıcı çözüm için
 * seed'in başka bir günü hedeflemesi mümkün değil (görev bugün olmak
 * zorunda) — bu yüzden akış yalnızca Cuma günleri atlanıyor.
 */
function turkeyIsFridayNow(): boolean {
  const turkeyMs = Date.now() + 3 * 60 * 60 * 1000; // UTC+3 sabit ofset (bkz. seed-mazeret.ts turkeyTodayStr)
  return new Date(turkeyMs).getUTCDay() === 5; // 0=Pazar ... 5=Cuma
}

/**
 * Aynı sınıftan ikinci bir zaman-bağımlı kırılganlık: seed her zaman bugünün
 * YATSI görevini hedefliyor, mazeretKurallari.ts'teki kural ise sabah dışı
 * vakitlerde pencereyi ezana MAZERET_SON_BASVURU_DAKIKA (60dk) kala kapatıyor.
 * Yani günün son ~birkaç saatinde (bugünün gerçek Yatsı ezanına 1 saatten az
 * kala/sonrasında) bu akış, kodda hiçbir hata olmadan, kuralın doğru
 * çalışması yüzünden "Mazeretiniz kaydedildi" adımında başarısız oluyordu
 * (bkz. 2026-08-08 CI koşuları — dock/test CSS değişiklikleriyle hiç ilgisi
 * olmayan bu test, sırf Yatsı'ya 1 saatten az kaldığı için kırmızı verdi).
 *
 * İlk düzeltme denemesi (bu testin kendi içinde ayrı bir Node-side fetch ile
 * pencereyi tahmin edip dinamik skip yapmak) YETERSİZ kaldı — çünkü asıl
 * kapanma kararı `mazeretServisi.ts`'teki gerçek uygulama kodunda TARAYICI
 * içinde, GorevKarti'nin zaten canlı çektiği (useVakitStore → gerçek Diyanet
 * API'si) `saat` prop'una göre veriliyor; testin kendi ayrı fetch'i CI
 * ortamında bu gerçek kararla senkron kalmayabiliyordu.
 *
 * İkinci deneme (yalnızca `page.clock.setFixedTime` ile "bugün saat 10:00"a
 * dondurmak) da YETERSİZ kaldı — bu sefer BAŞKA bir mekanizma yüzünden:
 * `src/lib/timeSync.ts`'teki `initTimeSync()`, Firebase Realtime Database'in
 * `.info/serverTimeOffset`'ini dinleyip cihaz saat kaymasını düzeltmek için
 * `globalThis.__timeOffset`'i GERÇEK sunucu saatiyle senkronize ediyor
 * (bkz. `getTurkeyNow()` bu offset'i her zaman ekliyor). RTDB emülatörü CI'da
 * ÇALIŞMIYOR (yalnızca firestore+auth emüle ediliyor — bkz. test.yml), yani
 * bu senkron GERÇEK production RTDB'ye bağlanıp donmuş saatimizi anında
 * gerçek saate geri düzeltiyordu (CI logundaki başarısız koşuda sayfa hâlâ
 * gerçek "20:50" gösteriyordu, dondurma hiç işe yaramamıştı). Kalıcı çözüm:
 * dondurmayı işe yaramaz kılan bu senkronu, RTDB'ye giden isteği/WebSocket
 * bağlantısını engelleyerek devre dışı bırakmak — `__timeOffset` hiç
 * atanmadığı için `dateUtils.ts`'teki `!== undefined` kontrolü sayesinde 0
 * kabul ediliyor ve dondurduğumuz saat artık gerçekten kalıcı oluyor.
 */
function turkeyFixedMorning(): Date {
  const turkeyMs = Date.now() + 3 * 60 * 60 * 1000; // seed-mazeret.ts turkeyTodayStr ile aynı "bugün"
  const turkey = new Date(turkeyMs);
  // 10:00 Türkiye saati (UTC+3) == 07:00 UTC, aynı Türkiye takvim günü içinde.
  return new Date(Date.UTC(turkey.getUTCFullYear(), turkey.getUTCMonth(), turkey.getUTCDate(), 7, 0, 0));
}

/** src/lib/timeSync.ts'in bağlandığı gerçek RTDB host'u (bkz. firebase-applet-config.json databaseURL). */
const RTDB_HOST_PATTERN = /firebasedatabase\.app|firebaseio\.com/;

test.describe('Mazeret Akışı E2E', () => {
  test.skip(
    turkeyIsFridayNow(),
    'Mazeret bildirimi Cuma günleri kural gereği her zaman kapalı — seed bugün için görev oluşturduğundan bu akış Cuma günü test edilemez.'
  );

  let customToken: string;

  test.beforeAll(() => {
    // Emülatörleri seed'ler ve gerçek bir Firebase Auth custom token üretir.
    // (Bu test yalnızca VITE_USE_EMULATOR=1 ile başlatılan bir dev server'a
    // ve çalışan firestore+auth emülatörlerine karşı anlamlıdır — bkz.
    // playwright.config.ts ve .github/workflows/test.yml.)
    customToken = execFileSync('npx', ['tsx', path.join(__dirname, 'seed-mazeret.ts')], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim();
  });

  test('Muezzin Asil can reject (mazeret) a pending assignment', async ({ page }) => {
    // Sayfa yüklenmeden ÖNCE dondurulmalı — uygulamanın ilk render'ından
    // itibaren tüm `getTurkeyNow()` çağrıları bu sabit saati görmeli.
    await page.clock.setFixedTime(turkeyFixedMorning());
    // initTimeSync()'in gerçek RTDB sunucu saatiyle bu dondurmayı geri
    // düzeltmesini engelle (bkz. yukarıdaki yorum).
    await page.route(
      (url) => RTDB_HOST_PATTERN.test(url.hostname),
      (route) => route.abort()
    );
    await page.routeWebSocket(
      (url) => RTDB_HOST_PATTERN.test(url.hostname),
      () => {}
    );

    await page.goto('/');

    // Gerçek bir Firebase Auth oturumu aç (emülatöre karşı) — window.__testSignIn
    // yalnızca VITE_USE_EMULATOR=1 iken src/lib/firebase.ts tarafından set edilir.
    await page.waitForFunction(() => window.__testSignIn !== undefined, { timeout: 15000 });
    await page.evaluate((token) => window.__testSignIn!(token), customToken);

    // Auth ve dashboard'un yerleşmesini bekle (seed edilen asil görev kartı)
    await expect(page.getByText(/YATSI vakti - Asil görev/i).first()).toBeVisible({ timeout: 15000 });

    const mazeretBtn = page.getByRole('button', { name: /MAZERET BİLDİR/i }).first();
    await expect(mazeretBtn).toBeVisible({ timeout: 10000 });
    await mazeretBtn.click();

    const modalTextarea = page.getByPlaceholder(/Nedenini kısaca belirtin/i);
    await expect(modalTextarea).toBeVisible();
    await modalTextarea.fill('Acil bir is cıktı');

    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /KAYDI TAMAMLA/i }).click();

    await expect(page.locator('text=Mazeretiniz kaydedildi').first()).toBeVisible();
  });
});
