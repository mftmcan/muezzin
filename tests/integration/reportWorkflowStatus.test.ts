process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import assert from 'node:assert/strict';
import { db } from '../../scripts/lib/firebaseAdminInit.ts';
import { raporlaBasarisizlik, otomasyonUyarisiDocId } from '../../scripts/lib/reportWorkflowFailure.ts';
import { raporlaBasari } from '../../scripts/lib/reportWorkflowSuccess.ts';

// "Bilinçli olarak dışarıda bırakılanlar" listesinden kapatılan bulgu:
// reportWorkflowFailure.ts / reportWorkflowSuccess.ts AYNI deterministik
// ID'yi (tip+isAdi) paylaşır — bu test o eşleşmeyi ve create/resolve
// döngüsünün uçtan uca (gerçek Firestore emülatörüne karşı) çalıştığını
// doğrular.

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

async function clearCollections() {
  const collections = ['adminUyarilari'];
  for (const collection of collections) {
    const snapshot = await db.collection(collection).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  }
}

const IS_ADI = 'Test İşi Aksurken';

const tests: TestCase[] = [
  {
    name: 'raporlaBasarisizlik yeni bir uyari olusturur',
    run: async () => {
      await clearCollections();
      await raporlaBasarisizlik(IS_ADI);

      const docId = otomasyonUyarisiDocId('otomasyonHatasi', IS_ADI);
      const doc = await db.collection('adminUyarilari').doc(docId).get();
      assert.equal(doc.exists, true);
      assert.equal(doc.data()?.cozuldu, false);
      assert.equal(doc.data()?.tip, 'otomasyonHatasi');
    },
  },
  {
    name: 'raporlaBasari acik uyariyi otomatik cozer',
    run: async () => {
      await clearCollections();
      await raporlaBasarisizlik(IS_ADI);
      await raporlaBasari(IS_ADI);

      const docId = otomasyonUyarisiDocId('otomasyonHatasi', IS_ADI);
      const doc = await db.collection('adminUyarilari').doc(docId).get();
      assert.equal(doc.data()?.cozuldu, true);
      assert.equal(typeof doc.data()?.cozulmeTarihi, 'object');
    },
  },
  {
    name: 'raporlaBasari uyari hic olusmamissa sessizce hicbir sey yapmaz',
    run: async () => {
      await clearCollections();
      await raporlaBasari(IS_ADI);

      const docId = otomasyonUyarisiDocId('otomasyonHatasi', IS_ADI);
      const doc = await db.collection('adminUyarilari').doc(docId).get();
      assert.equal(doc.exists, false);
    },
  },
  {
    name: 'Ayni is tekrar basarisiz olursa YENI belge degil AYNI belge guncellenir',
    run: async () => {
      await clearCollections();
      await raporlaBasarisizlik(IS_ADI);
      await raporlaBasari(IS_ADI);
      // Iş yeniden başarısız oldu — belge zaten çözülmüş olarak duruyordu,
      // yeniden açılmalı (bkz. reportWorkflowFailure.ts'teki yorum).
      await raporlaBasarisizlik(IS_ADI);

      const snap = await db.collection('adminUyarilari').get();
      assert.equal(snap.size, 1);
      assert.equal(snap.docs[0]!.data().cozuldu, false);
    },
  },
  {
    name: 'Farkli is adlari farkli belgeler uretir, birbirini etkilemez',
    run: async () => {
      await clearCollections();
      await raporlaBasarisizlik('İş A');
      await raporlaBasarisizlik('İş B');
      await raporlaBasari('İş A');

      const docA = await db.collection('adminUyarilari').doc(otomasyonUyarisiDocId('otomasyonHatasi', 'İş A')).get();
      const docB = await db.collection('adminUyarilari').doc(otomasyonUyarisiDocId('otomasyonHatasi', 'İş B')).get();
      assert.equal(docA.data()?.cozuldu, true);
      assert.equal(docB.data()?.cozuldu, false);
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
