process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import assert from 'node:assert/strict';
import { db, Timestamp } from '../../scripts/lib/firebaseAdminInit.ts';
import { backfillMazeretPenceresi } from '../../scripts/mazeretPenceresiBackfill.ts';
import { getTurkeyDateString, getTurkeyNow, oncekiGunTarihi } from '../../src/lib/dateUtils.ts';

/**
 * `bildirimler.mazeretSonBasvuru` uzlaştırmasının testleri.
 *
 * Bu damga, 1 saatlik mazeret/vekalet penceresinin SUNUCU tarafı zorlayıcısıdır
 * (firestore.rules `mazeretPenceresiAcik`, `request.time` ile karşılaştırılır).
 * Kural FAIL-CLOSED olduğundan, damganın doğru ve zamanında yazılması
 * "kullanıcı mazeret bildirebiliyor mu" sorusunun cevabıdır — bu yüzden
 * hesaplamanın kendisi (özellikle sabah istisnası ve ay sınırı) burada
 * gerçek Firestore verisiyle doğrulanır.
 */

function gunSonra(n: number): string {
  return getTurkeyDateString(new Date(getTurkeyNow().getTime() + n * 24 * 60 * 60 * 1000));
}

const YARIN = gunSonra(1);
const DUN = gunSonra(-1);

type TestCase = { name: string; run: () => Promise<void> };

async function clearCollections() {
  for (const koleksiyon of ['bildirimler', 'vakitler', 'settings']) {
    const snapshot = await db.collection(koleksiyon).get();
    const batch = db.batch();
    snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }
}

async function vakitTohumla(gunler: Record<string, Record<string, unknown>>, ilceId = '9148') {
  await db.collection('settings').doc('system').set({ ilceId }, { merge: true });
  const aylar = new Map<string, Record<string, Record<string, unknown>>>();
  for (const [tarih, kayit] of Object.entries(gunler)) {
    const ay = tarih.slice(0, 7);
    if (!aylar.has(ay)) aylar.set(ay, {});
    aylar.get(ay)![tarih] = kayit;
  }
  for (const [ay, veri] of aylar) {
    await db.collection('vakitler').doc(`${ilceId}_${ay}`).set({ gunler: veri }, { merge: true });
  }
}

async function bildirimTohumla(tarih: string, vakit: string, ek: Record<string, unknown> = {}) {
  const ref = db.collection('bildirimler').doc(`W-test_${tarih}_${vakit}_asil`);
  await ref.set({
    haftaId: 'W-test',
    tarih,
    vakit,
    uid: 'muezzin1',
    tip: 'asil',
    durum: 'bekliyor',
    pendingAck: true,
    ...ek,
  });
  return ref;
}

const tests: TestCase[] = [
  {
    name: 'Damgasiz bir bildirime ezandan 1 saat oncesi yazilir',
    run: async () => {
      await clearCollections();
      await vakitTohumla({ [YARIN]: { ogle: '12:45' } });
      const ref = await bildirimTohumla(YARIN, 'ogle');

      await backfillMazeretPenceresi(false);

      const veri = (await ref.get()).data()!;
      // 12:45 TRT − 1sa = 11:45 TRT = 08:45 UTC
      assert.equal(veri.mazeretSonBasvuru.toDate().toISOString(), `${YARIN}T08:45:00.000Z`);
    },
  },
  {
    name: 'Sabah vakti icin damga, ONCEKI gunun yatsisindan 1 saat SONRASI olur',
    run: async () => {
      await clearCollections();
      const oncekiGun = oncekiGunTarihi(YARIN)!;
      await vakitTohumla({
        [oncekiGun]: { yatsi: '21:18' },
        [YARIN]: { sabah: '04:10', yatsi: '21:19' },
      });
      const ref = await bildirimTohumla(YARIN, 'sabah');

      await backfillMazeretPenceresi(false);

      const veri = (await ref.get()).data()!;
      // Onceki gun 21:18 TRT + 1sa = 22:18 TRT = 19:18 UTC. Sabahin KENDI
      // saatine (04:10) veya AYNI gunun yatsisina gore hesaplanmamali.
      assert.equal(veri.mazeretSonBasvuru.toDate().toISOString(), `${oncekiGun}T19:18:00.000Z`);
    },
  },
  {
    name: 'Bozuk ("abc") ezan saatinde damga YAZILMAZ (fail-closed)',
    run: async () => {
      await clearCollections();
      await vakitTohumla({ [YARIN]: { ogle: 'abc' } });
      const ref = await bildirimTohumla(YARIN, 'ogle');

      await backfillMazeretPenceresi(false);

      assert.equal((await ref.get()).data()!.mazeretSonBasvuru, undefined);
    },
  },
  {
    name: 'Tek haneli saatli ("9:05") deger normalize edilerek yazilir',
    run: async () => {
      await clearCollections();
      await vakitTohumla({ [YARIN]: { ikindi: '9:05' } });
      const ref = await bildirimTohumla(YARIN, 'ikindi');

      await backfillMazeretPenceresi(false);

      const veri = (await ref.get()).data()!;
      // 09:05 TRT − 1sa = 08:05 TRT = 05:05 UTC
      assert.equal(veri.mazeretSonBasvuru.toDate().toISOString(), `${YARIN}T05:05:00.000Z`);
    },
  },
  {
    name: 'Bozuk veri, ONCEDEN yazilmis gecerli bir damgayi silmez/bozmaz',
    run: async () => {
      await clearCollections();
      await vakitTohumla({ [YARIN]: { ogle: 'bozuldu' } });
      const oncekiDamga = Timestamp.fromMillis(Date.now() + 3600 * 1000);
      const ref = await bildirimTohumla(YARIN, 'ogle', { mazeretSonBasvuru: oncekiDamga });

      await backfillMazeretPenceresi(false);

      const veri = (await ref.get()).data()!;
      assert.equal(veri.mazeretSonBasvuru.toMillis(), oncekiDamga.toMillis());
    },
  },
  {
    name: 'Ezan verisi degisirse damga guncellenir (idempotent, degismezse yazmaz)',
    run: async () => {
      await clearCollections();
      await vakitTohumla({ [YARIN]: { aksam: '19:51' } });
      const ref = await bildirimTohumla(YARIN, 'aksam');

      await backfillMazeretPenceresi(false);
      assert.equal((await ref.get()).data()!.mazeretSonBasvuru.toDate().toISOString(), `${YARIN}T15:51:00.000Z`);

      // Vakit verisi duzeltildi — damga takip etmeli.
      await vakitTohumla({ [YARIN]: { aksam: '19:41' } });
      await backfillMazeretPenceresi(false);
      assert.equal((await ref.get()).data()!.mazeretSonBasvuru.toDate().toISOString(), `${YARIN}T15:41:00.000Z`);
    },
  },
  {
    name: 'Gecmis gunlere ait bildirimler islenmez (gereksiz kota harcanmaz)',
    run: async () => {
      await clearCollections();
      await vakitTohumla({ [DUN]: { ogle: '12:45' } });
      const ref = await bildirimTohumla(DUN, 'ogle');

      await backfillMazeretPenceresi(false);

      assert.equal((await ref.get()).data()!.mazeretSonBasvuru, undefined);
    },
  },
  {
    name: 'Kuru calistirma hicbir sey yazmaz',
    run: async () => {
      await clearCollections();
      await vakitTohumla({ [YARIN]: { ogle: '12:45' } });
      const ref = await bildirimTohumla(YARIN, 'ogle');

      await backfillMazeretPenceresi(true);

      assert.equal((await ref.get()).data()!.mazeretSonBasvuru, undefined);
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
