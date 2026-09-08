process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import assert from 'node:assert/strict';
import { db, Timestamp } from '../../scripts/lib/firebaseAdminInit.ts';
import { processIzinDurumBildirimleri } from '../../scripts/izinDurumBildirimGonder.ts';
import { GONDERIM_CLAIM_ALANI, GONDERIM_CLAIM_BAYATLAMA_MS } from '../../scripts/lib/gonderimClaim.ts';

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

async function clearCollections() {
  const collections = ['muezzins', 'izinler'];
  for (const collection of collections) {
    const snapshot = await db.collection(collection).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

const tests: TestCase[] = [
  {
    // Gercek FCM gonderimi bu entegrasyon suitinde tetiklenmemeli (bkz.
    // duyuruBildirimGonder.test.ts'teki AYNI gerekce) — talep sahibinin
    // muezzin kaydi hic yok, yani sifir alicili bir senaryo.
    name: 'Talep sahibinin muezzin kaydi yoksa yine de bildirimGonderildi true olarak isaretlenir',
    run: async () => {
      await clearCollections();
      const izinRef = db.collection('izinler').doc('izin1');
      await izinRef.set({
        uid: 'olmayan_uid',
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'mazeret',
        durum: 'onaylandi',
        sebep: 'Aile',
        bildirimGonderildi: false,
      });

      const sonuc = await processIzinDurumBildirimleri(false);
      assert.equal(sonuc.kararSayisi, 1);
      assert.equal(sonuc.mesajSayisi, 0);

      const izinDoc = await izinRef.get();
      assert.equal(izinDoc.data()?.bildirimGonderildi, true);
    },
  },
  {
    name: 'Henuz karara varilmamis (onay_bekliyor) bir kayit islenmez sayilir ama isaretlenir',
    run: async () => {
      await clearCollections();
      // Normalde bildirimGonderildi yalnizca karar aninda false yazildigindan
      // bu durum olusmaz — savunma derinligi olarak test edilir (bkz. script
      // yorumu).
      const izinRef = db.collection('izinler').doc('izin2');
      await izinRef.set({
        uid: 'muezzin1',
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'mazeret',
        durum: 'onay_bekliyor',
        sebep: 'Aile',
        bildirimGonderildi: false,
      });

      const sonuc = await processIzinDurumBildirimleri(false);
      assert.equal(sonuc.kararSayisi, 0);

      const izinDoc = await izinRef.get();
      assert.equal(izinDoc.data()?.bildirimGonderildi, true);
    },
  },
  {
    name: 'mazeretDurumu tercihi kapali olan talep sahibi mesaj sayisina dahil edilmez (dry-run)',
    run: async () => {
      await clearCollections();
      await db
        .collection('muezzins')
        .doc('muezzin_optout')
        .set({
          displayName: 'Optout',
          role: 'muezzin',
          aktif: true,
          notificationSettings: { mazeretDurumu: false },
          fcmTokens: { fake_token_1: new Date() },
        });
      await db.collection('izinler').doc('izin3').set({
        uid: 'muezzin_optout',
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'yillik',
        durum: 'reddedildi',
        sebep: 'Aile',
        bildirimGonderildi: false,
      });

      const sonuc = await processIzinDurumBildirimleri(true);
      assert.equal(sonuc.kararSayisi, 1);
      assert.equal(sonuc.mesajSayisi, 0);

      // dry-run oldugundan bayrak degismemis olmali.
      const izinDoc = await db.collection('izinler').doc('izin3').get();
      assert.equal(izinDoc.data()?.bildirimGonderildi, false);
    },
  },
  {
    name: 'mazeretDurumu tercihi acik olan talep sahibinin tokeni mesaj sayisina dahil edilir (dry-run)',
    run: async () => {
      await clearCollections();
      await db
        .collection('muezzins')
        .doc('muezzin_optin')
        .set({
          displayName: 'Optin',
          role: 'muezzin',
          aktif: true,
          fcmTokens: { fake_token_a: new Date() },
        });
      await db.collection('izinler').doc('izin4').set({
        uid: 'muezzin_optin',
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'haftalik',
        durum: 'onaylandi',
        sebep: 'Aile',
        bildirimGonderildi: false,
      });

      const sonuc = await processIzinDurumBildirimleri(true);
      assert.equal(sonuc.kararSayisi, 1);
      assert.equal(sonuc.mesajSayisi, 1);
    },
  },
  {
    name: 'Zaten bildirilmis bir karar tekrar islenmez',
    run: async () => {
      await clearCollections();
      await db.collection('izinler').doc('izin5').set({
        uid: 'muezzin1',
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'mazeret',
        durum: 'onaylandi',
        sebep: 'Aile',
        bildirimGonderildi: true,
      });

      const sonuc = await processIzinDurumBildirimleri(false);
      assert.equal(sonuc.kararSayisi, 0);
    },
  },
  {
    // CIFT PUSH KOK NEDENI: gonderim ile "gonderildi" commit'i arasinda
    // surec olurse bayrak hic kalicilasmaz ve eski kodda karar her 10
    // dakikada bir yeniden bildiriliyordu. Bu senaryo, o cokmus kosunun
    // biraktigi TAZE damgayi taklit eder (bkz. scripts/lib/gonderimClaim.ts).
    name: 'Taze "gonderiliyor" damgasi tasiyan izin karari bu turda yeniden gonderilmez',
    run: async () => {
      await clearCollections();
      await db
        .collection('muezzins')
        .doc('muezzin_claim')
        .set({
          displayName: 'Claim',
          role: 'muezzin',
          aktif: true,
          fcmTokens: { fake_token_c: new Date() },
        });
      const izinRef = db.collection('izinler').doc('izinClaimTaze');
      await izinRef.set({
        uid: 'muezzin_claim',
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'mazeret',
        durum: 'onaylandi',
        bildirimGonderildi: false,
        [GONDERIM_CLAIM_ALANI]: Timestamp.now(),
      });

      const sonuc = await processIzinDurumBildirimleri(false);
      assert.equal(sonuc.kararSayisi, 0);
      assert.equal(sonuc.mesajSayisi, 0);

      const izinDoc = await izinRef.get();
      assert.equal(izinDoc.data()?.bildirimGonderildi, false);
      assert.ok(izinDoc.data()?.[GONDERIM_CLAIM_ALANI]);
    },
  },
  {
    // Damga bayatlayinca kayit yeniden denenmeli — aksi halde bu mekanizma
    // bildirimleri KALICI olarak kilitlerdi. (Alici muezzin kaydi yok, yani
    // sifir mesaj: entegrasyon suitinde gercek FCM'e cikilmaz.)
    name: 'Bayatlamis damga tasiyan izin karari yeniden islenir ve damga silinir',
    run: async () => {
      await clearCollections();
      const izinRef = db.collection('izinler').doc('izinClaimBayat');
      await izinRef.set({
        uid: 'olmayan_uid',
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'mazeret',
        durum: 'onaylandi',
        bildirimGonderildi: false,
        [GONDERIM_CLAIM_ALANI]: Timestamp.fromMillis(Date.now() - GONDERIM_CLAIM_BAYATLAMA_MS - 60_000),
      });

      const sonuc = await processIzinDurumBildirimleri(false);
      assert.equal(sonuc.kararSayisi, 1);

      const izinDoc = await izinRef.get();
      assert.equal(izinDoc.data()?.bildirimGonderildi, true);
      assert.equal(izinDoc.data()?.[GONDERIM_CLAIM_ALANI], undefined);
    },
  },
];

async function main() {
  try {
    for (const test of tests) {
      await test.run();
      console.log(`OK ${test.name}`);
    }

    assert.equal(tests.length > 0, true);
    console.log(`${tests.length} integration tests passed`);
  } catch (err) {
    console.error('Integration test failed:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
