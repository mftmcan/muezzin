process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import assert from 'node:assert/strict';
import { db } from '../../scripts/lib/firebaseAdminInit.ts';
import { fixInvalidRoleAssignments } from '../../scripts/fix-invalid-role-assignments.ts';
import { getTurkeyDateString, getTurkeyNow } from '../../src/lib/dateUtils.ts';

// Bu operator script'i (--apply ile elle calistirilir) bir gunun BUTUN
// vakitlerini yeniden atayip `bildirimler` belgelerini SILIP yeniden
// olusturur. Dokunmamasi gereken gunler icin bir atlama guvenlik agi var
// (`puanIslendi` — yatsiSonuIslemleri.ts o gunu ZATEN kredilendirmisse geriye
// donuk duzeltilemeyen bir tutarsizlik olusurdu). Bu suit o agin GERCEKTEN
// tuttugunu dogrular; ozellikle `haftaPlanlari` yaziminin da atlandigini —
// kontrol daha once plan guncellemeleri batch'e eklendikten SONRA
// yapildigindan "hic dokunmadan atla" sozu plan tarafinda tutulmuyordu.

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

const HAFTA_ID = 'WTEST';
const VAKITLER = ['sabah', 'ogle', 'ikindi', 'aksam', 'yatsi'] as const;

async function clearCollections() {
  for (const collection of ['muezzins', 'haftaPlanlari', 'bildirimler']) {
    const snapshot = await db.collection(collection).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

function gelecekTarih(gunSonra: number): string {
  const d = getTurkeyNow();
  d.setDate(d.getDate() + gunSonra);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Bes vaktin tamami gecersiz bir asil (arsivlenmis muezzin) tasiyan bir gun. */
async function seedGecersizGun(tarih: string) {
  await db.collection('muezzins').doc('m1').set({ displayName: 'M1', role: 'muezzin', aktif: true });
  await db.collection('muezzins').doc('m2').set({ displayName: 'M2', role: 'muezzin', aktif: true });
  await db.collection('muezzins').doc('arsiv').set({ displayName: 'Arsiv', role: 'muezzin', aktif: false });

  const gun: Record<string, { asil: string; yedek: string }> = {};
  VAKITLER.forEach((v) => {
    gun[v] = { asil: 'arsiv', yedek: 'm2' };
  });
  await db
    .collection('haftaPlanlari')
    .doc(HAFTA_ID)
    .set({
      haftaBaslangic: tarih,
      haftaBitis: tarih,
      durum: 'yayinda',
      gunler: { [tarih]: gun },
    });
}

function bildirimId(tarih: string, vakit: string, tip: string): string {
  return `${HAFTA_ID}_${tarih}_${vakit}_${tip}`;
}

async function seedBildirim(tarih: string, vakit: string, tip: string, ekstra: Record<string, unknown>) {
  await db
    .collection('bildirimler')
    .doc(bildirimId(tarih, vakit, tip))
    .set({
      haftaId: HAFTA_ID,
      tarih,
      vakit,
      uid: 'arsiv',
      tip,
      durum: 'bekliyor',
      pendingAck: true,
      ...ekstra,
    });
}

const tests: TestCase[] = [
  {
    name: 'puanIslendi:true olan bir gun HIC dokunulmaz — bayrak korunur',
    run: async () => {
      await clearCollections();
      const tarih = getTurkeyDateString();
      await seedGecersizGun(tarih);
      await seedBildirim(tarih, 'sabah', 'asil', { durum: 'onaylandi', puanIslendi: true });

      const ozet = await fixInvalidRoleAssignments(true);
      assert.equal(ozet.fixedDays, 0);
      assert.equal(ozet.pastInvalidDays, 1);

      const bildirim = await db
        .collection('bildirimler')
        .doc(bildirimId(tarih, 'sabah', 'asil'))
        .get();
      assert.equal(bildirim.exists, true);
      assert.equal(bildirim.data()?.puanIslendi, true, 'puanIslendi silinmemeli — aksi halde yatsiSonuIslemleri ikinci kez kredilendirir');
      assert.equal(bildirim.data()?.uid, 'arsiv');
      assert.equal(bildirim.data()?.durum, 'onaylandi');
    },
  },
  {
    name: 'Atlanan gunun haftaPlanlari belgesi de yazilmaz (plan<->bildirim tutarsizligi olusmaz)',
    run: async () => {
      await clearCollections();
      const tarih = getTurkeyDateString();
      await seedGecersizGun(tarih);
      await seedBildirim(tarih, 'sabah', 'asil', { durum: 'onaylandi', puanIslendi: true });

      await fixInvalidRoleAssignments(true);

      const plan = await db.collection('haftaPlanlari').doc(HAFTA_ID).get();
      const gun = plan.data()?.gunler?.[tarih];
      assert.equal(gun?.sabah?.asil, 'arsiv', 'atlanan gunde plan da degismemeli');
      assert.equal(gun?.yatsi?.asil, 'arsiv');
    },
  },
  {
    name: 'Uygulanmis/bekleyen gorev devri (vekaletDevredildi) olan gun de atlanir',
    run: async () => {
      await clearCollections();
      const tarih = getTurkeyDateString();
      await seedGecersizGun(tarih);
      await seedBildirim(tarih, 'sabah', 'asil', { uid: 'm2', vekaletDevredildi: true });

      const ozet = await fixInvalidRoleAssignments(true);
      assert.equal(ozet.fixedDays, 0);

      const bildirim = await db
        .collection('bildirimler')
        .doc(bildirimId(tarih, 'sabah', 'asil'))
        .get();
      assert.equal(bildirim.data()?.vekaletDevredildi, true);
      assert.equal(bildirim.data()?.uid, 'm2');
    },
  },
  {
    name: 'Korunmasi gereken bayragi olmayan gelecek gun GERCEKTEN duzeltilir (kontrol grubu)',
    run: async () => {
      await clearCollections();
      const tarih = gelecekTarih(30);
      await seedGecersizGun(tarih);
      await seedBildirim(tarih, 'sabah', 'asil', {});

      const ozet = await fixInvalidRoleAssignments(true);
      assert.equal(ozet.fixedDays, 1);
      assert.equal(ozet.pastInvalidDays, 0);

      const plan = await db.collection('haftaPlanlari').doc(HAFTA_ID).get();
      assert.equal(plan.data()?.gunler?.[tarih]?.sabah?.asil, 'm1');
      assert.equal(plan.data()?.gunler?.[tarih]?.sabah?.yedek, 'm2');

      const bildirim = await db
        .collection('bildirimler')
        .doc(bildirimId(tarih, 'sabah', 'asil'))
        .get();
      assert.equal(bildirim.exists, true);
      assert.equal(bildirim.data()?.uid, 'm1');
      assert.equal(bildirim.data()?.puanIslendi, undefined);
    },
  },
  {
    name: 'Kuru calistirma hicbir sey yazmaz',
    run: async () => {
      await clearCollections();
      const tarih = gelecekTarih(30);
      await seedGecersizGun(tarih);

      const ozet = await fixInvalidRoleAssignments(false);
      assert.equal(ozet.fixedDays, 1);

      const plan = await db.collection('haftaPlanlari').doc(HAFTA_ID).get();
      assert.equal(plan.data()?.gunler?.[tarih]?.sabah?.asil, 'arsiv');
      const bildirim = await db
        .collection('bildirimler')
        .doc(bildirimId(tarih, 'sabah', 'asil'))
        .get();
      assert.equal(bildirim.exists, false);
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
