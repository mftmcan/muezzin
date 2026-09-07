import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { format, parseISO } from 'date-fns';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const adminApp = getApps().length ? getApps()[0]! : initializeApp({ projectId: firebaseConfig.projectId });
const adminDb = getFirestore(adminApp);

type SeedResult = {
  tokenAdmin: string;
  haftaIdA: string; pazartesiA: string;
  haftaIdB: string; pazartesiB: string;
  uid1: string; uid2: string; uid3: string; uid4: string;
};

let seed: SeedResult;

test.describe('Haftalık Plan (planServisi.ts) Admin Akışı E2E', () => {
  test.beforeAll(() => {
    const raw = execFileSync(
      'npx',
      ['tsx', path.join(__dirname, 'seed-haftalik-plan.ts')],
      { encoding: 'utf8', shell: process.platform === 'win32' }
    ).trim();
    seed = JSON.parse(raw);
  });

  async function girisYapVeCizelgeyeGit(page: Page) {
    await page.goto('/');
    await page.waitForFunction(() => window.__testSignIn !== undefined, { timeout: 15000 });
    await page.evaluate((t) => window.__testSignIn!(t), seed.tokenAdmin);
    await page.goto('/admin?tab=planlama');
  }

  function gunKartiLocator(page: Page, tarihIso: string) {
    const ddmmyyyy = format(parseISO(tarihIso), 'dd/MM/yyyy');
    return page.locator('div.rounded-card', { hasText: ddmmyyyy });
  }

  test('Admin, "bekliyor" durumundaki bir vakit atamasını başarıyla günceller', async ({ page }) => {
    await girisYapVeCizelgeyeGit(page);

    const gunKarti = gunKartiLocator(page, seed.pazartesiA);
    await expect(gunKarti).toBeVisible({ timeout: 15000 });
    await gunKarti.getByRole('button', { name: /ogle/i }).click();

    // Modal başlığı "Premium tasarım denetimi" ile (013ad12) cümle düzenine
    // çevrildi (HİZMET OPERASYONU -> Hizmet Operasyonu) — bkz. HaftalikCizelge.tsx.
    await expect(page.getByText('Hizmet Operasyonu')).toBeVisible();
    // PersonelSecici butonlarinin erisilebilir adi yalnizca isim degil —
    // avatar harfi + isim + "Görevli Kadro"/"Yedek Görevli" rol etiketini de
    // icerir (ör. "P PlanUc Görevli Kadro") — bu yuzden exact:true yerine
    // regex ile kismi eslesme kullanilir (bkz. GorevKarti/PersonelSecici UI).
    await page.locator('label:text("ASİL GÖREVLİ ATAMASI") + div').getByRole('button', { name: /PlanUc/ }).click();
    await page.locator('label:text("YEDEK PERSONEL ATAMASI") + div').getByRole('button', { name: /PlanDort/ }).click();
    await page.getByRole('button', { name: 'ATAMAYI GÜNCELLE' }).click();

    await expect(page.locator('text=Güncelleme Başarılı').first()).toBeVisible({ timeout: 10000 });

    const bildirimAsil = await adminDb.collection('bildirimler').doc(`${seed.haftaIdA}_${seed.pazartesiA}_ogle_asil`).get();
    expect(bildirimAsil.data()?.uid).toBe(seed.uid3);
    const bildirimYedek = await adminDb.collection('bildirimler').doc(`${seed.haftaIdA}_${seed.pazartesiA}_ogle_yedek`).get();
    expect(bildirimYedek.data()?.uid).toBe(seed.uid4);

    const plan = await adminDb.collection('haftaPlanlari').doc(seed.haftaIdA).get();
    expect(plan.data()?.gunler[seed.pazartesiA].ogle).toEqual({ asil: seed.uid3, yedek: seed.uid4 });
  });

  test('Admin, "onaylandi" (korunan) bir vakti değiştirmeye çalışınca engellenir, veri değişmez', async ({ page }) => {
    await girisYapVeCizelgeyeGit(page);

    const gunKarti = gunKartiLocator(page, seed.pazartesiA);
    await expect(gunKarti).toBeVisible({ timeout: 15000 });
    await gunKarti.getByRole('button', { name: /ikindi/i }).click();

    await expect(page.getByText('Hizmet Operasyonu')).toBeVisible();
    await page.locator('label:text("ASİL GÖREVLİ ATAMASI") + div').getByRole('button', { name: /PlanBir/ }).click();
    await page.locator('label:text("YEDEK PERSONEL ATAMASI") + div').getByRole('button', { name: /PlanIki/ }).click();
    await page.getByRole('button', { name: 'ATAMAYI GÜNCELLE' }).click();

    await expect(page.locator('text=Güncelleme Engellendi').first()).toBeVisible({ timeout: 10000 });

    const bildirimAsil = await adminDb.collection('bildirimler').doc(`${seed.haftaIdA}_${seed.pazartesiA}_ikindi_asil`).get();
    expect(bildirimAsil.data()?.uid).toBe(seed.uid3); // seed-haftalik-plan.ts'teki orijinal sahibi — değişmedi
  });

  test('Plan olmayan bir haftada "DİZGEYİ ŞİMDİ PLANLA" yeni bir plan üretir', async ({ page }) => {
    await girisYapVeCizelgeyeGit(page);
    await page.getByRole('button', { name: 'Sonraki hafta' }).click();

    // Self-healing useEffect'i sayfa admin + planı bulamayınca otomatik
    // tetikler (bkz. HaftalikCizelge.tsx selfHealingFiredHaftaIdRef) — ayrıca
    // "DİZGEYİ ŞİMDİ PLANLA" butonuna tıklamaya gerek yok, ama buton hâlâ
    // görünürse (otomatik tetikleyici henüz başlamadıysa) tıklamak zararsız.
    const planlaBtn = page.getByRole('button', { name: /DİZGEYİ ŞİMDİ PLANLA/i });
    if (await planlaBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await planlaBtn.click();
    }

    await expect(gunKartiLocator(page, seed.pazartesiB)).toBeVisible({ timeout: 20000 });

    // Kart görünür olması istemcinin persistentLocalCache'teki İYİMSER
    // (henüz sunucuya ulaşmamış) yazımını yansıtabilir — admin SDK ayrı bir
    // bağlantı olduğundan sunucu taahhüdünü hemen görmeyebilir. expect.poll
    // ile kısa bir süre yeniden denenir (bkz. vekalet-flow.spec.ts'teki
    // benzer sunucu-taahhüdü doğrulamaları — orada tek seferlik okuma UI
    // eyleminden SONRAKİ bir toast'a bağlı olduğundan bu yarış yoktu).
    await expect.poll(
      async () => (await adminDb.collection('haftaPlanlari').doc(seed.haftaIdB).get()).exists,
      { timeout: 15000 }
    ).toBe(true);

    const plan = await adminDb.collection('haftaPlanlari').doc(seed.haftaIdB).get();
    expect(plan.data()?.durum).toBe('yayinda');
    expect(Object.keys(plan.data()?.gunler || {}).length).toBe(7);
  });

  test('Self-healing, önceden onaylanmış bir vakti korur, üzerine yazmaz', async ({ page }) => {
    await girisYapVeCizelgeyeGit(page);
    await page.getByRole('button', { name: 'Sonraki hafta' }).click();
    await expect(gunKartiLocator(page, seed.pazartesiB)).toBeVisible({ timeout: 20000 });

    const plan = await adminDb.collection('haftaPlanlari').doc(seed.haftaIdB).get();
    expect(plan.data()?.gunler[seed.pazartesiB].ogle).toEqual({ asil: seed.uid1, yedek: seed.uid2 });

    const bildirimAsil = await adminDb.collection('bildirimler').doc(`${seed.haftaIdB}_${seed.pazartesiB}_ogle_asil`).get();
    expect(bildirimAsil.data()?.durum).toBe('onaylandi');
    expect(bildirimAsil.data()?.uid).toBe(seed.uid1);
  });
});
