process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import assert from 'node:assert/strict';
import { db, Timestamp } from '../../scripts/lib/firebaseAdminInit.ts';
import { processKritikUyariBildirimleri } from '../../scripts/kritikUyariBildirimGonder.ts';
import { GONDERIM_CLAIM_ALANI, GONDERIM_CLAIM_BAYATLAMA_MS } from '../../scripts/lib/gonderimClaim.ts';
import type { FcmGonderici } from '../../scripts/lib/fcmNotify.ts';

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

async function clearCollections() {
  const collections = ['muezzins', 'adminUyarilari'];
  for (const collection of collections) {
    const snapshot = await db.collection(collection).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

const tamArizaGonderici: FcmGonderici = async (parca) => ({
  successCount: 0,
  failureCount: parca.length,
  responses: parca.map(() => ({ success: false, error: { code: 'messaging/authentication-error' } })),
});

const basariliGonderici: FcmGonderici = async (parca) => ({
  successCount: parca.length,
  failureCount: 0,
  responses: parca.map(() => ({ success: true })),
});

const tests: TestCase[] = [
  {
    name: 'cozuldu:true olan uyari hic ele alinmaz',
    run: async () => {
      await clearCollections();
      const uyariRef = db.collection('adminUyarilari').doc('u1');
      await uyariRef.set({ tip: 'otomasyonHatasi', mesaj: 'Test', cozuldu: true, bildirimGonderildi: false });

      const sonuc = await processKritikUyariBildirimleri(false);
      assert.equal(sonuc.uyariSayisi, 0);
      assert.equal(sonuc.mesajSayisi, 0);
    },
  },
  {
    name: 'bildirimGonderildi:true olan acik uyari tekrar islenmez',
    run: async () => {
      await clearCollections();
      const uyariRef = db.collection('adminUyarilari').doc('u2');
      await uyariRef.set({ tip: 'otomasyonHatasi', mesaj: 'Test', cozuldu: false, bildirimGonderildi: true });

      const sonuc = await processKritikUyariBildirimleri(false);
      assert.equal(sonuc.uyariSayisi, 0);
    },
  },
  {
    name: 'bildirimGonderildi alani hic yoksa (eski kayit) yine de islenir',
    run: async () => {
      await clearCollections();
      const uyariRef = db.collection('adminUyarilari').doc('u3');
      await uyariRef.set({ tip: 'otomasyonHatasi', mesaj: 'Test', cozuldu: false });

      const sonuc = await processKritikUyariBildirimleri(true);
      assert.equal(sonuc.uyariSayisi, 1);
    },
  },
  {
    name: 'Aktif admin FCM tokeni mesaj sayisina dahil edilir, aktif olmayan admin ve muezzin rolu dahil edilmez (dry-run)',
    run: async () => {
      await clearCollections();
      await db
        .collection('muezzins')
        .doc('admin_aktif')
        .set({ displayName: 'Admin Aktif', role: 'admin', aktif: true, fcmTokens: { tok_a: new Date() } });
      await db
        .collection('muezzins')
        .doc('admin_pasif')
        .set({ displayName: 'Admin Pasif', role: 'admin', aktif: false, fcmTokens: { tok_b: new Date() } });
      await db
        .collection('muezzins')
        .doc('muezzin1')
        .set({ displayName: 'Muezzin', role: 'muezzin', aktif: true, fcmTokens: { tok_c: new Date() } });
      await db.collection('adminUyarilari').doc('u4').set({ tip: 'kotaUyarisi', mesaj: 'Kota', cozuldu: false });

      const sonuc = await processKritikUyariBildirimleri(true);
      assert.equal(sonuc.uyariSayisi, 1);
      assert.equal(sonuc.mesajSayisi, 1);
    },
  },
  {
    name: 'Taze "gonderiliyor" damgasi tasiyan uyari bu turda yeniden gonderilmez',
    run: async () => {
      await clearCollections();
      const uyariRef = db.collection('adminUyarilari').doc('u5');
      await uyariRef.set({
        tip: 'otomasyonHatasi',
        mesaj: 'Test',
        cozuldu: false,
        [GONDERIM_CLAIM_ALANI]: Timestamp.now(),
      });

      const sonuc = await processKritikUyariBildirimleri(false);
      assert.equal(sonuc.uyariSayisi, 0);

      const uyariDoc = await uyariRef.get();
      assert.equal(uyariDoc.data()?.bildirimGonderildi, undefined);
      assert.ok(uyariDoc.data()?.[GONDERIM_CLAIM_ALANI]);
    },
  },
  {
    name: 'Bayatlamis damga tasiyan uyari yeniden islenir ve damga silinir',
    run: async () => {
      await clearCollections();
      const uyariRef = db.collection('adminUyarilari').doc('u6');
      await uyariRef.set({
        tip: 'otomasyonHatasi',
        mesaj: 'Test',
        cozuldu: false,
        [GONDERIM_CLAIM_ALANI]: Timestamp.fromMillis(Date.now() - GONDERIM_CLAIM_BAYATLAMA_MS - 60_000),
      });

      const sonuc = await processKritikUyariBildirimleri(false);
      assert.equal(sonuc.uyariSayisi, 1);

      const uyariDoc = await uyariRef.get();
      assert.equal(uyariDoc.data()?.bildirimGonderildi, true);
      assert.equal(uyariDoc.data()?.[GONDERIM_CLAIM_ALANI], undefined);
    },
  },
  {
    name: 'Tam FCM arizasinda claim geri alinir ve bildirimGonderildi YAZILMAZ',
    run: async () => {
      await clearCollections();
      await db
        .collection('muezzins')
        .doc('admin1')
        .set({ displayName: 'Admin', role: 'admin', aktif: true, fcmTokens: { t1: new Date() } });
      const uyariRef = db.collection('adminUyarilari').doc('u7');
      await uyariRef.set({ tip: 'otomasyonHatasi', mesaj: 'Test', cozuldu: false });

      await assert.rejects(
        () => processKritikUyariBildirimleri(false, tamArizaGonderici),
        (err: unknown) => err instanceof Error && err.name === 'FcmGonderimBasarisizHatasi'
      );

      const uyariDoc = await uyariRef.get();
      assert.equal(uyariDoc.data()?.bildirimGonderildi, undefined);
      assert.equal(uyariDoc.data()?.[GONDERIM_CLAIM_ALANI], undefined);
    },
  },
  {
    name: 'Basarili gonderimde bildirimGonderildi true olur (kontrol grubu)',
    run: async () => {
      await clearCollections();
      await db
        .collection('muezzins')
        .doc('admin1')
        .set({ displayName: 'Admin', role: 'admin', aktif: true, fcmTokens: { t1: new Date() } });
      const uyariRef = db.collection('adminUyarilari').doc('u8');
      await uyariRef.set({ tip: 'otomasyonHatasi', mesaj: 'Test', cozuldu: false });

      const sonuc = await processKritikUyariBildirimleri(false, basariliGonderici);
      assert.equal(sonuc.uyariSayisi, 1);
      assert.equal(sonuc.mesajSayisi, 1);

      const uyariDoc = await uyariRef.get();
      assert.equal(uyariDoc.data()?.bildirimGonderildi, true);
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
