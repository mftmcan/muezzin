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

/**
 * seed-vekalet.ts her zaman BUGÜN için bildirim/talep seed eder (aynı gerekçe
 * ile — bkz. mazeret-flow.spec.ts'teki turkeyIsFridayNow yorumu). Vekalet de
 * mazeretle AYNI Cuma kısıtlamasına tabi (CLAUDE.md "Mazeret / Cuma
 * kısıtlaması" — vekalet bu engeli atlatmasın diye kasıtlı), bu yüzden bu
 * akış da Cuma günleri atlanır.
 */
function turkeyIsFridayNow(): boolean {
  const turkeyMs = Date.now() + 3 * 60 * 60 * 1000;
  return new Date(turkeyMs).getUTCDay() === 5;
}

/** mazeret-flow.spec.ts'teki turkeyFixedMorning ile birebir aynı — bkz. o dosyadaki
 *  detaylı gerekçe (RTDB senkronunun donmuş saati geri düzeltmesi sorunu). */
function turkeyFixedMorning(): Date {
  const turkeyMs = Date.now() + 3 * 60 * 60 * 1000;
  const turkey = new Date(turkeyMs);
  return new Date(Date.UTC(turkey.getUTCFullYear(), turkey.getUTCMonth(), turkey.getUTCDate(), 7, 0, 0));
}

const RTDB_HOST_PATTERN = /firebasedatabase\.app|firebaseio\.com/;

/** Bir sayfayı dondurulmuş "bugün 10:00" Türkiye saatiyle, gerçek RTDB saat
 *  senkronu engellenmiş halde açar ve verilen custom token ile oturum açar
 *  — mazeret-flow.spec.ts'teki tek-sayfalık akışın iki bağımsız context'e
 *  genellenmiş hali. */
async function girisYapVeHaz(page: Page, token: string) {
  await page.clock.setFixedTime(turkeyFixedMorning());
  await page.route((url) => RTDB_HOST_PATTERN.test(url.hostname), (route) => route.abort());
  await page.routeWebSocket((url) => RTDB_HOST_PATTERN.test(url.hostname), () => {});

  await page.goto('/');
  await page.waitForFunction(() => window.__testSignIn !== undefined, { timeout: 15000 });
  await page.evaluate((t) => window.__testSignIn!(t), token);
}

test.describe('Vekalet (Görev Devri) Akışı E2E', () => {
  test.skip(turkeyIsFridayNow(), 'Vekalet, mazeretle aynı Cuma kısıtlamasına tabi — seed bugün için görev oluşturduğundan bu akış Cuma günü test edilemez.');

  let tokenA: string;
  let tokenB: string;

  test.beforeAll(() => {
    const raw = execFileSync(
      'npx',
      ['tsx', path.join(__dirname, 'seed-vekalet.ts')],
      { encoding: 'utf8', shell: process.platform === 'win32' }
    ).trim();
    ({ tokenA, tokenB } = JSON.parse(raw));
  });

  test('Gönderen, akranına vekalet teklifi gönderebilir (vekaletTeklifEt)', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await girisYapVeHaz(page, tokenA);

    // A'nın bugün için İKİNDİ görevi de var (bkz. seed-vekalet.ts — kabul
    // testi için ayrıca seed edilir), bu yüzden hem "sıradaki görev" hero'su
    // hem de sayfadaki İLK "GÖREVİ DEVRET" butonu VAKIT_SIRASI gereği İKİNDİ'ye
    // ait olabilir. YATSI'ya özgü görev kartına scope'lanarak bu belirsizlik
    // giderilir (bkz. GorevKarti.tsx — kart kökü `div.tactile-card`, içinde
    // "{VAKIT} VAKTİ • BUGÜN" metni var).
    // hasText yerine `has` + tam eşleşme kullanılıyor: kartın üst paragrafı
    // ham vakit anahtarını Türkçe büyük harfe çevirip "YATSİ" (noktalı İ)
    // yazarken, h3 başlığı görünen adı çevirip "YATSI" (noktasız I) yazıyor —
    // regex'te bu ikisini karıştırmak eşleşmeyi sessizce başarısız kılıyordu.
    const yatsiKarti = page.locator('div.tactile-card').filter({
      has: page.getByRole('heading', { name: 'YATSI', exact: true })
    });
    await expect(yatsiKarti).toBeVisible({ timeout: 15000 });

    await yatsiKarti.getByRole('button', { name: /GÖREVİ DEVRET/i }).click();
    // Modal başlığı "Premium tasarım denetimi" ile (013ad12) cümle düzenine
    // çevrildi (HİZMET VEKALETİ TEKLİF ET -> Hizmet Vekaleti Teklif Et).
    await expect(page.getByText('Hizmet Vekaleti Teklif Et')).toBeVisible();

    await page.getByText('E2E Vekalet Alıcı', { exact: true }).click();

    await expect(page.locator('text=Vekalet Gönderildi').first()).toBeVisible({ timeout: 10000 });

    // UI bildirimi tek başına yeterli değil — asıl doğrulama Firestore'da
    // gerçekten oluşan `vekalet_talepleri` belgesi (gerçek client-SDK
    // yazımı, mock değil).
    const snap = await adminDb.collection('vekalet_talepleri')
      .where('gonderenUid', '==', 'muezzin_e2e_vekalet_gonderen')
      .where('aliciUid', '==', 'muezzin_e2e_vekalet_alici')
      .where('vakit', '==', 'yatsi')
      .get();
    expect(snap.empty).toBe(false);
    expect(snap.docs[0]!.data().durum).toBe('beklemede');

    await context.close();
  });

  test('Alıcı, gelen vekalet teklifini kabul edebilir (vekaletKabulEt) ve görev devrolur', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await girisYapVeHaz(page, tokenB);

    await expect(page.getByText('VEKALET TEKLİFİ').first()).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /KABUL ET/i }).first().click();

    // NOT ("1000 ifade tavanı" kök neden çözümü): kabul artık ANLIK bir
    // sahiplik transferi değil — istemci yalnızca talebi kabul eder ve
    // bildirime dar bir "niyet" bayrağı yazar; GERÇEK transfer
    // scripts/vekaletDevirleriniIsle.ts'te (ayrı bir süreç, kendi
    // entegrasyon testinde kapsanıyor — bkz. tests/integration/
    // vekaletDevirleriniIsle.test.ts) gerçekleşir. Bu E2E test yalnızca
    // istemci tarafının doğru minimal yazımı yaptığını doğrular.
    await expect(page.locator('text=Kabulünüz Alındı').first()).toBeVisible({ timeout: 10000 });

    const snap = await adminDb.collection('vekalet_talepleri')
      .where('gonderenUid', '==', 'muezzin_e2e_vekalet_gonderen')
      .where('aliciUid', '==', 'muezzin_e2e_vekalet_alici')
      .where('vakit', '==', 'ikindi')
      .get();
    expect(snap.empty).toBe(false);
    const talep = snap.docs[0]!.data();
    expect(talep.durum).toBe('kabul_edildi');

    const bildirimDoc = await adminDb.collection('bildirimler').doc(talep.bildirimId).get();
    // Sahiplik henüz DEĞİŞMEMİŞ olmalı — yalnızca bekleme bayrağı yazılmış.
    expect(bildirimDoc.data()?.uid).toBe('muezzin_e2e_vekalet_gonderen');
    expect(bildirimDoc.data()?.vekaletDevriBekliyor).toBe(true);

    await context.close();
  });
});
