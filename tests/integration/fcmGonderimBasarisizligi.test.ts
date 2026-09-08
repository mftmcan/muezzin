process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import assert from 'node:assert/strict';
import { db } from '../../scripts/lib/firebaseAdminInit.ts';
import { fcmGonderVeTemizle, type FcmGonderici, type FcmMessage } from '../../scripts/lib/fcmNotify.ts';
import { processDuyuruBildirimleri } from '../../scripts/duyuruBildirimGonder.ts';
import { processIzinDurumBildirimleri } from '../../scripts/izinDurumBildirimGonder.ts';
import { processYatsiSonuIslemleri, hedefGunuBelirle } from '../../scripts/yatsiSonuIslemleri.ts';
import { getTurkeyNow } from '../../src/lib/dateUtils.ts';

// Kok neden (kod denetimi): fcmGonderVeTemizle basarisizliklari yalnizca
// SAYIP normal donuyordu. Cagiranlar donusun ardindan kosulsuz olarak
// `bildirimGonderildi: true` yaziyor / `cronDurumu` sentinel'ini atiyordu,
// yani TAM bir FCM arizasinda (suresi dolmus servis hesabi, proje duzeyinde
// messaging kapali, tum tokenlar reddedildi) push kalici olarak kayboluyor,
// ustelik script 0 ile ciktigi icin .github/workflows/*.yml'deki
// `if: success()` adimi (reportWorkflowSuccess.ts) ONCEKI gercek bir arizanin
// admin uyarisini da otomatik cozuyordu.
//
// Bu suit gercek FCM'e cikmadan (yalnizca Firestore emule edilir) sahte bir
// gonderici enjekte ederek o zinciri uctan uca dogrular.

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

const KOLEKSIYONLAR = ['muezzins', 'duyurular', 'izinler', 'bildirimler', 'cronDurumu', 'adminUyarilari'];

async function clearCollections() {
  for (const collection of KOLEKSIYONLAR) {
    const snapshot = await db.collection(collection).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

/** Hicbir mesajin iletilemedigi, BEKLENMEYEN (bayat token olmayan) ariza. */
const tamArizaGonderici: FcmGonderici = async (parca) => ({
  successCount: 0,
  failureCount: parca.length,
  responses: parca.map(() => ({ success: false, error: { code: 'messaging/authentication-error' } })),
});

/** Tum basarisizliklar bayat token — BEKLENEN, kendiliginden duzelen durum. */
const bayatTokenGonderici: FcmGonderici = async (parca) => ({
  successCount: 0,
  failureCount: parca.length,
  responses: parca.map(() => ({ success: false, error: { code: 'messaging/registration-token-not-registered' } })),
});

/** Ilk mesaj gitti, ikincisi bayat token — normal kismi basarisizlik. */
const kismiGonderici: FcmGonderici = async (parca) => ({
  successCount: 1,
  failureCount: parca.length - 1,
  responses: parca.map((_, i) =>
    i === 0 ? { success: true } : { success: false, error: { code: 'messaging/registration-token-not-registered' } }
  ),
});

function mesaj(token: string): FcmMessage {
  return { token, notification: { title: 'T', body: 'B' }, data: { type: 'test' } };
}

function tarihStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fcmHatasiMi(err: unknown): boolean {
  return err instanceof Error && err.name === 'FcmGonderimBasarisizHatasi';
}

const tests: TestCase[] = [
  {
    name: 'fcmGonderVeTemizle: tam ariza (beklenmeyen hata) FIRLATIR',
    run: async () => {
      await clearCollections();
      await assert.rejects(
        () => fcmGonderVeTemizle([mesaj('t1'), mesaj('t2')], { t1: 'u1', t2: 'u1' }, 'Test', tamArizaGonderici),
        fcmHatasiMi
      );
    },
  },
  {
    name: 'fcmGonderVeTemizle: tum basarisizliklar bayat token ise FIRLATMAZ (kendiliginden duzelir) ve tokenlari temizler',
    run: async () => {
      await clearCollections();
      await db
        .collection('muezzins')
        .doc('u1')
        .set({
          displayName: 'U1',
          role: 'muezzin',
          aktif: true,
          fcmTokens: { t1: true, t2: true },
        });

      const sonuc = await fcmGonderVeTemizle([mesaj('t1'), mesaj('t2')], { t1: 'u1', t2: 'u1' }, 'Test', bayatTokenGonderici);
      assert.equal(sonuc.basarili, 0);
      assert.equal(sonuc.basarisiz, 2);
      assert.equal(sonuc.beklenmeyenBasarisiz, 0);

      const doc = await db.collection('muezzins').doc('u1').get();
      assert.deepEqual(doc.data()?.fcmTokens, {});
    },
  },
  {
    name: 'fcmGonderVeTemizle: kismi basarisizlik olumcul DEGIL',
    run: async () => {
      await clearCollections();
      await db
        .collection('muezzins')
        .doc('u1')
        .set({
          displayName: 'U1',
          role: 'muezzin',
          aktif: true,
          fcmTokens: { t1: true, t2: true },
        });

      const sonuc = await fcmGonderVeTemizle([mesaj('t1'), mesaj('t2')], { t1: 'u1', t2: 'u1' }, 'Test', kismiGonderici);
      assert.equal(sonuc.basarili, 1);
      assert.equal(sonuc.basarisiz, 1);
      assert.equal(sonuc.beklenmeyenBasarisiz, 0);
    },
  },
  {
    name: 'Duyuru: FCM tamamen basarisiz olursa bildirimGonderildi FALSE kalir (yeniden denenir)',
    run: async () => {
      await clearCollections();
      await db
        .collection('muezzins')
        .doc('u1')
        .set({
          displayName: 'U1',
          role: 'muezzin',
          aktif: true,
          fcmTokens: { t1: true },
        });
      const duyuruRef = db.collection('duyurular').doc('d1');
      await duyuruRef.set({ baslik: 'Test', icerik: 'Icerik', tip: 'duyuru', bildirimGonderildi: false });

      await assert.rejects(() => processDuyuruBildirimleri(false, tamArizaGonderici), fcmHatasiMi);

      const doc = await duyuruRef.get();
      assert.equal(doc.data()?.bildirimGonderildi, false);
    },
  },
  {
    name: 'Duyuru: basarili gonderimde bildirimGonderildi true olur (kontrol grubu)',
    run: async () => {
      await clearCollections();
      await db
        .collection('muezzins')
        .doc('u1')
        .set({
          displayName: 'U1',
          role: 'muezzin',
          aktif: true,
          fcmTokens: { t1: true },
        });
      const duyuruRef = db.collection('duyurular').doc('d2');
      await duyuruRef.set({ baslik: 'Test', icerik: 'Icerik', tip: 'duyuru', bildirimGonderildi: false });

      const basariliGonderici: FcmGonderici = async (parca) => ({
        successCount: parca.length,
        failureCount: 0,
        responses: parca.map(() => ({ success: true })),
      });
      await processDuyuruBildirimleri(false, basariliGonderici);

      const doc = await duyuruRef.get();
      assert.equal(doc.data()?.bildirimGonderildi, true);
    },
  },
  {
    name: 'Izin durumu: FCM tamamen basarisiz olursa bildirimGonderildi FALSE kalir',
    run: async () => {
      await clearCollections();
      await db
        .collection('muezzins')
        .doc('u1')
        .set({
          displayName: 'U1',
          role: 'muezzin',
          aktif: true,
          fcmTokens: { t1: true },
        });
      const izinRef = db.collection('izinler').doc('i1');
      await izinRef.set({
        uid: 'u1',
        baslangic: '2099-01-01',
        bitis: '2099-01-02',
        tip: 'mazeret',
        durum: 'onaylandi',
        bildirimGonderildi: false,
      });

      await assert.rejects(() => processIzinDurumBildirimleri(false, tamArizaGonderici), fcmHatasiMi);

      const doc = await izinRef.get();
      assert.equal(doc.data()?.bildirimGonderildi, false);
    },
  },
  {
    name: 'Yatsi sonu: FCM tamamen basarisiz olursa gunluk hatirlatma sentineli YAZILMAZ ve script hata ile biter',
    run: async () => {
      await clearCollections();

      const hedefGun = hedefGunuBelirle(getTurkeyNow());
      const yarin = new Date(hedefGun);
      yarin.setDate(yarin.getDate() + 1);
      const yarinStr = tarihStr(yarin);

      await db
        .collection('muezzins')
        .doc('u1')
        .set({
          displayName: 'U1',
          role: 'muezzin',
          aktif: true,
          fcmTokens: { t1: true },
        });
      await db.collection('bildirimler').doc('yarin_sabah_asil').set({
        haftaId: 'WTEST',
        tarih: yarinStr,
        vakit: 'sabah',
        uid: 'u1',
        tip: 'asil',
        durum: 'bekliyor',
      });

      await assert.rejects(() => processYatsiSonuIslemleri(tamArizaGonderici), fcmHatasiMi);

      const sentinel = await db.collection('cronDurumu').doc(`gunlukHatirlatma_${yarinStr}`).get();
      assert.equal(sentinel.exists, false);
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
