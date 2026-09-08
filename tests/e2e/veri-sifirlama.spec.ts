import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const adminApp = getApps().length ? getApps()[0]! : initializeApp({ projectId: firebaseConfig.projectId });
const adminDb = getFirestore(adminApp);

type SeedResult = {
  tokenAdmin: string;
  prefix: string;
  muezzinUid: string;
  beklenenSayilar: {
    bildirimler: number;
    haftaPlanlari: number;
    izinler: number;
    vekalet_talepleri: number;
    adminUyarilari: number;
  };
};

let seed: SeedResult;

test.describe('Operasyonel Veri Sıfırlama E2E (Tehlikeli Bölge)', () => {
  test.beforeAll(() => {
    const raw = execFileSync('npx', ['tsx', path.join(__dirname, 'seed-veri-sifirlama.ts')], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim();
    seed = JSON.parse(raw);
  });

  async function girisYapVeAyarlaraGit(page: Page) {
    await page.goto('/');
    await page.waitForFunction(() => window.__testSignIn !== undefined, { timeout: 15000 });
    await page.evaluate((t) => window.__testSignIn!(t), seed.tokenAdmin);
    await page.goto('/admin?tab=ayarlar');
  }

  test('Onay metni yazılmadan silme butonu devre dışı kalır, doğru metinle aktifleşir ve gerçekten siler', async ({ page }) => {
    await girisYapVeAyarlaraGit(page);

    await page.getByRole('button', { name: 'Operasyonel Veriyi Sıfırla' }).click();
    await expect(page.getByText('OPERASYONEL VERİYİ SIFIRLA').first()).toBeVisible();

    // Canlı belge sayıları modal açıldığında yüklenir (getCountFromServer) —
    // seed'in yazdığı bilinen sayılarla eşleşmeli. Satıra göre kapsamlı
    // locator (label metni) kullanılır — bazı koleksiyonların sayıları
    // çakışabildiğinden (ör. izinler=2, adminUyarilari=2) salt sayı metniyle
    // aramak "strict mode violation" verirdi.
    const satir = (etiket: string) => page.locator('label').filter({ hasText: etiket });
    await expect(satir('Bildirimler')).toContainText(`${seed.beklenenSayilar.bildirimler} belge`, { timeout: 10000 });
    await expect(satir('İzin Talepleri')).toContainText(`${seed.beklenenSayilar.izinler} belge`);
    await expect(satir('Admin Uyarıları')).toContainText(`${seed.beklenenSayilar.adminUyarilari} belge`);

    const silButonu = page.getByRole('button', { name: /KALICI OLARAK SİL/i });
    await expect(silButonu).toBeDisabled();

    const onayInput = page.getByPlaceholder('OPERASYONEL VERİYİ SIFIRLA');
    await onayInput.fill('yanlis metin');
    await expect(silButonu).toBeDisabled();

    await onayInput.fill('OPERASYONEL VERİYİ SIFIRLA');
    await expect(silButonu).toBeEnabled();

    await silButonu.click();
    await expect(page.locator('text=Sıfırlama Tamamlandı').first()).toBeVisible({ timeout: 20000 });

    // Seçili (varsayılan) operasyonel koleksiyonlar tamamen boşalmış olmalı.
    await expect.poll(async () => (await adminDb.collection('bildirimler').get()).size, { timeout: 15000 }).toBe(0);
    expect((await adminDb.collection('haftaPlanlari').get()).size).toBe(0);
    expect((await adminDb.collection('izinler').get()).size).toBe(0);
    expect((await adminDb.collection('vekalet_talepleri').get()).size).toBe(0);
    expect((await adminDb.collection('adminUyarilari').get()).size).toBe(0);

    // Kapsam DIŞI koleksiyonlar (kalıcı/silinemez) etkilenmemiş olmalı.
    expect((await adminDb.collection('mazeret_detaylari').doc(`${seed.prefix}mazeret`).get()).exists).toBe(true);
    expect((await adminDb.collection('audit_logs').doc(`${seed.prefix}log`).get()).exists).toBe(true);

    // Kadro sayaçları (varsayılan seçenek açıkken) 0'a çekilmiş olmalı.
    const muezzin = await adminDb.collection('muezzins').doc(seed.muezzinUid).get();
    expect(muezzin.data()?.aylikVakitSayisi).toBe(0);
    expect(muezzin.data()?.aylikCumaSayisi).toBe(0);
    expect(muezzin.data()?.aylikYedekSayisi).toBe(0);
    expect(muezzin.data()?.yillikIzinKullanilanGun).toBe(0);

    // İşlemin kendisi bir denetim kaydı bırakmış olmalı (audit_logs kapsam
    // dışı olduğundan bu kayıt da sağ salim durmalı).
    const yeniLoglar = await adminDb.collection('audit_logs').where('actionType', '==', 'Operasyonel Veri Sıfırlama').get();
    expect(yeniLoglar.size).toBeGreaterThanOrEqual(1);
  });
});
