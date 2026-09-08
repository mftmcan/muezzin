process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { db, Timestamp } from '../../scripts/lib/firebaseAdminInit.ts';
import { firestoreYedekleCalistir } from '../../scripts/firestoreYedekle.ts';
import { firestoreGeriYukleCalistir } from '../../scripts/firestoreGeriYukle.ts';
import { YEDEKLENECEK_KOLEKSIYONLAR } from '../../scripts/lib/yedekKapsam.ts';

// Test edilmemiş bir geri yükleme script'i DR değildir (bkz. plan) — bu suit
// gerçek bir round-trip'i (seed → export → koleksiyonları sil → import →
// derin eşitlik) emülatöre karşı uçtan uca doğrular.

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

const TEST_DOSYA = 'yedek/test-gecici.ndjson';

async function clearAllKnownCollections() {
  const koleksiyonlar = [...YEDEKLENECEK_KOLEKSIYONLAR, 'adminUyarilari'];
  for (const collection of koleksiyonlar) {
    const snapshot = await db.collection(collection).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  if (existsSync(TEST_DOSYA)) rmSync(TEST_DOSYA);
}

function timestampEsitMi(a: unknown, b: unknown): boolean {
  return a instanceof Timestamp && b instanceof Timestamp && a.isEqual(b);
}

const tests: TestCase[] = [
  {
    name: 'Round-trip: karma tipli belgeler (timestamp/nested map/array/null) birebir geri yuklenir',
    run: async () => {
      await clearAllKnownCollections();
      const olusturmaTarihi = Timestamp.now();
      await db
        .collection('muezzins')
        .doc('rt_muezzin1')
        .set({
          displayName: 'Test Kullanici',
          role: 'muezzin',
          aktif: true,
          fcmToken: null,
          notificationSettings: { nobetHatirlatici: true, duyurular: false },
          aylikVakitSayisi: 3,
        });
      await db.collection('izinler').doc('rt_izin1').set({
        uid: 'rt_muezzin1',
        baslangic: '2027-02-01',
        bitis: '2027-02-02',
        tip: 'yillik',
        durum: 'onay_bekliyor',
        olusturmaTarihi,
      });
      await db.collection('settings').doc('system').set({ ilceId: '9541', ilceAdi: 'Merkez', hicriDuzeltme: 1 });

      const yedekSonuc = await firestoreYedekleCalistir(TEST_DOSYA);
      assert.equal(yedekSonuc.iptalEdildi, false);
      assert.ok(yedekSonuc.toplamBelge >= 3);
      assert.ok(existsSync(TEST_DOSYA));

      // Koleksiyonları TAMAMEN sil — geri yüklemenin gerçekten yeniden
      // yarattığını doğrulamak için.
      await db.recursiveDelete(db.collection('muezzins'));
      await db.recursiveDelete(db.collection('izinler'));
      await db.recursiveDelete(db.collection('settings'));

      const ndjson = readFileSync(TEST_DOSYA, 'utf8');
      const geriYuklemeSonuc = await firestoreGeriYukleCalistir(ndjson, { kuruCalistirma: false });
      assert.equal(geriYuklemeSonuc.kuruCalistirma, false);

      const muezzinDoc = await db.collection('muezzins').doc('rt_muezzin1').get();
      assert.equal(muezzinDoc.exists, true);
      assert.equal(muezzinDoc.data()?.displayName, 'Test Kullanici');
      assert.equal(muezzinDoc.data()?.fcmToken, null);
      assert.deepEqual(muezzinDoc.data()?.notificationSettings, { nobetHatirlatici: true, duyurular: false });
      assert.equal(muezzinDoc.data()?.aylikVakitSayisi, 3);

      const izinDoc = await db.collection('izinler').doc('rt_izin1').get();
      assert.equal(izinDoc.exists, true);
      assert.equal(izinDoc.data()?.baslangic, '2027-02-01');
      assert.ok(timestampEsitMi(izinDoc.data()?.olusturmaTarihi, olusturmaTarihi));

      const settingsDoc = await db.collection('settings').doc('system').get();
      assert.equal(settingsDoc.data()?.hicriDuzeltme, 1);
    },
  },
  {
    name: 'Dry-run hicbir sey yazmaz',
    run: async () => {
      await clearAllKnownCollections();
      await db.collection('settings').doc('system').set({ ilceId: '1234', ilceAdi: 'X', hicriDuzeltme: 0 });
      await firestoreYedekleCalistir(TEST_DOSYA);
      await db.recursiveDelete(db.collection('settings'));

      const ndjson = readFileSync(TEST_DOSYA, 'utf8');
      const sonuc = await firestoreGeriYukleCalistir(ndjson, { kuruCalistirma: true });
      assert.equal(sonuc.kuruCalistirma, true);

      const doc = await db.collection('settings').doc('system').get();
      assert.equal(doc.exists, false);
    },
  },
  {
    name: 'Kolektif filtre yalnizca secilen koleksiyonu geri yukler',
    run: async () => {
      await clearAllKnownCollections();
      await db.collection('settings').doc('system').set({ ilceId: '1111', ilceAdi: 'A', hicriDuzeltme: 0 });
      await db.collection('config').doc('c1').set({ anahtar: 'deger' });
      await firestoreYedekleCalistir(TEST_DOSYA);
      await db.recursiveDelete(db.collection('settings'));
      await db.recursiveDelete(db.collection('config'));

      const ndjson = readFileSync(TEST_DOSYA, 'utf8');
      await firestoreGeriYukleCalistir(ndjson, { kuruCalistirma: false, koleksiyonFiltresi: 'settings' });

      const settingsDoc = await db.collection('settings').doc('system').get();
      assert.equal(settingsDoc.exists, true);
      const configDoc = await db.collection('config').doc('c1').get();
      assert.equal(configDoc.exists, false);
    },
  },
  {
    name: 'Fail-closed: yedekKapsam.ts disinda bilinmeyen bir koleksiyon varsa yedekleme reddedilir',
    run: async () => {
      await clearAllKnownCollections();
      await db.collection('bilinmeyen_koleksiyon_test').doc('x').set({ a: 1 });

      await assert.rejects(() => firestoreYedekleCalistir(TEST_DOSYA), /Fail-closed/);

      await db.recursiveDelete(db.collection('bilinmeyen_koleksiyon_test'));
    },
  },
  {
    name: 'Kota tavani asilinca yedek IPTAL edilir, dosya yazilmaz, admin uyarisi acilir',
    run: async () => {
      await clearAllKnownCollections();
      await db.collection('settings').doc('system').set({ ilceId: '1111', ilceAdi: 'A', hicriDuzeltme: 0 });
      await db.collection('config').doc('c1').set({ anahtar: 'deger' });
      await db.collection('config').doc('c2').set({ anahtar: 'deger2' });

      const sonuc = await firestoreYedekleCalistir(TEST_DOSYA, 2);
      assert.equal(sonuc.iptalEdildi, true);
      assert.equal(sonuc.dosyaYolu, null);
      assert.equal(existsSync(TEST_DOSYA), false);

      const uyari = await db.collection('adminUyarilari').doc('otomasyon_yedek-iptal_firestore-yedekle').get();
      assert.equal(uyari.exists, true);
      assert.equal(uyari.data()?.tip, 'otomasyonHatasi');
    },
  },
  {
    // DIKKAT: adminUyarilari'nin KENDISI de YEDEKLENECEK_KOLEKSIYONLAR'da —
    // iptal uyarisinin yazilmasi toplam sayaci +1 kalici olarak artirir (cozuldu
    // olsa da belge silinmez). Tavan/veri sayilari bu +1'i hesaba katacak
    // sekilde secilmistir.
    name: 'Kapsam normale donunce onceki yedek-iptal uyarisi otomatik cozulur',
    run: async () => {
      await clearAllKnownCollections();
      await db.collection('config').doc('c1').set({ a: 1 });
      await db.collection('config').doc('c2').set({ a: 2 });
      await db.collection('config').doc('c3').set({ a: 3 });
      await db.collection('config').doc('c4').set({ a: 4 });
      const iptalSonuc = await firestoreYedekleCalistir(TEST_DOSYA, 3);
      assert.equal(iptalSonuc.iptalEdildi, true); // config=4 > tavan=3

      // Iki belge silinir: config=2. Ama iptal uyarisi adminUyarilari'na
      // yazildigindan gercek toplam config(2)+adminUyarilari(1)=3, tavan=3'e
      // esit — asilmiyor, basarili olmali.
      await db.collection('config').doc('c3').delete();
      await db.collection('config').doc('c4').delete();
      const basariliSonuc = await firestoreYedekleCalistir(TEST_DOSYA, 3);
      assert.equal(basariliSonuc.iptalEdildi, false);

      const uyari = await db.collection('adminUyarilari').doc('otomasyon_yedek-iptal_firestore-yedekle').get();
      assert.equal(uyari.data()?.cozuldu, true);
      assert.ok(uyari.data()?.cozulmeTarihi);
    },
  },
  {
    name: 'Bos koleksiyonlar hata uretmez, yedek dosyasi yine de olusur',
    run: async () => {
      await clearAllKnownCollections();
      // Hicbir koleksiyona veri eklenmez — tum YEDEKLENECEK_KOLEKSIYONLAR bos.
      const sonuc = await firestoreYedekleCalistir(TEST_DOSYA);
      assert.equal(sonuc.iptalEdildi, false);
      assert.equal(sonuc.toplamBelge, 0);
      assert.ok(existsSync(TEST_DOSYA));

      const ndjson = readFileSync(TEST_DOSYA, 'utf8');
      const geriYuklemeSonuc = await firestoreGeriYukleCalistir(ndjson, { kuruCalistirma: false });
      assert.equal(geriYuklemeSonuc.toplamBelge, 0);
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
    if (existsSync(TEST_DOSYA)) rmSync(TEST_DOSYA);
    process.exit(0);
  }
}

main();
