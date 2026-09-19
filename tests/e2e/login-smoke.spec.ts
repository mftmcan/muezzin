import { expect, test } from '@playwright/test';

test('login shell renders without runtime errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/');

  await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
  await expect(page.locator('body')).toContainText(/Hizmet|Google/i);

  expect(consoleErrors.filter((error) => !error.includes('ERR_BLOCKED_BY_CLIENT'))).toEqual([]);
});

/**
 * Önceki test yalnızca giriş ekranının RENDER edildiğini doğruluyordu — 5
 * ayrı canlı arıza (bkz. AuthGuard.tsx üstündeki commit geçmişi: CSP,
 * mobilde redirect sonrası sessiz başarısızlık, popup askıda kalma) hiçbiri
 * bu testle yakalanamazdı çünkü hiçbiri gerçek `signInWithRedirect` →
 * Google hesap seçimi → `getRedirectResult` zincirini uçtan uca çalıştırmıyor.
 *
 * Firebase Auth Emulator, gerçek OAuth sunucusuna gitmeden bu zinciri GERÇEK
 * biçimde yürütür (kendi sahte "hesap seç/oluştur" arayüzünü servis eder,
 * `/emulator/auth/handler` yoluyla tam redirect döngüsünü kurar) — bu test
 * o zincirin uçtan uca çalıştığını doğrular. `girisStratejisi.ts`'teki karar
 * mantığı zaten `tests/unit/girisStratejisi.test.ts` ile ayrı test ediliyor;
 * burada test edilen, o kararların GERÇEK Firebase SDK/emulator ile
 * bütünleştiğidir (mock'un kendisi test edilmiyor, gerçek entegrasyon).
 *
 * Kullanıcı davetsiz olduğundan (bkz. useAuthStore.ts — `invites`
 * koleksiyonunda kayıt yok) giriş sonrası "Dizgede kaydınız bulunamadı" hata
 * ekranına düşer — bu SORUN DEĞİL, aksine giriş ekranından ÇIKILDIĞININ
 * (yani `onAuthStateChanged`'ın gerçek bir kullanıcıyla tetiklendiğinin)
 * kanıtıdır: `AuthGuard`'ın karar zincirinde `error` dalı yalnızca `!user`
 * dalından SONRA değerlendirilir.
 */
test('gerçek redirect OAuth akışı uçtan uca çalışır (Firebase Auth Emulator)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /google/i }).click();

  await page.waitForURL(/emulator\/auth\/handler/, { timeout: 15_000 });
  await page.locator('#add-account-button').click();
  await page.locator('#email-input').fill(`e2e-login-smoke-${test.info().project.name}@example.com`);
  await page.locator('#sign-in').click();

  // Redirect zinciri tamamlanıp uygulamaya geri dönmeli.
  await page.waitForURL('http://127.0.0.1:3000/**', { timeout: 15_000 });

  // Giriş ekranından ÇIKILDI — davetsiz kullanıcı hata ekranına düşse de
  // Google butonu artık görünmemeli (bkz. yukarıdaki gerekçe).
  await expect(page.getByRole('button', { name: /google/i })).not.toBeVisible({ timeout: 15_000 });
  await expect(page.locator('body')).toContainText(/Dizgede kaydınız bulunamadı|Tanı Bilgisini Kopyala/i);
});
