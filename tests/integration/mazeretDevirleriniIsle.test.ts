process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import assert from 'node:assert/strict';
import { db } from '../../scripts/lib/firebaseAdminInit.ts';
import { processMazeretDevirleri } from '../../scripts/mazeretDevirleriniIsle.ts';
import { getTurkeyDateString, getTurkeyNow } from '../../src/lib/dateUtils.ts';

// scripts/mazeretDevirleriniIsle.ts artık sorgusunu `tarih >= otuzGunOnce`
// ile son 30 günle sınırlıyor (bkz. Firebase/GitHub veri akışı optimizasyonu)
// — bu yüzden test verisi sabit 2026 tarihleri yerine "bugün - N gün" olarak
// hesaplanır, aksi halde zaman geçtikçe testler pencerenin dışına düşüp
// sessizce hiçbir belgeyi bulamaz.
function gunOnce(n: number): string {
  return getTurkeyDateString(new Date(getTurkeyNow().getTime() - n * 24 * 60 * 60 * 1000));
}

const TARIH_1 = gunOnce(3);
const TARIH_2 = gunOnce(2);
const TARIH_3 = gunOnce(1);

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

async function clearCollections() {
  const collections = ['muezzins', 'bildirimler', 'haftaPlanlari', 'adminUyarilari'];
  for (const collection of collections) {
    const snapshot = await db.collection(collection).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  }
}

const tests: TestCase[] = [
  {
    name: 'Yedek gorevli varsa asil olarak atanir',
    run: async () => {
      await clearCollections();

      // Seed Muezzins
      await db.collection('muezzins').doc('muezzin_asil').set({
        displayName: 'Asil',
        role: 'muezzin',
        aktif: true,
      });
      await db.collection('muezzins').doc('muezzin_yedek').set({
        displayName: 'Yedek',
        role: 'muezzin',
        aktif: true,
      });

      // Seed Hafta Plani
      await db
        .collection('haftaPlanlari')
        .doc('W2026-05-18')
        .set({
          gunler: {
            [TARIH_1]: {
              sabah: { asil: 'muezzin_asil', yedek: 'muezzin_yedek' },
            },
          },
        });

      // Seed Notifications — "1000 ifade tavanı" kök neden çözümü sonrası
      // istemci (mazeretServisi.ts'deki transaction) yedek belgeye HİÇ
      // dokunmaz — yalnızca kendi asil belgesine devirSonucu='yedek_atandi'
      // İPUCUNU yazar. GERÇEK terfi (yedek belgenin tip:'yedek' -> 'asil'
      // geçişi, taze veriyle yeniden doğrulanarak) burada, script'te
      // gerçekleşir (bkz. scripts/mazeretDevirleriniIsle.ts yorumu).
      // ID'ler deterministiktir: {haftaId}_{tarih}_{vakit}_{asil|yedek}
      // (bkz. README) — mazeretDevirleriniIsle.ts, yedek dokümanını tam
      // olarak bu şemayla türetip arıyor.
      const mazeretRef = db.collection('bildirimler').doc(`W2026-05-18_${TARIH_1}_sabah_asil`);
      await mazeretRef.set({
        haftaId: 'W2026-05-18',
        tarih: TARIH_1,
        vakit: 'sabah',
        uid: 'muezzin_asil',
        tip: 'asil',
        durum: 'reddedildi', // Mazeret bildirilmis
        devirSonucu: 'yedek_atandi',
        mazeretPlanSenkronEdildi: false,
      });

      const yedekRef = db.collection('bildirimler').doc(`W2026-05-18_${TARIH_1}_sabah_yedek`);
      await yedekRef.set({
        haftaId: 'W2026-05-18',
        tarih: TARIH_1,
        vakit: 'sabah',
        uid: 'muezzin_yedek',
        tip: 'yedek', // istemci HENUZ terfi ettirmedi — script'in kendisi terfi ettirecek
        durum: 'bekliyor',
      });

      // Act
      await processMazeretDevirleri(false);

      // Assert
      const mazeretDoc = await mazeretRef.get();
      assert.equal(mazeretDoc.data()?.mazeretPlanSenkronEdildi, true);
      assert.equal(mazeretDoc.data()?.devirSonucu, 'yedek_atandi');

      const yedekDoc = await yedekRef.get();
      assert.equal(yedekDoc.data()?.tip, 'asil');
      assert.equal(yedekDoc.data()?.durum, 'bekliyor');
      assert.equal(yedekDoc.data()?.pendingAck, true);
      assert.equal(yedekDoc.data()?.asilMazeretUid, 'muezzin_asil');

      // Terfi YERİNDE yapılır: mazeret bildirenin `..._asil` belgesi denetim
      // izi (ve `mazeretPlanSenkronEdildi` idempotans işareti) olarak KALIR,
      // `tip`i hâlâ 'asil'dir — yani slotta `tip === 'asil'` olan İKİ belge
      // olur. src/lib/slotKorumasi.ts `guncelSlotBildirimleriniSec` bu
      // kasıtlı çift kaydı çözer (reddedilmemiş / en güncel olan kazanır);
      // burada tam olarak o fonksiyonun dayandığı veri şekli sabitleniyor.
      // Bu iki assertion düşerse (ör. terfi eski belgeyi de silmeye/
      // etiketlemeye başlarsa) slotKorumasi.ts'in seçim kuralı gözden
      // geçirilmelidir.
      assert.equal(mazeretDoc.data()?.tip, 'asil');
      assert.equal(mazeretDoc.data()?.uid, 'muezzin_asil');

      const haftaDoc = await db.collection('haftaPlanlari').doc('W2026-05-18').get();
      assert.equal(haftaDoc.data()?.gunler[TARIH_1].sabah.asil, 'muezzin_yedek');
      assert.equal(haftaDoc.data()?.gunler[TARIH_1].sabah.yedek, 'Sistem');
    },
  },
  {
    // Yedek, istemcinin karar anından bu yana (script'in ~10-15 dk'lık
    // gecikme penceresinde) arşivlenmiş/pasifleşmiş olabilir — istemcinin
    // 'yedek_atandi' İPUCUNA GÜVENİLMEZ, script taze veriyle yeniden
    // doğrular ve uygun değilse alarm_bekliyor'a düşürüp admin uyarısı
    // oluşturur.
    name: 'Karar sonrasi pasiflesen yedek terfi ettirilmez, alarm_bekliyor a dusurulur',
    run: async () => {
      await clearCollections();

      await db.collection('muezzins').doc('muezzin_asil').set({
        displayName: 'Asil',
        role: 'muezzin',
        aktif: true,
      });
      await db.collection('muezzins').doc('muezzin_yedek').set({
        displayName: 'Yedek',
        role: 'muezzin',
        aktif: false, // karar sonrasi pasiflesti
      });

      const mazeretRef = db.collection('bildirimler').doc(`W2026-05-18_${TARIH_1}_sabah_asil`);
      await mazeretRef.set({
        haftaId: 'W2026-05-18',
        tarih: TARIH_1,
        vakit: 'sabah',
        uid: 'muezzin_asil',
        tip: 'asil',
        durum: 'reddedildi',
        devirSonucu: 'yedek_atandi',
        mazeretPlanSenkronEdildi: false,
      });
      const yedekRef = db.collection('bildirimler').doc(`W2026-05-18_${TARIH_1}_sabah_yedek`);
      await yedekRef.set({
        haftaId: 'W2026-05-18',
        tarih: TARIH_1,
        vakit: 'sabah',
        uid: 'muezzin_yedek',
        tip: 'yedek',
        durum: 'bekliyor',
      });

      await processMazeretDevirleri(false);

      const yedekDoc = await yedekRef.get();
      assert.equal(yedekDoc.data()?.tip, 'yedek'); // terfi ETTİRİLMEDİ

      const mazeretDoc = await mazeretRef.get();
      assert.equal(mazeretDoc.data()?.mazeretPlanSenkronEdildi, true);
      assert.equal(mazeretDoc.data()?.devirSonucu, 'alarm_uretildi');

      const alarmSnap = await db.collection('adminUyarilari').where('cozuldu', '==', false).get();
      assert.equal(alarmSnap.size, 1);
      assert.equal(alarmSnap.docs[0]!.data().tarih, TARIH_1);
    },
  },
  {
    name: 'Yedek yoksa admin uyarisi uretilir',
    run: async () => {
      await clearCollections();

      // Seed Muezzins
      await db.collection('muezzins').doc('muezzin_asil').set({
        displayName: 'Asil',
        role: 'muezzin',
        aktif: true,
      });
      // No active yedek

      // Seed Notifications — istemci uygun bir yedek bulamadigi icin
      // devirSonucu='alarm_bekliyor' yazmis olarak kabul edilir.
      const mazeretRef = db.collection('bildirimler').doc('bildirim_asil_2');
      await mazeretRef.set({
        haftaId: 'W2026-05-18',
        tarih: TARIH_2,
        vakit: 'ogle',
        uid: 'muezzin_asil',
        tip: 'asil',
        durum: 'reddedildi', // Mazeret
        devirSonucu: 'alarm_bekliyor',
        mazeretPlanSenkronEdildi: false,
      });

      // Act
      await processMazeretDevirleri(false);

      // Assert
      const mazeretDoc = await mazeretRef.get();
      assert.equal(mazeretDoc.data()?.mazeretPlanSenkronEdildi, true);
      assert.equal(mazeretDoc.data()?.devirSonucu, 'alarm_uretildi');

      const alarmSnap = await db.collection('adminUyarilari').get();
      assert.equal(alarmSnap.size, 1);
      const alarm = alarmSnap.docs[0].data();
      assert.equal(alarm.tip, 'zincirTukendi');
      assert.equal(alarm.cozuldu, false);
      assert.equal(alarm.tarih, TARIH_2);
      assert.equal(alarm.vakit, 'ogle');
    },
  },
  {
    // Y2 regresyonu: iki bağımsız uzlaştırma cron'u (mazeret + vekalet) eskiden
    // aynı paylaşılan `planSenkronEdildi` bayrağını kullanıyordu. Bir bildirim
    // önce vekaletle senkronlanıp (vekaletPlanSenkronEdildi:true) sonra AYNI
    // belge yeni sahibi tarafından mazeretle reddedilirse, mazeret cron'u
    // paylaşılan bayrağın zaten true olduğunu görüp belgeyi tamamen
    // atlıyordu — vakit görevlisiz kalıyor, hiçbir admin uyarısı üretilmiyordu.
    // Bu test, ayrılmış alanlarla mazeret olayının artık İŞLENDİĞİNİ doğrular.
    name: 'Vekaletle senkronlanmis bir bildirim, sonraki mazeret reddi hala islenir (Y2 regresyonu)',
    run: async () => {
      await clearCollections();

      await db.collection('muezzins').doc('muezzin_asil').set({
        displayName: 'Asil',
        role: 'muezzin',
        aktif: true,
      });
      // No active yedek — devirSonucu alarm_bekliyor olacak.

      const bildirimRef = db.collection('bildirimler').doc('bildirim_asil_3');
      await bildirimRef.set({
        haftaId: 'W2026-05-18',
        tarih: TARIH_3,
        vakit: 'ikindi',
        uid: 'muezzin_asil',
        tip: 'asil',
        durum: 'reddedildi', // Mazeret bu kez
        devirSonucu: 'alarm_bekliyor',
        // Bu belge DAHA ÖNCE bir vekalet devriyle senkronlanmış — paylaşılan
        // bayrak kullanılsaydı mazeret cron'u bunu "zaten işlenmiş" sanırdı.
        vekaletPlanSenkronEdildi: true,
      });

      await processMazeretDevirleri(false);

      const bildirimDoc = await bildirimRef.get();
      assert.equal(bildirimDoc.data()?.mazeretPlanSenkronEdildi, true);
      assert.equal(bildirimDoc.data()?.devirSonucu, 'alarm_uretildi');

      const alarmSnap = await db.collection('adminUyarilari').get();
      assert.equal(alarmSnap.size, 1);
      assert.equal(alarmSnap.docs[0].data().tarih, TARIH_3);
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
