process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import assert from 'node:assert/strict';
import { db, Timestamp } from '../../scripts/lib/firebaseAdminInit.ts';
import { hataEsigiKontroluCalistir } from '../../scripts/hataEsigiKontrol.ts';

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

async function clearCollections() {
  const collections = ['error_logs', 'adminUyarilari'];
  for (const collection of collections) {
    const snapshot = await db.collection(collection).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

/** error_logs'a doğrudan Admin SDK ile (rules atlanır) N adet aynı imzalı
 * kayıt ekler — errorStack ilk satırı script'in imza formülünde kullanılan
 * ikinci satırdır (\n ile ayrılmış). */
async function imzaKaydiEkle(prefix: string, adet: number, errorMessage = 'TypeError: x is undefined') {
  const errorStack = `${errorMessage}\n    at Component (App.tsx:10:5)`;
  const batch = db.batch();
  for (let i = 0; i < adet; i++) {
    const ref = db.collection('error_logs').doc(`${prefix}_${i}`);
    batch.set(ref, { errorMessage, errorStack, timestamp: Timestamp.now() });
  }
  await batch.commit();
}

const tests: TestCase[] = [
  {
    name: 'Esik altinda kayit varken uyari uretilmez',
    run: async () => {
      await clearCollections();
      await imzaKaydiEkle('altEsik', 5);

      const sonuc = await hataEsigiKontroluCalistir();
      assert.equal(sonuc.esikAsildiMi, false);
      assert.equal(sonuc.enYuksekTekrar, 5);

      const uyarilar = await db.collection('adminUyarilari').where('tip', '==', 'hataPatlamasi').get();
      assert.equal(uyarilar.size, 0);
    },
  },
  {
    name: 'Esik asilinca tek bir hataPatlamasi uyarisi acilir',
    run: async () => {
      await clearCollections();
      await imzaKaydiEkle('ustEsik', 55);

      const sonuc = await hataEsigiKontroluCalistir();
      assert.equal(sonuc.esikAsildiMi, true);
      assert.equal(sonuc.enYuksekTekrar, 55);

      const uyarilar = await db.collection('adminUyarilari').where('tip', '==', 'hataPatlamasi').get();
      assert.equal(uyarilar.size, 1);
      assert.equal(uyarilar.docs[0]?.data().cozuldu, false);
    },
  },
  {
    name: 'Esik asilinca ve zaten acik bir hataPatlamasi uyarisi varken yenisi uretilmez',
    run: async () => {
      await clearCollections();
      await db.collection('adminUyarilari').doc('mevcut').set({ tip: 'hataPatlamasi', mesaj: 'Eski', cozuldu: false });
      await imzaKaydiEkle('ustEsikTekrar', 60);

      const sonuc = await hataEsigiKontroluCalistir();
      assert.equal(sonuc.esikAsildiMi, true);

      const uyarilar = await db.collection('adminUyarilari').where('tip', '==', 'hataPatlamasi').get();
      assert.equal(uyarilar.size, 1);
      assert.equal(uyarilar.docs[0]?.id, 'mevcut');
    },
  },
  {
    name: 'Kosul temizlenince onceden acik hataPatlamasi uyarisi otomatik cozulur',
    run: async () => {
      await clearCollections();
      await db.collection('adminUyarilari').doc('eskiUyari').set({ tip: 'hataPatlamasi', mesaj: 'Eski', cozuldu: false });
      await imzaKaydiEkle('normal', 3);

      const sonuc = await hataEsigiKontroluCalistir();
      assert.equal(sonuc.esikAsildiMi, false);

      const uyariDoc = await db.collection('adminUyarilari').doc('eskiUyari').get();
      assert.equal(uyariDoc.data()?.cozuldu, true);
      assert.ok(uyariDoc.data()?.cozulmeTarihi);
    },
  },
  {
    name: 'Farkli imzali hatalar ayri sayilir, en yuksek tekrar dogru bulunur',
    run: async () => {
      await clearCollections();
      await imzaKaydiEkle('imzaA', 10, 'Error: A hatasi');
      await imzaKaydiEkle('imzaB', 20, 'Error: B hatasi');

      const sonuc = await hataEsigiKontroluCalistir();
      assert.equal(sonuc.benzersizImzaSayisi, 2);
      assert.equal(sonuc.enYuksekTekrar, 20);
      assert.equal(sonuc.esikAsildiMi, false);
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
