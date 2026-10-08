// mazeret_detaylari koleksiyonu testleri: ret kaydi yazma kurallari,
// okuma/listeleme yetkileri ve varlik sizdirmasi.
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { TestCase, testUser, mazeretRetBatch, PENCERE_ACIK } from './ortak.ts';

export const tests: TestCase[] = [
  {
    // Altinci denetim turu bulgusu (regresyon kaniti): eslesen bir
    // mazeret_detaylari yazimi olmadan salt bildirimler guncellemesi artik
    // basarisiz olmali — retSebebi'nin dogrudan bildirimler'e yazilabildigi
    // ESKI davranisin geri gelmedigini dogrular.
    name: 'mazeret_detaylari eslesen kaydi olmadan asil mazeret reddi basarisiz olur',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        updateDoc(doc(db, 'bildirimler/ownPendingAsil'), {
          durum: 'reddedildi',
          pendingAck: false,
          devirSonucu: 'alarm_bekliyor',
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    // Kod denetimi guvenlik bulgusu (regresyon kaniti): `incoming().uid ==
    // request.auth.uid` tek basina bir baskasinin nobetinin mazeret_detaylari
    // ID'sini onceden "isgal etmeyi" engellemiyordu — belge var oldugunda
    // update daima `if false` oldugundan, gercek sahip daha sonra AYNI ID'ye
    // yazmaya calistiginda kalici olarak reddediliyordu (bkz. firestore.rules
    // mazeret_detaylari create kurali). muezzin1, muezzin2'ye ait
    // otherPendingAsil'in ID'sini kendi uid'iyle isgal etmeye calisir ve
    // artik bildirimId->bildirim.uid capraz dogrulamasiyla reddedilmelidir.
    name: 'muezzin baskasinin nobetinin mazeret_detaylari ID sini isgal edemez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'mazeret_detaylari/otherPendingAsil'), {
          uid: 'muezzin1',
          retSebebi: 'Baskasinin nobetini isgal etme denemesi',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // Premium hata analizi FR-O8 regresyonu: admin bir bildirimi tekrar
    // 'bekliyor'a actiginda, ayni kisi ayni deterministik ID'ye tekrar
    // mazeret bildirebilmeli. Duzeltmeden once bu bir `update` sayilip
    // `allow update: if false` altinda KALICI OLARAK reddediliyordu.
    name: 'mazeret_detaylari, admin bildirimi yeniden bekliyor a acinca tekrar yazilabilir (FR-O8 regresyonu)',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(mazeretRetBatch(db, 'ownPendingAsil', 'muezzin1', 'Ilk mazeret', { devirSonucu: 'alarm_bekliyor' }));

      // Admin mudahalesi: bildirimi yeniden 'bekliyor'a acar (kurallar
      // devre disi, gercek admin dalinin taklidi — bu davranis zaten
      // isValidBildirim admin dalinda serbest).
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'bildirimler/ownPendingAsil'), {
          haftaId: 'W2026-05-18',
          tarih: '2026-05-20',
          vakit: 'ogle',
          uid: 'muezzin1',
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
          mazeretSonBasvuru: PENCERE_ACIK(),
        });
      });

      await assertSucceeds(
        mazeretRetBatch(db, 'ownPendingAsil', 'muezzin1', 'Ikinci mazeret (yeniden acildi)', { devirSonucu: 'alarm_bekliyor' })
      );

      const detay = await getDoc(doc(db, 'mazeret_detaylari/ownPendingAsil'));
      assert.equal(detay.data()?.retSebebi, 'Ikinci mazeret (yeniden acildi)');
    },
  },
  {
    // Degismezlik korunuyor: bildirim yeniden acilmadan (hala 'reddedildi')
    // ayni ID'ye ikinci bir yazim hala reddedilmeli.
    name: 'mazeret_detaylari, bildirim yeniden bekliyor a donmedikce tekrar yazilamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(mazeretRetBatch(db, 'ownPendingYedek', 'muezzin1', 'Ilk mazeret', { devirSonucu: 'alarm_bekliyor' }));
      await assertFails(mazeretRetBatch(db, 'ownPendingYedek', 'muezzin1', 'Ikinci deneme', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    // Altinci denetim turu bulgusu (asil guvenlik acigi regresyon kaniti):
    // retSebebi tasindiktan sonra ayri koleksiyon yalnizca ilgili kisi veya
    // admin tarafindan okunabilmeli — herhangi bir baska giris yapmis
    // kullanici OKUYAMAMALI (onceden bildirimler uzerinden herkese acikti).
    name: 'mazeret_detaylari yalnizca ilgili kisi veya admin tarafindan okunabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'mazeret_detaylari/ozelMazeretKaydi'), {
          uid: 'muezzin1',
          retSebebi: 'Cok ozel bir saglik durumu',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const digerKullanici = testUser(env, 'muezzin2').firestore();
      await assertFails(getDoc(doc(digerKullanici, 'mazeret_detaylari/ozelMazeretKaydi')));

      const sahibi = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(getDoc(doc(sahibi, 'mazeret_detaylari/ozelMazeretKaydi')));

      const adminDb = testUser(env, 'admin').firestore();
      await assertSucceeds(getDoc(doc(adminDb, 'mazeret_detaylari/ozelMazeretKaydi')));
    },
  },
  {
    name: 'mazeret_detaylari yalnizca admin tarafindan listelenebilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(getDocs(collection(db, 'mazeret_detaylari')));

      const adminDb = testUser(env, 'admin').firestore();
      await assertSucceeds(getDocs(collection(adminDb, 'mazeret_detaylari')));
    },
  },
  {
    // vekalet_talepleri'ndeki ayni sinif bug (bkz. o kuraldaki O10 yorumu):
    // var olmayan bir mazeret_detaylari ID'sine getDoc atmak, admin OLMAYAN
    // bir kullanici icin `resource.data.uid` null-deref hatasiyla
    // reddediliyordu. Bu koleksiyonda henuz gercek bir non-admin cagiran yok
    // ama kural tutarliligi/savunma derinligi icin duzeltildi.
    name: 'muezzin henuz var olmayan bir mazeret_detaylari kaydini get ile sorgulayabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(getDoc(doc(db, 'mazeret_detaylari/hicOlusturulmamisKayit')));
    },
  },
  {
    // Varlik orakulu regresyonu: `resource == null` dali eskiden
    // `isSignedIn()` KAPSAMININ DISINDAYDI, yani giris yapmamis bir cagiran
    // icin "belge yok" -> get BASARILI, "belge var" -> get REDDEDILDI
    // seklinde ayirt edilebiliyordu. Doc ID tamamen deterministik
    // (haftaId_tarih_vakit_tip) oldugundan bu, kimlik dogrulamasi olmadan
    // "hangi nobet icin mazeret bildirilmis" bilgisinin tek tek denenerek
    // cikarilmasina izin veriyordu. `izinler` get kuralindaki dogru yapiyla
    // hizalandi: her iki sonuc da anonim cagiran icin reddedilmeli.
    name: 'anonim kullanici mazeret_detaylari varligini sizdiramaz (varlik orakulu regresyonu)',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const seedDb = context.firestore();
        await setDoc(doc(seedDb, 'mazeret_detaylari/ozelMazeretKaydi'), {
          uid: 'muezzin1',
          retSebebi: 'Cok ozel bir saglik durumu',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = env.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, 'mazeret_detaylari/ozelMazeretKaydi')));
      await assertFails(getDoc(doc(db, 'mazeret_detaylari/hicOlusturulmamisKayit')));
    },
  },
];
