// "PENCERE:" testleri: 1 saatlik mazeret/vekalet zaman penceresinin
// sunucu tarafindaki mazeretSonBasvuru damgasiyla zorlanmasi
// (fail-closed) ve istemci zamani manipulasyonu.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, runTransaction, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { TestCase, testUser, mazeretRetBatch, PENCERE_ACIK, PENCERE_KAPALI } from './ortak.ts';

export const tests: TestCase[] = [
  // ---------------------------------------------------------------
  // 1 SAATLİK MAZERET/VEKALET PENCERESİ — SUNUCU TARAFI (request.time)
  //
  // Kod denetimi bulgusu: bu pencere YALNIZCA istemcide uygulanıyordu ve
  // `getTurkeyNow()`, RTDB zaman senkronu ateşlemezse (offline açılan PWA,
  // engellenmiş RTDB) doğrudan CİHAZ SAATİDİR — saati geri alınmış bir cihaz
  // pencerenin içinde mazeret/vekalet yazabiliyordu. Artık kural,
  // `bildirimler.mazeretSonBasvuru` damgasını Firestore'un KENDİ `request.time`
  // değeriyle karşılaştırıyor (bkz. firestore.rules `mazeretPenceresiAcik`).
  // Aşağıdaki testler bunu kilitler.
  // ---------------------------------------------------------------
  {
    // POZITIF KONTROL DAHIL: ayni belge, ayni yazim, YALNIZCA damga
    // degistirilerek once BASARILI sonra BASARISIZ olmali — boylece redin
    // sebebinin gercekten pencere oldugu (baska bir sema/yetki kosulu degil)
    // kanitlanir.
    name: 'PENCERE: kapali pencerede asil mazeret reddedilir (acik pencerede ayni yazim gecer)',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await env.withSecurityRulesDisabled(async (context) => {
        await updateDoc(doc(context.firestore(), 'bildirimler/windowClosedAsil'), {
          mazeretSonBasvuru: PENCERE_ACIK(),
        });
      });
      await assertSucceeds(mazeretRetBatch(db, 'windowClosedAsil', 'muezzin1', 'Zamaninda mazeret', { devirSonucu: 'alarm_bekliyor' }));

      await env.withSecurityRulesDisabled(async (context) => {
        await updateDoc(doc(context.firestore(), 'bildirimler/windowClosedAsil'), {
          durum: 'bekliyor',
          pendingAck: true,
          mazeretSonBasvuru: PENCERE_KAPALI(),
        });
      });
      await assertFails(mazeretRetBatch(db, 'windowClosedAsil', 'muezzin1', 'Gec kalan mazeret', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    name: 'PENCERE: kapali pencerede yedek mazereti de reddedilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(mazeretRetBatch(db, 'windowClosedYedek', 'muezzin1', 'Gec kalan mazeret', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    // FAIL-CLOSED: damga hic yoksa (bu ozellik oncesi olusturulmus belge)
    // mazeret KAPALIDIR. `cumaMi`'nin eski fail-open hatasinin (eksik alan ==
    // kisitlama yok) tekrar etmedigini kanitlar.
    name: 'PENCERE: mazeretSonBasvuru damgasi hic olmayan bildirimde mazeret FAIL-CLOSED reddedilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin2').firestore();
      await assertFails(mazeretRetBatch(db, 'noWindowStampAsil', 'muezzin2', 'Damgasiz belge', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    // ASIL GUVENLIK IDDIASI: istemcinin gonderdigi HICBIR zaman degeri karari
    // etkilemez — yalnizca sunucunun `request.time`'i onemlidir. Saati
    // manipule edilmis bir cihazi taklit etmek icin `sonGuncelleme`/
    // `olusturmaTarihi` gecmise VE gelecege cekilir; pencere kapaliyken
    // hicbiri gecemez, pencere acikken (asagida) hepsi gecer.
    name: 'PENCERE: manipule edilmis istemci zamani (gecmis/gelecek) kapali pencereyi acamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const sahteZamanlar = [
        Timestamp.fromMillis(Date.now() - 45 * 60 * 1000), // cihaz saati 45 dk geri
        Timestamp.fromMillis(Date.now() - 10 * 24 * 3600 * 1000), // 10 gun geri
        Timestamp.fromMillis(Date.now() + 10 * 24 * 3600 * 1000), // 10 gun ileri
        Timestamp.fromMillis(0), // epoch
      ];
      for (const sahte of sahteZamanlar) {
        const batch = writeBatch(db);
        batch.update(doc(db, 'bildirimler', 'windowClosedAsil'), {
          durum: 'reddedildi',
          pendingAck: false,
          devirSonucu: 'alarm_bekliyor',
          sonGuncelleme: sahte,
        });
        batch.set(doc(db, 'mazeret_detaylari', 'windowClosedAsil'), {
          uid: 'muezzin1',
          retSebebi: 'Saat manipulasyonu denemesi',
          olusturmaTarihi: sahte,
        });
        await assertFails(batch.commit());
      }
    },
  },
  {
    // Ayna testi: pencere ACIKKEN, istemcinin gonderdigi zaman degeri
    // "yanlis" olsa bile yazim BASARILI olur — yani kural gercekten
    // istemci zamanina degil, `request.time` + saklanan damgaya bakiyor.
    name: 'PENCERE: acik pencerede istemcinin gonderdigi zaman degeri karari etkilemez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const batch = writeBatch(db);
      batch.update(doc(db, 'bildirimler', 'ownPendingAsil'), {
        durum: 'reddedildi',
        pendingAck: false,
        devirSonucu: 'alarm_bekliyor',
        sonGuncelleme: Timestamp.fromMillis(Date.now() - 30 * 24 * 3600 * 1000),
      });
      batch.set(doc(db, 'mazeret_detaylari', 'ownPendingAsil'), {
        uid: 'muezzin1',
        retSebebi: 'Gecmis zaman damgasi',
        olusturmaTarihi: Timestamp.fromMillis(Date.now() - 30 * 24 * 3600 * 1000),
      });
      await assertSucceeds(batch.commit());
    },
  },
  {
    // Damganin KENDISI istemciye kapali: `changed.hasOnly([...])` bu alani
    // icermez, yani kullanici pencereyi kendi uzatamaz (tek basina ya da
    // mazeret yazimiyla ayni batch'te).
    name: 'PENCERE: muezzin mazeretSonBasvuru damgasini kendisi ileri alamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        updateDoc(doc(db, 'bildirimler/windowClosedAsil'), {
          mazeretSonBasvuru: Timestamp.fromMillis(Date.now() + 3600 * 1000),
          sonGuncelleme: Timestamp.now(),
        })
      );
      await assertFails(
        mazeretRetBatch(db, 'windowClosedAsil', 'muezzin1', 'Damgayi da uzatma denemesi', {
          devirSonucu: 'alarm_bekliyor',
          mazeretSonBasvuru: Timestamp.fromMillis(Date.now() + 3600 * 1000),
        })
      );
    },
  },
  {
    // Pencere yalnizca MAZERET (reddedildi) gecisini kapatir — gorevi
    // ustlenme onayi ("okudum") ezandan sonra da yapilabilmelidir
    // (Cuma kisitlamasindaki ayni ayrim).
    name: 'PENCERE: kapali pencerede okudum onayi hala serbesttir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        updateDoc(doc(db, 'bildirimler/windowClosedAsil'), {
          durum: 'onaylandi',
          pendingAck: false,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    // POZITIF KONTROL DAHIL (bkz. yukaridaki asil-mazeret testindeki ayni
    // gerekce): birebir ayni yuk, yalnizca damga degistirilerek once
    // BASARILI sonra BASARISIZ olur.
    name: 'PENCERE: kapali pencerede vekalet teklifi acilamaz (acik pencerede ayni teklif gecer)',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const yuk = {
        bildirimId: 'windowClosedAsil',
        haftaId: 'W2026-05-18',
        gonderenUid: 'muezzin1',
        gonderenIsim: 'Muezzin One',
        aliciUid: 'muezzin2',
        aliciIsim: 'Muezzin Two',
        tarih: '2026-05-20',
        vakit: 'yatsi',
        saat: '21:18',
        tip: 'asil',
        durum: 'beklemede',
        olusturmaTarihi: Timestamp.now(),
      };
      const talepRef = doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_yatsi_asil_muezzin2');

      await env.withSecurityRulesDisabled(async (context) => {
        await updateDoc(doc(context.firestore(), 'bildirimler/windowClosedAsil'), {
          mazeretSonBasvuru: PENCERE_ACIK(),
        });
      });
      await assertSucceeds(setDoc(talepRef, yuk));

      await env.withSecurityRulesDisabled(async (context) => {
        await deleteDoc(doc(context.firestore(), 'vekalet_talepleri/W2026-05-18_2026-05-20_yatsi_asil_muezzin2'));
        await updateDoc(doc(context.firestore(), 'bildirimler/windowClosedAsil'), {
          mazeretSonBasvuru: PENCERE_KAPALI(),
        });
      });
      await assertFails(setDoc(talepRef, yuk));
    },
  },
  {
    name: 'PENCERE: damgasiz bildirim icin vekalet teklifi FAIL-CLOSED reddedilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin2').firestore();
      await assertFails(
        setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_aksam_asil_muezzin1'), {
          bildirimId: 'noWindowStampAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin2',
          gonderenIsim: 'Muezzin Two',
          aliciUid: 'muezzin1',
          aliciIsim: 'Muezzin One',
          tarih: '2026-05-20',
          vakit: 'aksam',
          saat: '19:51',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // KABUL yolu ayrica kapatilmali: teklif pencere ACIKKEN gonderilmis
    // olabilir, ama kabul pencere kapandiktan sonra gelebilir. Iki yazim da
    // (talep durumu + bildirimdeki niyet bayragi) ayri ayri test edilir —
    // scripts/vekaletDevirleriniIsle.ts GERCEK transferi yalnizca
    // `durum == 'kabul_edildi'` sorgusuyla bulur, bildirim bayragini SART
    // KOSMAZ; yani tek basina durum yazimi da yeterli olurdu.
    name: 'PENCERE: kapali pencerede vekalet kabulu (durum + niyet bayragi) reddedilir, RED serbest kalir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'vekalet_talepleri/W2026-05-18_2026-05-20_yatsi_asil_muezzin2'), {
          bildirimId: 'windowClosedAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'yatsi',
          saat: '21:18',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin2').firestore();
      const talepRef = doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_yatsi_asil_muezzin2');

      // (0) POZITIF KONTROL: damga acikken AYNI kabul yazimi gecer — sonraki
      // redlerin sebebinin gercekten pencere oldugunu kanitlar.
      await env.withSecurityRulesDisabled(async (context) => {
        await updateDoc(doc(context.firestore(), 'bildirimler/windowClosedAsil'), {
          mazeretSonBasvuru: PENCERE_ACIK(),
        });
      });
      await assertSucceeds(updateDoc(talepRef, { durum: 'kabul_edildi', sonGuncelleme: Timestamp.now() }));
      await env.withSecurityRulesDisabled(async (context) => {
        await updateDoc(doc(context.firestore(), 'vekalet_talepleri/W2026-05-18_2026-05-20_yatsi_asil_muezzin2'), {
          durum: 'beklemede',
        });
        await updateDoc(doc(context.firestore(), 'bildirimler/windowClosedAsil'), {
          mazeretSonBasvuru: PENCERE_KAPALI(),
        });
      });

      // (1) Talep durumu 'kabul_edildi' — tek basina reddedilmeli.
      await assertFails(updateDoc(talepRef, { durum: 'kabul_edildi', sonGuncelleme: Timestamp.now() }));
      // (2) Bildirimdeki niyet bayragi — tek basina reddedilmeli.
      await assertFails(
        updateDoc(doc(db, 'bildirimler/windowClosedAsil'), {
          vekaletDevriBekliyor: true,
          sonGuncelleme: Timestamp.now(),
        })
      );
      // (3) Gercek istemcinin yaptigi gibi ikisi AYNI transaction'da — yine reddedilmeli.
      await assertFails(
        runTransaction(db, async (transaction) => {
          transaction.update(talepRef, { durum: 'kabul_edildi', sonGuncelleme: Timestamp.now() });
          transaction.update(doc(db, 'bildirimler/windowClosedAsil'), {
            vekaletDevriBekliyor: true,
            sonGuncelleme: Timestamp.now(),
          });
        })
      );
      // (4) REDDETME pencereden BAGIMSIZ olarak serbest kalmali — alici,
      // pencere kapandiktan sonra da teklifi geri cevirebilmelidir.
      await assertSucceeds(updateDoc(talepRef, { durum: 'reddedildi', sonGuncelleme: Timestamp.now() }));
    },
  },
];
