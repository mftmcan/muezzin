import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const projectId = 'demo-muezzin-rules';

type TestCase = {
  name: string;
  run: (env: RulesTestEnvironment) => Promise<void>;
};

const testUser = (env: RulesTestEnvironment, uid: string, role?: string): RulesTestContext => {
  // email_verified: true — gercek kullanicilar yalnizca Google ile giris
  // yaptigi icin token'da her zaman dogrulanmis gelir; isSignedIn() bunu
  // zorunlu kildigi icin (bkz. mimari denetim K1) test fixture'i da ayni
  // varsayimi tasimali.
  return env.authenticatedContext(uid, {
    email: `${uid}@example.test`,
    email_verified: true,
    role,
  });
};

/**
 * src/services/mazeretServisi.ts'in gercek davranisini taklit eder:
 * bildirimler'deki reddi VE mazeret_detaylari'ndaki retSebebi'yi AYNI
 * batch icinde atomik yazar (bkz. firestore.rules isSelfBildirimUpdate
 * yorumu, mimari denetim — altinci tur). `dbInstance` cagiran testin
 * kendi kimlikli Firestore handle'i olmali (testUser(...).firestore()).
 */
function mazeretRetBatch(
  dbInstance: ReturnType<RulesTestContext['firestore']>,
  bildirimId: string,
  uid: string,
  retSebebi: string,
  ekAlanlar: Record<string, unknown>
) {
  const batch = writeBatch(dbInstance);
  batch.update(doc(dbInstance, 'bildirimler', bildirimId), {
    durum: 'reddedildi',
    pendingAck: false,
    sonGuncelleme: Timestamp.now(),
    ...ekAlanlar,
  });
  batch.set(doc(dbInstance, 'mazeret_detaylari', bildirimId), {
    uid,
    retSebebi,
    olusturmaTarihi: Timestamp.now(),
  });
  return batch.commit();
}

/**
 * 1 SAATLİK MAZERET/VEKALET PENCERESİNİN SUNUCU TARAFI DAMGASI.
 *
 * `bildirimler.mazeretSonBasvuru`, mazeret/vekalet penceresinin KAPANDIĞI anı
 * taşır ve firestore.rules onu Firestore'un KENDİ `request.time` değeriyle
 * karşılaştırır (bkz. `mazeretPenceresiAcik`). İstemci bu alanı yazamaz
 * (`changed.hasOnly([...])` kapsamında değil) ve istemcinin gönderdiği hiçbir
 * zaman değeri (`sonGuncelleme`, `olusturmaTarihi`) karara girmez — aşağıdaki
 * "manipule edilmis istemci zamani" testleri tam da bunu doğrular.
 */
const PENCERE_ACIK = () => Timestamp.fromMillis(Date.now() + 6 * 60 * 60 * 1000);
const PENCERE_KAPALI = () => Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);

async function seedBaseData(env: RulesTestEnvironment) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'muezzins/admin'), {
      displayName: 'Admin',
      email: 'admin@example.test',
      role: 'admin',
      aktif: true,
      photoURL: '',
      fcmToken: null,
      aylikVakitSayisi: 0,
    });

    await setDoc(doc(db, 'muezzins/muezzin1'), {
      displayName: 'Muezzin One',
      email: 'muezzin1@example.test',
      role: 'muezzin',
      aktif: true,
      photoURL: '',
      fcmToken: null,
      aylikVakitSayisi: 0,
    });

    await setDoc(doc(db, 'muezzins/muezzin2'), {
      displayName: 'Muezzin Two',
      email: 'muezzin2@example.test',
      role: 'muezzin',
      aktif: true,
      photoURL: '',
      fcmToken: null,
      aylikVakitSayisi: 0,
    });

    // Gozlemci: sadece izleyici, hicbir zaman nobete atanmiyor (bkz.
    // isAssignableDutyUidVeri) — izin (leave) testlerinde bu rolun izin
    // olusturamamasini dogrulamak icin (bkz. yetki denetimi).
    await setDoc(doc(db, 'muezzins/gozlemci1'), {
      displayName: 'Gozlemci One',
      email: 'gozlemci1@example.test',
      role: 'gozlemci',
      aktif: true,
      photoURL: '',
      fcmToken: null,
      aylikVakitSayisi: 0,
    });

    // NOT: bu ucu (ownPendingAsil/otherPendingAsil/ownPendingYedek) kasitli
    // olarak Cuma OLMAYAN bir tarihte (2026-05-20, Carsamba — asagidaki
    // "wednesdayPendingAsil" ile ayni bilinen gun) kuruludur. Genel amacli
    // (Cuma kisitlamasiyla ilgisiz) bircok testte kullanildiklarindan, Cuma
    // gunune denk gelselerdi cumaMiIsaretli() artik tarihten dogru
    // hesapladigi icin (bkz. firestore.rules) o testler kendileriyle
    // ilgisiz bir nedenle basarisiz olurdu. Cuma'ya ozel senaryolar icin
    // ayri, acikca isimlendirilmis belgeler kullanilir: fridayPendingAsil/
    // fridayPendingYedek (cumaMi:true ile) ve legacyFridayNoCumaMiAsil
    // (cumaMi alani hic olmadan, backfill-oncesi belgeyi temsil eder).
    await setDoc(doc(db, 'bildirimler/ownPendingAsil'), {
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

    await setDoc(doc(db, 'bildirimler/otherPendingAsil'), {
      haftaId: 'W2026-05-18',
      tarih: '2026-05-20',
      vakit: 'ikindi',
      uid: 'muezzin2',
      tip: 'asil',
      durum: 'bekliyor',
      pendingAck: true,
      retSebebi: null,
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
      mazeretSonBasvuru: PENCERE_ACIK(),
    });

    await setDoc(doc(db, 'bildirimler/ownPendingYedek'), {
      haftaId: 'W2026-05-18',
      tarih: '2026-05-20',
      vakit: 'aksam',
      uid: 'muezzin1',
      tip: 'yedek',
      durum: 'bekliyor',
      pendingAck: true,
      retSebebi: null,
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
      mazeretSonBasvuru: PENCERE_ACIK(),
    });

    // Deterministik ID'li asil/yedek çifti (mazeret devri testleri için) —
    // bkz. scripts/haftalikPlanOlustur.ts ve firestore.rules `isBackupPromotionFromMazeret`.
    await setDoc(doc(db, 'bildirimler/W2026-06-01_2026-06-03_yatsi_asil'), {
      haftaId: 'W2026-06-01',
      tarih: '2026-06-03',
      vakit: 'yatsi',
      uid: 'muezzin1',
      tip: 'asil',
      durum: 'bekliyor',
      pendingAck: true,
      retSebebi: null,
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
      mazeretSonBasvuru: PENCERE_ACIK(),
    });

    await setDoc(doc(db, 'bildirimler/W2026-06-01_2026-06-03_yatsi_yedek'), {
      haftaId: 'W2026-06-01',
      tarih: '2026-06-03',
      vakit: 'yatsi',
      uid: 'muezzin2',
      tip: 'yedek',
      durum: 'bekliyor',
      pendingAck: true,
      retSebebi: null,
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
      mazeretSonBasvuru: PENCERE_ACIK(),
    });

    // Cuma gunune denk gelen bir gorev (cumaMi:true) — mazeret/gorev devri
    // kisitlamasi testleri icin (bkz. firestore.rules `isSelfBildirimUpdate`).
    await setDoc(doc(db, 'bildirimler/fridayPendingAsil'), {
      haftaId: 'W2026-05-18',
      tarih: '2026-05-22',
      vakit: 'ogle',
      uid: 'muezzin1',
      tip: 'asil',
      durum: 'bekliyor',
      pendingAck: true,
      retSebebi: null,
      cumaMi: true,
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
      mazeretSonBasvuru: PENCERE_ACIK(),
    });

    // Aynı Cuma günü için bir yedek görev — yedek'in kendi mazeretinin de
    // Cuma'da kapalı kaldığını doğrulamak için.
    await setDoc(doc(db, 'bildirimler/fridayPendingYedek'), {
      haftaId: 'W2026-05-18',
      tarih: '2026-05-22',
      vakit: 'ikindi',
      uid: 'muezzin1',
      tip: 'yedek',
      durum: 'bekliyor',
      pendingAck: true,
      retSebebi: null,
      cumaMi: true,
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
      mazeretSonBasvuru: PENCERE_ACIK(),
    });

    // `cumaMi` alanı HİÇ YOK (backfill öncesi gerçek bir belgeyi temsil
    // eder) ama `tarih` gerçekten bir Cuma — cumaMiIsaretli()'nin artık
    // saklı bayrağa değil, tarihten hesaplanan güne güvendiğini doğrular
    // (bkz. firestore.rules cumaMiIsaretli, kod denetimi güvenlik bulgusu).
    await setDoc(doc(db, 'bildirimler/legacyFridayNoCumaMiAsil'), {
      haftaId: 'W2026-05-18',
      tarih: '2026-05-22',
      vakit: 'sabah',
      uid: 'muezzin2',
      tip: 'asil',
      durum: 'bekliyor',
      pendingAck: true,
      retSebebi: null,
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
      mazeretSonBasvuru: PENCERE_ACIK(),
    });

    // 1 SAATLİK PENCERE fixture'ları (bkz. PENCERE_ACIK/PENCERE_KAPALI).
    // Üçü de Cuma OLMAYAN bir tarihte (2026-05-20, Çarşamba) kuruludur ki
    // testler yalnızca zaman penceresini izole etsin.
    //
    // `windowClosedAsil`: damga GEÇMİŞTE — pencere kapalı.
    await setDoc(doc(db, 'bildirimler/windowClosedAsil'), {
      haftaId: 'W2026-05-18',
      tarih: '2026-05-20',
      vakit: 'yatsi',
      uid: 'muezzin1',
      tip: 'asil',
      durum: 'bekliyor',
      pendingAck: true,
      retSebebi: null,
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
      mazeretSonBasvuru: PENCERE_KAPALI(),
    });

    // `windowClosedYedek`: aynısının yedek karşılığı (yedek mazeret dalı).
    await setDoc(doc(db, 'bildirimler/windowClosedYedek'), {
      haftaId: 'W2026-05-18',
      tarih: '2026-05-20',
      vakit: 'yatsi',
      uid: 'muezzin1',
      tip: 'yedek',
      durum: 'bekliyor',
      pendingAck: true,
      retSebebi: null,
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
      mazeretSonBasvuru: PENCERE_KAPALI(),
    });

    // `noWindowStampAsil`: `mazeretSonBasvuru` alanı HİÇ YOK — bu özellik
    // devreye alınmadan önce oluşturulmuş gerçek bir belgeyi temsil eder.
    // FAIL-CLOSED olmalı: eksik alan, `cumaMi`'nin eski fail-open hatasının
    // (bkz. firestore.rules cumaMiIsaretli yorumu) tekrarı olmamalı.
    await setDoc(doc(db, 'bildirimler/noWindowStampAsil'), {
      haftaId: 'W2026-05-18',
      tarih: '2026-05-20',
      vakit: 'aksam',
      uid: 'muezzin2',
      tip: 'asil',
      durum: 'bekliyor',
      pendingAck: true,
      retSebebi: null,
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
    });

    await setDoc(doc(db, 'duyurular/publicNotice'), {
      baslik: 'Duyuru',
      icerik: 'Metin',
      tarih: Timestamp.now(),
    });
  });
}

function validVakitGunleri() {
  return Object.fromEntries(
    Array.from({ length: 30 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return [
        `2026-05-${day}`,
        {
          sabah: '04:10',
          gunes: '05:42',
          ogle: '12:45',
          ikindi: '16:30',
          aksam: '19:51',
          yatsi: '21:18',
        },
      ];
    })
  );
}

const tests: TestCase[] = [
  {
    name: 'anonim kullanici duyuru okuyamaz',
    run: async (env) => {
      const db = env.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, 'duyurular/publicNotice')));
    },
  },
  {
    name: 'giris yapan kullanici duyuru okuyabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(getDoc(doc(db, 'duyurular/publicNotice')));
    },
  },
  {
    name: 'dogrulanmamis e-posta ile hicbir seye erisilemez (K1 regresyonu)',
    run: async (env) => {
      const db = env
        .authenticatedContext('sahtekullanici', {
          email: 'sahtekullanici@example.test',
          email_verified: false,
        })
        .firestore();
      await assertFails(getDoc(doc(db, 'duyurular/publicNotice')));
    },
  },
  {
    name: 'muezzin kendi profil tercihlerini guncelleyebilir ama rolunu degistiremez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();

      await assertSucceeds(
        updateDoc(doc(db, 'muezzins/muezzin1'), {
          notificationSettings: {
            nobetHatirlatici: true,
            duyurular: false,
            mazeretDurumu: true,
          },
        })
      );

      await assertFails(
        updateDoc(doc(db, 'muezzins/muezzin1'), {
          role: 'admin',
        })
      );
    },
  },
  {
    name: 'muezzin kendi fcm token haritasini guncelleyebilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();

      await assertSucceeds(
        updateDoc(doc(db, 'muezzins/muezzin1'), {
          fcmToken: 'token-1',
          fcmTokens: {
            'token-1': Timestamp.now(),
          },
        })
      );
    },
  },
  {
    name: 'muezzin profil semasina yabanci alan ekleyemez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();

      await assertFails(
        updateDoc(doc(db, 'muezzins/muezzin1'), {
          privateNote: 'Kurallarda tanimli olmayan alan',
        })
      );
    },
  },
  {
    name: 'admin bir muezzinin haftalik izin gununu cuma yapamaz',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertFails(
        updateDoc(doc(db, 'muezzins/muezzin2'), {
          haftalikIzinGunu: 5,
        })
      );
    },
  },
  {
    name: 'admin bir muezzinin haftalik izin gununu cuma disi bir gune ayarlayabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertSucceeds(
        updateDoc(doc(db, 'muezzins/muezzin2'), {
          haftalikIzinGunu: 3,
        })
      );
    },
  },
  {
    name: 'muezzin fcm token haritasini sinirsiz buyutemez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const tooManyTokens = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`token-${index}`, Timestamp.now()]));

      await assertFails(
        updateDoc(doc(db, 'muezzins/muezzin1'), {
          fcmTokens: tooManyTokens,
        })
      );
    },
  },
  {
    name: 'admin gecerli davet olusturabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'invites/valid@example.test'), {
          email: 'valid@example.test',
          displayName: 'Valid User',
          role: 'muezzin',
          haftalikIzinGunu: 3,
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'admin haftalik izin gunu cuma olan davet olusturamaz (Cuma kapsami hic bos kalmamali)',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertFails(
        setDoc(doc(db, 'invites/friday-leave@example.test'), {
          email: 'friday-leave@example.test',
          displayName: 'Friday Leave',
          role: 'muezzin',
          haftalikIzinGunu: 5,
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'admin email ile belge id uyusmayan davet olusturamaz',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertFails(
        setDoc(doc(db, 'invites/wrong@example.test'), {
          email: 'valid@example.test',
          displayName: 'Wrong User',
          role: 'muezzin',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'admin gecersiz haftalik izin gunu ile davet olusturamaz',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertFails(
        setDoc(doc(db, 'invites/invalid-leave@example.test'), {
          email: 'invalid-leave@example.test',
          displayName: 'Invalid Leave',
          role: 'muezzin',
          haftalikIzinGunu: 8,
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'davetsiz kullanici kendi muezzin profilini olusturamaz',
    run: async (env) => {
      const db = testUser(env, 'newuser').firestore();
      await assertFails(
        setDoc(doc(db, 'muezzins/newuser'), {
          displayName: 'New User',
          email: 'newuser@example.test',
          role: 'muezzin',
          aktif: true,
          photoURL: '',
          fcmToken: null,
          aylikVakitSayisi: 0,
        })
      );
    },
  },
  {
    name: 'davetli kullanici kendi muezzin profilini olusturabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'invites/invited@example.test'), {
          email: 'invited@example.test',
          displayName: 'Invited User',
          role: 'muezzin',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'invited').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'muezzins/invited'), {
          displayName: 'Invited User',
          email: 'invited@example.test',
          role: 'muezzin',
          aktif: true,
          photoURL: '',
          fcmToken: null,
          aylikVakitSayisi: 0,
          // useAuthStore.ts her zaman bunu ayarlar (admin haric) — bkz.
          // mimari denetim Y4 / isInvitedSelfMuezzinCreate.
          onayBekliyor: true,
        })
      );
    },
  },
  {
    name: 'davetli kullanici onayBekliyor:false ile kendi profilini olusturamaz (Y4 regresyonu)',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'invites/invited2@example.test'), {
          email: 'invited2@example.test',
          displayName: 'Invited User 2',
          role: 'muezzin',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'invited2').firestore();
      // onayBekliyor:false (ya da hic gonderilmemesi) ile kendi profilini
      // olusturmaya calisan bir kullanici, admin onayini atlayip dogrudan
      // nobete atanabilir hale gelmemeli.
      await assertFails(
        setDoc(doc(db, 'muezzins/invited2'), {
          displayName: 'Invited User 2',
          email: 'invited2@example.test',
          role: 'muezzin',
          aktif: true,
          photoURL: '',
          fcmToken: null,
          aylikVakitSayisi: 0,
          onayBekliyor: false,
        })
      );
    },
  },
  {
    name: 'muezzin bildirim olusturamaz admin olusturabilir',
    run: async (env) => {
      const muezzinDb = testUser(env, 'muezzin1').firestore();
      const adminDb = testUser(env, 'admin').firestore();
      const payload = {
        haftaId: 'W2026-05-18',
        tarih: '2026-05-22',
        vakit: 'yatsi',
        uid: 'muezzin1',
        tip: 'asil',
        durum: 'bekliyor',
        pendingAck: true,
        retSebebi: null,
        olusturmaTarihi: Timestamp.now(),
        sonGuncelleme: Timestamp.now(),
      };

      await assertFails(setDoc(doc(muezzinDb, 'bildirimler/maliciousCreate'), payload));
      await assertSucceeds(setDoc(doc(adminDb, 'bildirimler/adminCreate'), payload));
    },
  },
  {
    // haftaGunuNumarasi/isValidBildirim (bkz. mimari denetim #6) — sabit
    // haftalik izin gununde manuel atama artik sunucu tarafinda da
    // reddediliyor. 2026-05-18 bir Pazartesi (haftalikIzinGunu olceginde 1).
    name: 'admin sabit haftalik izin gununde nobet bildirimi olusturamaz',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await updateDoc(doc(db, 'muezzins/muezzin1'), { haftalikIzinGunu: 1 });
      });

      const db = testUser(env, 'admin').firestore();
      await assertFails(
        setDoc(doc(db, 'bildirimler/fixedDayOffCreate'), {
          haftaId: 'W2026-05-18',
          tarih: '2026-05-18',
          vakit: 'ogle',
          uid: 'muezzin1',
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'admin haftalik izin gunu uyusmayan tarihte nobet bildirimi olusturabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await updateDoc(doc(db, 'muezzins/muezzin1'), { haftalikIzinGunu: 2 });
      });

      const db = testUser(env, 'admin').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'bildirimler/nonFixedDayOffCreate'), {
          haftaId: 'W2026-05-18',
          tarih: '2026-05-18',
          vakit: 'ogle',
          uid: 'muezzin1',
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'admin kendisine nobet bildirimi olusturamaz',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertFails(
        setDoc(doc(db, 'bildirimler/adminDutyCreate'), {
          haftaId: 'W2026-05-18',
          tarih: '2026-05-22',
          vakit: 'yatsi',
          uid: 'admin',
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'admin mevcut nobeti admin kullanicisina devredemez',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertFails(
        updateDoc(doc(db, 'bildirimler/ownPendingAsil'), {
          uid: 'admin',
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'admin kendi adina eski nobet bildirimini onaylayamaz',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'bildirimler/legacyAdminDuty'), {
          haftaId: 'W2026-05-18',
          tarih: '2026-05-22',
          vakit: 'sabah',
          uid: 'admin',
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      await assertFails(
        updateDoc(doc(db, 'bildirimler/legacyAdminDuty'), {
          durum: 'onaylandi',
          pendingAck: false,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'muezzin kendi bekleyen gorevini onaylayabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        updateDoc(doc(db, 'bildirimler/ownPendingAsil'), {
          durum: 'onaylandi',
          pendingAck: false,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'muezzin baskasinin gorevini onaylayamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        updateDoc(doc(db, 'bildirimler/otherPendingAsil'), {
          durum: 'onaylandi',
          pendingAck: false,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'muezzin kendi asil gorevine mazeret yazabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      // retSebebi artik bildirimler'e degil, ayni batch'teki
      // mazeret_detaylari'na yaziliyor (bkz. mazeretRetBatch, mimari
      // denetim — altinci tur).
      await assertSucceeds(mazeretRetBatch(db, 'ownPendingAsil', 'muezzin1', 'Hastalik', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    // `legacyFridayNoCumaMiAsil` kasitli olarak cumaMi alani OLMADAN
    // olusturuldu (bkz. yukaridaki setup) — backfill-oncesi GERCEK bir
    // belgeyi temsil eder, ama tarihi GERCEKTEN bir Cuma. ONCEDEN
    // cumaMiIsaretli() yalnizca saklanan (ve bu belgede eksik olan) bayraga
    // bakiyordu, bu yuzden alan eksikken Cuma kisitlamasi SESSIZCE
    // atlatilabiliyordu (bkz. kod denetimi guvenlik bulgusu). Artik
    // `tarih`ten dogrudan hesaplandigi icin (bkz. firestore.rules
    // `cumaMiIsaretli`), alanin eksik olmasi kisitlamayi ATLATMIYOR — bu
    // test tam da bunu dogrular ki regresyon sessizce geri gelmesin.
    name: 'cumaMi alani hic olmayan ama gercekte Cuma olan bir bildirimde mazeret reddi hala engellenir',
    run: async (env) => {
      const db = testUser(env, 'muezzin2').firestore();
      await assertFails(mazeretRetBatch(db, 'legacyFridayNoCumaMiAsil', 'muezzin2', 'Hastalik', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    name: 'muezzin cuma gorevine mazeret bildiremez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      // Eslesen mazeret_detaylari yazimi DAHIL edildi ki test yalnizca
      // Cuma kisitlamasini izole etsin (baska bir nedenle degil).
      await assertFails(mazeretRetBatch(db, 'fridayPendingAsil', 'muezzin1', 'Hastalik', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    name: 'muezzin cuma gorevini yine de okudum olarak onaylayabilir',
    run: async (env) => {
      // Cuma kisitlamasi yalnizca mazeret (reddedildi) geciscine uygulanir —
      // gorevi ustlenme (okudum/onaylandi) onayi hala serbesttir.
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        updateDoc(doc(db, 'bildirimler/fridayPendingAsil'), {
          durum: 'onaylandi',
          pendingAck: false,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'yedek gorev mazeret reddine ceviremez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      // devirSonucu eksik (asil dalindaki gibi eski/eksik bir istemci yuku
      // taklit ediyor) — bkz. asagidaki "devirSonucu ile" testi, dogru
      // sekilde bicimlendirilmis bir yedek mazereti bunun aksine basarili olur.
      await assertFails(mazeretRetBatch(db, 'ownPendingYedek', 'muezzin1', 'Uygun degilim', {}));
    },
  },
  {
    name: 'yedek gorevli kendi mazeretini (devirSonucu ile) bildirebilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(mazeretRetBatch(db, 'ownPendingYedek', 'muezzin1', 'Uygun degilim', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    name: 'yedek gorevli Cuma gorevi icin mazeret bildiremez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(mazeretRetBatch(db, 'fridayPendingYedek', 'muezzin1', 'Uygun degilim', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
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
  {
    // Fix 3'un KOK NEDENI: `vekalet_talepleri` update kuralinin admin dali
    // eskiden KOSULSUZ `isAdmin()` idi — hicbir sema kisiti yoktu. Bir admin
    // yazimi talebi bagli bildirimden desenkronize edebiliyordu (talep.tarih
    // != bildirim.tarih) ve scripts/vekaletDevirleriniIsle.ts o noktadan
    // sonra bazi kontrolleri talep'ten, bazilarini bildirim'den okudugu icin
    // FARKLI gorevler hakkinda karar veriyordu.
    name: 'admin bir vekalet talebinin kimlik/korelasyon alanlarini degistiremez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'vekalet_talepleri/adminDesyncDeneme'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'kabul_edildi',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'vekalet_talepleri/adminDesyncDeneme');
      // Korelasyon alanlari: hepsi reddedilmeli.
      await assertFails(updateDoc(ref, { tarih: '2026-05-22' }));
      await assertFails(updateDoc(ref, { vakit: 'yatsi' }));
      await assertFails(updateDoc(ref, { bildirimId: 'otherPendingAsil' }));
      await assertFails(updateDoc(ref, { aliciUid: 'muezzin1' }));
      await assertFails(updateDoc(ref, { tip: 'yedek' }));
      // Mesru bir admin onarimi (durum + goruntulenen alanlar) hala serbest.
      await assertSucceeds(updateDoc(ref, { durum: 'reddedildi', sonGuncelleme: Timestamp.now() }));
    },
  },
  {
    name: 'muezzin bildirim kimlik alanlarini degistiremez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        updateDoc(doc(db, 'bildirimler/ownPendingAsil'), {
          uid: 'muezzin2',
          durum: 'onaylandi',
          pendingAck: false,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'izin talebinde kullanici sadece kendisi adina kayit acabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      // 2026-05-18 Pazartesi, 2026-05-19 Sali — Cuma icermeyen bir aralik.
      const base = {
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'mazeret',
        durum: 'onay_bekliyor',
        olusturmaTarihi: Timestamp.now(),
      };

      await assertSucceeds(
        setDoc(doc(db, 'izinler/ownLeave'), {
          ...base,
          uid: 'muezzin1',
        })
      );
      await assertFails(
        setDoc(doc(db, 'izinler/otherLeave'), {
          ...base,
          uid: 'muezzin2',
        })
      );
    },
  },
  {
    // Izin (leave) yalnizca nobete atanabilen 'muezzin' rolu icin
    // anlamlidir (bkz. isAssignableDutyUidVeri) — admin ve gozlemci
    // hicbir zaman nobete atanmiyor, sunucu tarafi bunu isValidIzin'de
    // artik zorunlu kiliyor (bkz. yetki denetimi).
    name: 'gozlemci ve admin izin talebi olusturamaz',
    run: async (env) => {
      const base = {
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'mazeret',
        durum: 'onay_bekliyor',
        olusturmaTarihi: Timestamp.now(),
      };

      const gozlemciDb = testUser(env, 'gozlemci1').firestore();
      await assertFails(
        setDoc(doc(gozlemciDb, 'izinler/gozlemciLeave'), {
          ...base,
          uid: 'gozlemci1',
        })
      );

      const adminDb = testUser(env, 'admin').firestore();
      await assertFails(
        setDoc(doc(adminDb, 'izinler/adminLeave'), {
          ...base,
          uid: 'admin',
        })
      );
    },
  },
  {
    // izinler'in `list` kuralinda (yukarida, ayni match blogu) zaten
    // `resource == null` dali var (O10 yorumuyla belgelenmis), ama komsu
    // `get` kuralinda bu dal eksikti: admin olmayan bir kullanici var
    // olmayan bir izin ID'sine getDoc atarsa `resource.data.durum`
    // null-deref hatasiyla reddediliyordu (bkz. vekalet_talepleri'ndeki
    // ayni sinif bug, e2e denetimi).
    name: 'muezzin henuz var olmayan bir izin kaydini get ile sorgulayabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(getDoc(doc(db, 'izinler/hicOlusturulmamisIzin')));
    },
  },
  {
    name: 'izin talebi Cuma iceren bir araligi sunucu tarafinda reddeder',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const base = {
        uid: 'muezzin1',
        tip: 'mazeret',
        durum: 'onay_bekliyor',
        olusturmaTarihi: Timestamp.now(),
      };

      // 2026-05-22 tek basina bir Cuma.
      await assertFails(
        setDoc(doc(db, 'izinler/tekGunCuma'), {
          ...base,
          baslangic: '2026-05-22',
          bitis: '2026-05-22',
        })
      );
      // 2026-05-18 (Pzt) - 2026-05-24 (Paz) araligi 2026-05-22 Cuma'yi kapsiyor.
      await assertFails(
        setDoc(doc(db, 'izinler/araligaCumaGiriyor'), {
          ...base,
          baslangic: '2026-05-18',
          bitis: '2026-05-24',
        })
      );
      // 7+ gunluk her aralik istatistiksel olarak bir Cuma icerir.
      await assertFails(
        setDoc(doc(db, 'izinler/haftalikArayaCumaGirer'), {
          ...base,
          baslangic: '2026-05-19',
          bitis: '2026-05-26',
        })
      );
      // Cuma icermeyen kisa bir araligin gecmesi gerekir (regresyon kontrolu).
      await assertSucceeds(
        setDoc(doc(db, 'izinler/cumasizAralik'), {
          ...base,
          baslangic: '2026-05-18',
          bitis: '2026-05-21',
        })
      );
      // Ters cevrilmis aralik (bitis < baslangic) reddedilmeli.
      await assertFails(
        setDoc(doc(db, 'izinler/tersAralik'), {
          ...base,
          baslangic: '2026-05-25',
          bitis: '2026-05-20',
        })
      );
    },
  },
  {
    // FR-O3 sonrasi: `sebep` artik `izinler`de degil, kendi ID'si karsilik
    // gelen izinler belgesiyle AYNI olan `izin_detaylari`da. Onceden
    // isValidIzin'in `sebep` alani hasOnly'de listeleniyordu ama hic tip/
    // uzunluk dogrulamasi yapmiyordu — burada isValidIzinDetay icin ayni
    // sinir testleri tekrarlanir.
    name: 'izin_detaylari sebep 1000 karakteri asarsa veya string degilse reddedilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'izinler/izinDetaySinirTest'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          olusturmaTarihi: Timestamp.now(),
        })
      );

      const base = { uid: 'muezzin1', olusturmaTarihi: Timestamp.now() };
      await assertFails(
        setDoc(doc(db, 'izin_detaylari/izinDetaySinirTest'), {
          ...base,
          sebep: 'a'.repeat(1001),
        })
      );
      await assertFails(
        setDoc(doc(db, 'izin_detaylari/izinDetaySinirTest'), {
          ...base,
          sebep: 12345,
        })
      );
      // Tam sinirda (1000 karakter) gecmeli (regresyon kontrolu).
      await assertSucceeds(
        setDoc(doc(db, 'izin_detaylari/izinDetaySinirTest'), {
          ...base,
          sebep: 'a'.repeat(1000),
        })
      );
    },
  },
  {
    // izin_detaylari'nin create kurali kendi uid'ini dogrular ama (mazeret_
    // detaylari'nin aksine, bkz. firestore.rules yorumu) karsilik gelen
    // izinler belgesinin sahibini CAPRAZ DOGRULAMAZ — ID rastgele/tahmin
    // edilemez oldugundan bu yeterli. Yine de "baskasinin uid'i ile
    // olusturamaz" temel kontrolu burada dogrulanir.
    name: 'izin_detaylari yalnizca kendi uid ile olusturulabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'izin_detaylari/baskasininUidi'), {
          uid: 'muezzin2',
          sebep: 'Baskasi adina yazma denemesi',
          olusturmaTarihi: Timestamp.now(),
        })
      );
      await assertSucceeds(
        setDoc(doc(db, 'izin_detaylari/kendiUidi'), {
          uid: 'muezzin1',
          sebep: 'Gecerli',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // VacationRequestCard.tsx'in GERCEK yazim deseni: izinler + izin_detaylari
    // TEK bir atomik batch'te, ayni cagrida olusturulur (izin_detaylari'nin
    // create kuralindaki get() karsilik gelen izinler belgesini AYNI
    // batch'teki kardes islemden mi yoksa yalnizca batch-oncesi durumdan mi
    // goruyor? — bu, bir onceki testteki SIRALI/ayri setDoc cagrilarindan
    // FARKLI bir senaryo, ayrica dogrulanmasi gerekiyordu).
    name: 'izinler + izin_detaylari AYNI atomik batch icinde birlikte olusturulabilir (VacationRequestCard deseni)',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const batch = writeBatch(db);
      batch.set(doc(db, 'izinler/izinDetayAyniBatch'), {
        uid: 'muezzin1',
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'mazeret',
        durum: 'onay_bekliyor',
        olusturmaTarihi: Timestamp.now(),
      });
      batch.set(doc(db, 'izin_detaylari/izinDetayAyniBatch'), {
        uid: 'muezzin1',
        sebep: 'Ayni batch testi',
        olusturmaTarihi: Timestamp.now(),
      });
      await assertSucceeds(batch.commit());
    },
  },
  {
    name: 'izin_detaylari yalnizca ilgili kisi veya admin tarafindan okunabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izin_detaylari/ozelIzinSebebi'), {
          uid: 'muezzin1',
          sebep: 'Gizli saglik detayi',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const digerKullanici = testUser(env, 'muezzin2').firestore();
      await assertFails(getDoc(doc(digerKullanici, 'izin_detaylari/ozelIzinSebebi')));

      const sahibi = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(getDoc(doc(sahibi, 'izin_detaylari/ozelIzinSebebi')));

      const adminDb = testUser(env, 'admin').firestore();
      await assertSucceeds(getDoc(doc(adminDb, 'izin_detaylari/ozelIzinSebebi')));
    },
  },
  {
    name: 'izin_detaylari yalnizca admin tarafindan listelenebilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(getDocs(collection(db, 'izin_detaylari')));

      const adminDb = testUser(env, 'admin').firestore();
      await assertSucceeds(getDocs(collection(adminDb, 'izin_detaylari')));
    },
  },
  {
    // Ucuncu denetim turu bulgusu: veriOnarimServisi.ts'in "Veri Sagligi"
    // onarim akisi ters-tarihli bir izin kaydini admin olarak duzeltmek icin
    // SADECE baslangic/bitis yaziyor (durum/redSebebi'ye dokunmuyor) — bu
    // onceden izinler update kuralinin admin disjunct'inin (hasOnly yalnizca
    // durum/redSebebi) disinda kaliyordu, her zaman PERMISSION_DENIED
    // aliyordu.
    name: 'admin ters-tarihli bir izin kaydini baslangic/bitis yazarak onarabilir (veriOnarimServisi regresyonu)',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        // 2026-05-18 (Pzt) - 2026-05-19 (Sal), Cuma icermeyen bir aralik —
        // ama ters kaydedilmis: baslangic=19, bitis=18.
        await setDoc(doc(db, 'izinler/tersTarihliKayit'), {
          uid: 'muezzin1',
          baslangic: '2026-05-19',
          bitis: '2026-05-18',
          tip: 'mazeret',
          durum: 'onaylandi',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/tersTarihliKayit');

      // veriOnarimServisi.ts'in gercek onarim yazimi: iki tarihi yer
      // degistirir, baska hicbir alana dokunmaz.
      await assertSucceeds(updateDoc(ref, { baslangic: '2026-05-18', bitis: '2026-05-19' }));
    },
  },
  {
    // Onarim yolu sonsuz esneklige acilmamali — duzeltilmis aralik da
    // isValidIzinTarihAraligi'nin sekil/is-kurallarina (ters aralik, Cuma
    // icerme) tabi olmali.
    name: 'admin izin onarimi gecersiz bir tarih araligina yazilamaz',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/gecersizOnarimDenemesi'), {
          uid: 'muezzin1',
          baslangic: '2026-05-19',
          bitis: '2026-05-18',
          tip: 'mazeret',
          durum: 'onaylandi',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/gecersizOnarimDenemesi');

      // Duzeltme sonrasi da hala ters aralik (bitis < baslangic) — reddedilmeli.
      await assertFails(updateDoc(ref, { baslangic: '2026-05-20', bitis: '2026-05-15' }));
    },
  },
  {
    // Admin izin onarim yolu yalnizca durum/redSebebi/baslangic/bitis
    // yazabilmeli — uid gibi kimlik alanlarina sizmamali.
    name: 'admin izin onarimi kimlik alanlarini (uid) degistiremez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/kimlikDenemesi'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onaylandi',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/kimlikDenemesi');

      await assertFails(updateDoc(ref, { uid: 'muezzin2' }));
    },
  },
  {
    // isValidIzin artik hasOnly ile sinirli — sema disi ekstra bir alan
    // (ornegin sinirsiz uzunlukta rastgele bir alan) create'te reddedilmeli.
    name: 'izin talebi sema disi ekstra alan icermemeli (isValidIzin hasOnly)',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'izinler/ekstraAlanli'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
          yetkisizAlan: 'sizma denemesi',
        })
      );
    },
  },
  {
    // izinGuncelle karar aninda durum ile AYNI update'te bildirimGonderildi:
    // false yazar (bkz. useAdminIzinlerStore.ts) — admin disjunct'inin
    // affectedKeys hasOnly'sine bu alan eklenmezse izinGuncelle her zaman
    // PERMISSION_DENIED alirdi (bkz. Firebase/GitHub veri akisi
    // optimizasyonu, duyuru/izin push bildirimi ozelligi).
    name: 'admin izin kararini bildirimGonderildi:false ile AYNI update icinde yazabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/kararBekleyen'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/kararBekleyen');

      await assertSucceeds(updateDoc(ref, { durum: 'onaylandi', bildirimGonderildi: false }));
    },
  },
  {
    // Düşük öncelikli bulgu: admin dalı hangi ALANLARIN değiştiğini
    // kontrol ediyordu ama `durum`un DEĞERİNİ hiç doğrulamıyordu — şema
    // dışı bir değer sessizce kabul edilip izinDurumBildirimGonder.ts'in
    // hiçbir dalına girmeden yutulabiliyordu.
    name: 'admin izin kararini sema disi bir durum degeriyle guncelleyemez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/semaDisiDurumDenemesi'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/semaDisiDurumDenemesi');

      await assertFails(updateDoc(ref, { durum: 'gecersizDurum' }));
    },
  },
  {
    // izinGeriAl bir karari geri alirken bildirimGonderildi'yi SILER (deleteField)
    // — aksi halde yeniden karar verildiginde eski true degeri yuzunden yeni
    // bildirim hic gitmezdi (bkz. useAdminIzinlerStore.ts izinGeriAl yorumu).
    name: 'admin bir karari geri alirken bildirimGonderildi bayragini silebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/geriAlinacakKarar'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onaylandi',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
          bildirimGonderildi: true,
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/geriAlinacakKarar');

      await assertSucceeds(updateDoc(ref, { durum: 'onay_bekliyor', bildirimGonderildi: deleteField() }));
    },
  },
  {
    // `puanIslendi`nin isValidBildirim'de yol actigi bulgunun BIREBIR
    // AYNISI: isValidIzin'in hasOnly'si `bildirimGonderildi`yi (ve iki fazli
    // gonderim damgasini) listelemiyordu. hasOnly her update'te TUM belgeyi
    // dogruladigindan, bu alanlari tasiyan bir izin belgesi 'onay_bekliyor'a
    // geri dondugunde sahibinin kendi bekleyen talebini duzenledigi
    // self-update dali KALICI olarak reddediliyordu. Ulasilabilir yaris:
    // cron dokumani 'onaylandi' + bayrak:false okur, admin arada izinGeriAl
    // yapar, cron sonra bayragi true yazar.
    name: 'sahibi, bildirimGonderildi/gonderim damgasi tasiyan bekleyen kendi izin talebini duzenleyebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/bayrakliBekleyen'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          olusturmaTarihi: Timestamp.now(),
          bildirimGonderildi: true,
          bildirimGonderimBaslangici: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin1').firestore();
      const ref = doc(db, 'izinler/bayrakliBekleyen');

      // 2026-05-18 (Pzt) - 2026-05-21 (Per): Cuma icermeyen gecerli aralik.
      await assertSucceeds(updateDoc(ref, { bitis: '2026-05-21' }));
    },
  },
  {
    // Alanlar hasOnly'ye eklenirken TIPSIZ birakilmamali (bkz. isValidDuyuru
    // ve isValidBildirim'deki ayni desen) — aksi halde istemci bu alanlara
    // sinirsiz uzunlukta serbest metin yazabilirdi.
    name: 'izin talebinde bildirimGonderildi/gonderim damgasi yanlis tiplerle yazilamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'izinler/yanlisTipBayrak'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          olusturmaTarihi: Timestamp.now(),
          bildirimGonderildi: 'evet',
        })
      );
      await assertFails(
        setDoc(doc(db, 'izinler/yanlisTipDamga'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          olusturmaTarihi: Timestamp.now(),
          bildirimGonderimBaslangici: 'simdi',
        })
      );
    },
  },
  {
    name: 'admin duyuru yazabilir ve silebilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'duyurular/adminNotice');

      // Gercek servis (duyuruServisi.ts duyuruYayinla) her zaman 'tip'
      // gonderiyor — isValidDuyuru eklenmeden once bu alan sema disi
      // kaldigindan bu test fixture'i eksikti (bkz. asagidaki yeni testler).
      await assertSucceeds(
        setDoc(ref, {
          baslik: 'Admin',
          icerik: 'Metin',
          tip: 'duyuru',
          tarih: Timestamp.now(),
        })
      );
      await assertSucceeds(deleteDoc(ref));
    },
  },
  {
    // Ucuncu denetim turu bulgusu: duyurular hic sema dogrulamasi
    // yapmiyordu (diger tum yazilabilir varliklarin aksine) — yetki acigi
    // degildi (yalnizca admin yazabiliyor) ama tutarsizlikti.
    name: 'admin duyurusuna sema disi ekstra alan ekleyemez (isValidDuyuru hasOnly)',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      await assertFails(
        setDoc(doc(db, 'duyurular/extraFieldNotice'), {
          baslik: 'Admin',
          icerik: 'Metin',
          tip: 'duyuru',
          tarih: Timestamp.now(),
          yetkisizAlan: 'sizma denemesi',
        })
      );
    },
  },
  {
    name: 'admin duyurusu gecersiz tip degeriyle olusturulamaz',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      await assertFails(
        setDoc(doc(db, 'duyurular/invalidTipNotice'), {
          baslik: 'Admin',
          icerik: 'Metin',
          tip: 'gecersiz_kategori',
          tarih: Timestamp.now(),
        })
      );
    },
  },
  {
    // duyuruYayinla yayin aninda bildirimGonderildi:false yazar (bkz.
    // duyuruServisi.ts) — bu alan isValidDuyuru'nun hasOnly'sine eklenmezse
    // her yeni duyuru "fazladan anahtar" ihlaliyle reddedilirdi.
    name: 'admin duyuruyu bildirimGonderildi:false ile olusturabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'duyurular/bildirimBayrakli'), {
          baslik: 'Admin',
          icerik: 'Metin',
          tip: 'duyuru',
          tarih: Timestamp.now(),
          bildirimGonderildi: false,
        })
      );
    },
  },
  {
    name: 'duyurunun bildirimGonderildi alani bool disi bir degerle olusturulamaz',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      await assertFails(
        setDoc(doc(db, 'duyurular/gecersizBildirimBayrakli'), {
          baslik: 'Admin',
          icerik: 'Metin',
          tip: 'duyuru',
          tarih: Timestamp.now(),
          bildirimGonderildi: 'evet',
        })
      );
    },
  },
  {
    name: 'admin muezzin profilini sema icinde guncelleyebilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertSucceeds(
        updateDoc(doc(db, 'muezzins/muezzin1'), {
          aktif: false,
          onayBekliyor: false,
          arsivlendi: true,
          arsivTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'admin muezzin profiline sema disi alan ekleyemez',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertFails(
        updateDoc(doc(db, 'muezzins/muezzin1'), {
          internalDebugNote: 'Sema disi alan',
        })
      );
    },
  },
  {
    name: 'admin sistem ayarlarini sadece gecerli sema ile yazabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'settings/system'), {
          ilceId: '9148',
          ilceAdi: 'Ceyhan',
          hicriDuzeltme: 0,
        })
      );

      await assertFails(
        setDoc(doc(db, 'settings/system'), {
          ilceId: '91',
          ilceAdi: '',
          hicriDuzeltme: 7,
        })
      );
    },
  },
  {
    name: 'admin vakit onbellegini sadece gecerli sema ile yazabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'vakitler/9148_2026-05'), {
          ilceId: '9148',
          gunler: validVakitGunleri(),
          kaynakApi: 'diyanet',
          guncellenmeTarihi: Timestamp.now(),
        })
      );

      await assertFails(
        setDoc(doc(db, 'vakitler/9148_2026-06'), {
          ilceId: '9148',
          gunler: {},
          kaynakApi: 'bilinmeyen',
          guncellenmeTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // Resmi Diyanet API'si (bkz. scripts/lib/diyanetResmiApi.ts) 'diyanet'
    // (emushaf.net proxy'si) yerine ayirt edici 'diyanet-resmi' degeriyle
    // yaziyor — uc kaynagin da (diyanet/diyanet-resmi/aladhan) semaya kabul
    // edildigini dogrular.
    name: 'admin vakit onbellegine diyanet-resmi kaynagiyla da yazabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'vakitler/9148_2026-08'), {
          ilceId: '9148',
          gunler: validVakitGunleri(),
          kaynakApi: 'diyanet-resmi',
          guncellenmeTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // aylikVakitleriGrupla, API'nin kayan penceresini gerçek takvim ayına göre
    // böldüğünden içinde bulunulan ay için kasıtlı olarak PARTIAL bir grup
    // üretir (ayın ortasında senkronize edilirse o ay yalnızca kalan günleri
    // içerir) — alt sınır bunu artık reddetmemeli (bkz. mantık denetimi).
    name: 'admin vakit onbellegine ayin kismi (partial) gununu de yazabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'vakitler/9148_2026-07'), {
          ilceId: '9148',
          gunler: {
            '2026-07-28': { sabah: '04:10', gunes: '05:42', ogle: '12:45', ikindi: '16:30', aksam: '19:51', yatsi: '21:18' },
            '2026-07-29': { sabah: '04:10', gunes: '05:42', ogle: '12:45', ikindi: '16:30', aksam: '19:51', yatsi: '21:18' },
            '2026-07-30': { sabah: '04:10', gunes: '05:42', ogle: '12:45', ikindi: '16:30', aksam: '19:51', yatsi: '21:18' },
          },
          kaynakApi: 'diyanet',
          guncellenmeTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'giris yapan kullanici kendi denetim kaydini olusturabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'audit_logs/userAudit'), {
          actionType: 'Vekalet Kabul',
          targetName: '2026-05-22 ogle',
          details: 'Kullanici kendisine gelen vekalet talebini kabul etti.',
          userId: 'muezzin1',
          userDisplayName: 'Muezzin One',
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'kullanici baskasi adina denetim kaydi olusturamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();

      await assertFails(
        setDoc(doc(db, 'audit_logs/forgedAudit'), {
          actionType: 'Sahte Kayit',
          targetName: 'Admin',
          details: 'Baska kullanici adina audit yazma denemesi.',
          userId: 'admin',
          userDisplayName: 'Admin',
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'denetim kayitlari sonradan degistirilemez ve sadece admin listeleyebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'audit_logs/existingAudit'), {
          actionType: 'Personel Daveti',
          targetName: 'valid@example.test',
          details: 'Davet olusturuldu.',
          userId: 'admin',
          userDisplayName: 'Admin',
          timestamp: Timestamp.now(),
        });
      });

      const adminDb = testUser(env, 'admin').firestore();
      const muezzinDb = testUser(env, 'muezzin1').firestore();

      await assertSucceeds(getDocs(query(collection(adminDb, 'audit_logs'), orderBy('timestamp', 'desc'), limit(30))));
      await assertFails(getDocs(query(collection(muezzinDb, 'audit_logs'), orderBy('timestamp', 'desc'), limit(30))));
      await assertFails(
        updateDoc(doc(adminDb, 'audit_logs/existingAudit'), {
          details: 'Degistirildi.',
        })
      );
      await assertFails(deleteDoc(doc(adminDb, 'audit_logs/existingAudit')));
    },
  },
  {
    name: 'muezzin kendi bekleyen gorevi icin vekalet talebi acabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'muezzin Cuma gorevi icin vekalet talebi acamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-22_ogle_asil_muezzin2'), {
          bildirimId: 'fridayPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-22',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'muezzin baskasinin gorevi icin vekalet talebi acamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-22_ikindi_asil_muezzin1'), {
          bildirimId: 'otherPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin1',
          aliciIsim: 'Muezzin One',
          tarih: '2026-05-22',
          vakit: 'ikindi',
          saat: '16:30',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // O10 regresyonu: vekaletTeklifEt (src/services/vekaletServisi.ts), yeni
    // bir teklif olusturmadan once ayni deterministik ID'de daha once
    // reddedilmis bir talep var mi diye getDoc ile bakar. Talep henuz HIC
    // olusturulmamissa `resource` null olur; eskiden `isVekaletParticipant`
    // bu durumda `null.gonderenUid` erisimiyle degerlendirme hatasi
    // firlatiyordu ve admin OLMAYAN hicbir kullanici ilk teklifini
    // gonderemiyordu (getDoc adimi her zaman reddediliyordu). `izinler`
    // L783'teki `resource == null` deseniyle simetrik sekilde duzeltildi.
    name: 'muezzin henuz var olmayan bir vekalet talebini get ile sorgulayabilir (O10 regresyonu)',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(getDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-22_yatsi_asil_muezzin2')));
    },
  },
  {
    // O7'nin AYNI SINIFI, cron kaynakli red yolunda:
    // scripts/vekaletDevirleriniIsle.ts kabul edilmis bir devri uygulama
    // aninda uygulayamadiginda talebi (Admin SDK ile, kurallari atlayarak)
    // durum:'reddedildi' + talepSonuc:'reddedildi' + bildirimUygulandi:true
    // olarak isaretler. `durum` 'kabul_edildi'de BIRAKILSAYDI asagidaki
    // delete kurali eslesmez, ayni deterministik ID'ye (haftaId_tarih_vakit_
    // tip_aliciUid) yapilan setDoc ise create degil UPDATE sayilip
    // isValidVekaletCreate/isRecipientVekaletStatusUpdate'in hicbiriyle
    // eslesmezdi — gonderen o (gorev, alici) cifti icin bir daha ASLA teklif
    // gonderemezdi. Kurallar gevsetilmedi; script'in yazdigi durum,
    // ZATEN VAR OLAN delete kuralinin kapsamina getirildi.
    name: 'cron tarafindan reddedilen talebi gonderen silip yeniden olusturabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'reddedildi',
          talepSonuc: 'reddedildi',
          bildirimUygulandi: true,
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(deleteDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2')));
      await assertSucceeds(
        setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // Yukaridaki duzeltmenin kurallari GEVSETMEDIGINI kilitler: hala
    // uygulanmayi bekleyen (durum 'kabul_edildi') bir talep gonderen
    // tarafindan silinemez — aksi halde gonderen, alicinin kabulunu
    // cron uygulamadan once tek tarafli olarak yok edebilirdi.
    name: 'gonderen kabul edilmis (henuz uygulanmamis) bir talebi silemez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'kabul_edildi',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(deleteDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2')));
    },
  },
  {
    name: 'vekalet alicisi talebi kabul edip bildirimi devralabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin2').firestore();
      // NOT ("1000 ifade tavanı" kök neden çözümü): GERÇEK transfer (uid
      // flip'i) artık istemci tarafında değil, scripts/vekaletDevirleriniIsle.ts'te
      // (Admin SDK) gerçekleşiyor — bkz. tests/integration/vekaletDevirleriniIsle.test.ts.
      // İstemci burada yalnızca talebi kabul eder ve dar bir niyet bayrağı yazar.
      await assertSucceeds(
        runTransaction(db, async (transaction) => {
          transaction.update(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
            durum: 'kabul_edildi',
            sonGuncelleme: Timestamp.now(),
          });
          transaction.update(doc(db, 'bildirimler/ownPendingAsil'), {
            vekaletDevriBekliyor: true,
            sonGuncelleme: Timestamp.now(),
          });
        })
      );

      // Eski doğrudan-transfer yolu artık TAMAMEN KAPALI — talep kabul
      // edilmiş olsa bile istemci uid'i doğrudan flip edemez (bkz.
      // isAcceptedVekaletBildirimTransfer'in silindiği "1000 ifade tavanı"
      // kök neden çözümü). Bu, aşağıdaki "vekalet alicisi kabul etmeden
      // bildirimi devralamaz" testinin ayna görüntüsü — burada FARKI, talep
      // GERÇEKTEN kabul edilmiş olması, yine de fark etmiyor.
      await assertFails(
        updateDoc(doc(db, 'bildirimler/ownPendingAsil'), {
          uid: 'muezzin2',
          vekaletDevredildi: true,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    // NOT ("1000 ifade tavanı" kök neden çözümü): sabit haftalık izin-günü
    // çakışması artık BURADA (CEL'de) değil, scripts/vekaletDevirleriniIsle.ts'te
    // TAZE veriyle yeniden doğrulanıyor (bkz. tests/integration/
    // vekaletDevirleriniIsle.test.ts "izin gününe denk gelen..." vakası).
    // Rules katmanında artık doğru davranış, izin-günü çakışmasından
    // BAĞIMSIZ olarak dar niyet bayrağı yazımının başarılı olmasıdır —
    // gerçek engelleme script'te gerçekleşir.
    name: "vekalet kabul niyet bayragi izin-gunu cakismasindan bagimsiz yazilabilir (kontrol script'e tasindi)",
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        // 2026-05-20 bir Carsamba (haftaGunuNumarasi -> 3); Cuma kisitlamasi
        // (cumaMi) ile karismasin diye ayri bir bilinen gun kullanildi.
        await setDoc(doc(db, 'muezzins/muezzin2'), { haftalikIzinGunu: 3 }, { merge: true });
        await setDoc(doc(db, 'bildirimler/wednesdayPendingAsil'), {
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
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'wednesdayPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'kabul_edildi',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin2').firestore();
      await assertSucceeds(
        updateDoc(doc(db, 'bildirimler/wednesdayPendingAsil'), {
          vekaletDevriBekliyor: true,
          sonGuncelleme: Timestamp.now(),
        })
      );
      // Ama dogrudan uid transferi hala her kosulda kapali.
      await assertFails(
        updateDoc(doc(db, 'bildirimler/wednesdayPendingAsil'), {
          uid: 'muezzin2',
          vekaletDevredildi: true,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    // NOT ("1000 ifade tavanı" kök neden çözümü): arşivlenmiş alıcı kontrolü
    // artık BURADA (CEL'de) değil, scripts/vekaletDevirleriniIsle.ts'te TAZE
    // veriyle yeniden doğrulanıyor (bkz. tests/integration/
    // vekaletDevirleriniIsle.test.ts "arşivlenmiş alıcı..." vakası, eski O9
    // regresyonunun taşınmış hali). Rules katmanında artık doğru davranış,
    // alıcının arşivli olmasından BAĞIMSIZ olarak dar niyet bayrağı
    // yazımının başarılı olmasıdır.
    name: "vekalet kabul niyet bayragi alicinin arsivli olmasindan bagimsiz yazilabilir (kontrol script'e tasindi)",
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'muezzins/muezzin2'), {
          displayName: 'Muezzin Two',
          email: 'muezzin2@example.test',
          role: 'muezzin',
          aktif: false, // talep beklerken admin tarafından arşivlendi
          photoURL: '',
          fcmToken: null,
          aylikVakitSayisi: 0,
        });
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin2').firestore();
      await assertSucceeds(
        runTransaction(db, async (transaction) => {
          transaction.update(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
            durum: 'kabul_edildi',
            sonGuncelleme: Timestamp.now(),
          });
          transaction.update(doc(db, 'bildirimler/ownPendingAsil'), {
            vekaletDevriBekliyor: true,
            sonGuncelleme: Timestamp.now(),
          });
        })
      );
    },
  },
  {
    name: 'vekalet alicisi kendi bekleyen tekliflerini listeleyebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin2').firestore();
      await assertSucceeds(
        getDocs(query(collection(db, 'vekalet_talepleri'), where('aliciUid', '==', 'muezzin2'), where('durum', '==', 'beklemede')))
      );
    },
  },
  {
    name: 'muezzin tum vekalet taleplerini listeleyemez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(getDocs(collection(db, 'vekalet_talepleri')));
    },
  },
  {
    name: 'vekalet alicisi kabul etmeden bildirimi devralamaz',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin2').firestore();
      await assertFails(
        updateDoc(doc(db, 'bildirimler/ownPendingAsil'), {
          uid: 'muezzin2',
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: "K1: okudum transaction'i (yalnizca bildirim guncellemesi) basarili olur",
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const ref = doc(db, 'bildirimler/ownPendingAsil');
      await assertSucceeds(
        runTransaction(db, async (transaction) => {
          await transaction.get(ref);
          transaction.update(ref, { durum: 'onaylandi', pendingAck: false, sonGuncelleme: Timestamp.now() });
        })
      );
    },
  },
  {
    name: "K1 regresyon guardi: okudum transaction'ina muezzins puan yazimi eklenirse tum transaction reddedilir",
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const bildirimRef = doc(db, 'bildirimler/ownPendingAsil');
      const muezzinRef = doc(db, 'muezzins/muezzin1');
      await assertFails(
        runTransaction(db, async (transaction) => {
          await transaction.get(bildirimRef);
          transaction.update(bildirimRef, { durum: 'onaylandi', pendingAck: false, sonGuncelleme: Timestamp.now() });
          transaction.update(muezzinRef, { aylikVakitSayisi: 1 });
        })
      );
    },
  },
  {
    name: 'K2: yedegi olmayan/uygun olmayan mazeret sadece alarm_bekliyor ile reddedilebilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(mazeretRetBatch(db, 'ownPendingAsil', 'muezzin1', 'Hastalik', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    // NOT ("1000 ifade tavanı" kök neden çözümü): isBackupPromotionFromMazeret
    // TAMAMEN SİLİNDİ — yedek belgenin `tip` alanını client-side değiştirebilecek
    // HİÇBİR dal kalmadı (bkz. firestore.rules yorumu). Asil'in durumu ne
    // olursa olsun (reddedilmiş olsun ya da olmasın) bu artık koşulsuz reddedilir.
    name: 'K2 guvenlik: yedek belgenin tip alani client tarafindan hicbir sekilde degistirilemez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const yedekRef = doc(db, 'bildirimler/W2026-06-01_2026-06-03_yatsi_yedek');
      await assertFails(
        updateDoc(yedekRef, {
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          asilMazeretUid: 'muezzin1',
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: "K2 guvenlik: baskasinin gorevi icin mazeret transaction'i baslatilamaz",
    run: async (env) => {
      const db = testUser(env, 'muezzin2').firestore();
      await assertFails(mazeretRetBatch(db, 'W2026-06-01_2026-06-03_yatsi_asil', 'muezzin2', 'Sahte', { devirSonucu: 'yedek_atandi' }));
    },
  },
  {
    // NOT ("1000 ifade tavanı" kök neden çözümü — DAVRANIŞ DEĞİŞİKLİĞİ):
    // eskiden 'yedek_atandi' TEK başına (yedeğin gerçekten terfi ettiğine
    // dair eşleşen bir getAfter() korelasyonu olmadan) reddediliyordu — bu,
    // kuralın en pahalı, ~27 terimlik çapraz-belge doğrulamasıydı. Artık bu
    // korelasyon KASITLI olarak CEL'den kaldırıldı: `devirSonucu` yalnızca
    // scripts/mazeretDevirleriniIsle.ts için bir İPUCU, YETKİLENDİRİCİ değil
    // — script, yedeğin GERÇEK uygunluğunu taze veriyle kendisi yeniden
    // doğrular (bkz. tests/integration/mazeretDevirleriniIsle.test.ts). Bu
    // yüzden asil-only bir yazım, yedek belgenin durumundan TAMAMEN
    // BAĞIMSIZ olarak artık başarılı olmalı.
    name: 'K2: devirSonucu=yedek_atandi asil-only yazim, yedegin gercek durumundan bagimsiz kabul edilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        mazeretRetBatch(db, 'W2026-06-01_2026-06-03_yatsi_asil', 'muezzin1', 'Hastalik', { devirSonucu: 'yedek_atandi' })
      );
    },
  },
  {
    name: 'K6: gecerli semali error_log olusturulabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'error_logs/validLog'), {
          errorMessage: 'Test hatasi',
          errorStack: 'Error: Test hatasi\n  at test.ts:1:1',
          componentStack: '',
          userId: 'muezzin1',
          device: { os: 'Test', browser: 'Test', screenSize: '1x1', pwaMode: false, language: 'tr' },
          breadcrumbs: [],
          stateSnapshot: { authUid: 'muezzin1' },
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'K6: asiri buyuk error_log reddedilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'error_logs/tooBig'), {
          errorMessage: 'x'.repeat(3000),
          errorStack: '',
          componentStack: '',
          userId: 'muezzin1',
          device: {},
          breadcrumbs: [],
          stateSnapshot: {},
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'K6: baskasi adina error_log olusturulamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'error_logs/forged'), {
          errorMessage: 'Test',
          errorStack: '',
          componentStack: '',
          userId: 'muezzin2',
          device: {},
          breadcrumbs: [],
          stateSnapshot: {},
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'K6: gecerli semali telemetry_log olusturulabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'telemetry_logs/validEvent'), {
          eventType: 'page_view',
          eventName: '/profil',
          userId: 'muezzin1',
          metadata: { device: { os: 'Test' } },
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'K6: gecersiz eventType ile telemetry_log olusturulamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'telemetry_logs/invalidType'), {
          eventType: 'gecersiz_tip',
          eventName: '/profil',
          userId: 'muezzin1',
          metadata: {},
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'K2: devirSonucu sema disi bir deger olamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      // Eslesen mazeret_detaylari yazimi DAHIL edildi ki test yalnizca
      // gecersiz devirSonucu degerini izole etsin.
      await assertFails(mazeretRetBatch(db, 'ownPendingAsil', 'muezzin1', 'Hastalik', { devirSonucu: 'gecersiz_deger' }));
    },
  },
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
  {
    name: 'config/bootstrap listesindeki e-posta ile admin yetkisi kazanilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'config/bootstrap'), {
          superAdminEmails: ['superadmin@example.test'],
        });
      });

      const db = testUser(env, 'superadmin').firestore();
      // isValidDuyuru eklendikten sonra gecerli sema gonderilmeli — bu
      // testin amaci yetki (bootstrap admin), sema degil.
      await assertSucceeds(
        setDoc(doc(db, 'duyurular/bootstrapNotice'), {
          baslik: 'Test',
          icerik: 'Bootstrap admin testi',
          tip: 'duyuru',
          tarih: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'config/bootstrap listesinde olmayan e-posta admin yetkisi kazanamaz',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'config/bootstrap'), {
          superAdminEmails: ['superadmin@example.test'],
        });
      });

      const db = testUser(env, 'digerkullanici').firestore();
      // Sema gecerli olsa bile (isValidDuyuru) yetki eksikliginden
      // reddedilmeli — bu testin amaci tam olarak bu.
      await assertFails(
        setDoc(doc(db, 'duyurular/unauthorizedNotice'), {
          baslik: 'Test',
          icerik: 'Yetkisiz deneme',
          tip: 'duyuru',
          tarih: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'siradan admin config/bootstrap yazamaz (K2 regresyonu)',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'config/bootstrap'), {
          superAdminEmails: ['gercekSuperAdmin@example.test'],
        });
        await setDoc(doc(db, 'muezzins/siradanAdmin'), {
          displayName: 'Siradan Admin',
          aktif: true,
          role: 'admin',
          email: 'siradanadmin@example.test',
        });
      });

      const db = testUser(env, 'siradanAdmin').firestore();
      await assertFails(
        setDoc(doc(db, 'config/bootstrap'), {
          superAdminEmails: ['siradanadmin@example.test'],
        })
      );
    },
  },
  {
    // Yıllık izin onayı, izinler.durum ve muezzins.yillikIzinKullanilanGun'u
    // AYNI transaction'da atomik günceller (bkz. useAdminIzinlerStore.ts
    // izinGuncelle). Kota dahilindeyse (20 + 5 gün = 25 <= 30) her iki yazım
    // da başarılı olmalı.
    name: 'yillik izin onayi kota dahilindeyse muezzins sayacini da atomik gunceller',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'muezzins/muezzin1'), { yillikIzinKullanilanGun: 20 }, { merge: true });
        await setDoc(doc(db, 'izinler/yillikTalebi1'), {
          uid: 'muezzin1',
          baslangic: '2026-08-10',
          bitis: '2026-08-14', // 5 gün (dahil)
          tip: 'yillik',
          durum: 'onay_bekliyor',
          sebep: 'Test',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      await assertSucceeds(
        runTransaction(db, async (transaction) => {
          transaction.update(doc(db, 'izinler/yillikTalebi1'), { durum: 'onaylandi' });
          transaction.update(doc(db, 'muezzins/muezzin1'), { yillikIzinKullanilanGun: 25 });
        })
      );
    },
  },
  {
    // Kotayı aşan bir onay (28 + 5 gün = 33 > 30) SUNUCU tarafında
    // tamamen reddedilmeli — admin override'ı yok (kullanıcı kararı).
    // isValidMuezzin'deki <=30 sert sınırı muezzins yazımını reddeder,
    // bu da TÜM transaction'ı (izinler.durum dahil) başarısız kılar.
    name: 'yillik izin onayi kotayi asiyorsa sunucu tarafinda tamamen reddedilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'muezzins/muezzin2'), { yillikIzinKullanilanGun: 28 }, { merge: true });
        await setDoc(doc(db, 'izinler/yillikTalebi2'), {
          uid: 'muezzin2',
          baslangic: '2026-09-01',
          bitis: '2026-09-05', // 5 gün (dahil)
          tip: 'yillik',
          durum: 'onay_bekliyor',
          sebep: 'Test',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      await assertFails(
        runTransaction(db, async (transaction) => {
          transaction.update(doc(db, 'izinler/yillikTalebi2'), { durum: 'onaylandi' });
          transaction.update(doc(db, 'muezzins/muezzin2'), { yillikIzinKullanilanGun: 33 });
        })
      );
    },
  },
  // ---------------------------------------------------------------
  // P1.5 — 'gozlemci' salt-okuma (bkz. premium denetim)
  // ---------------------------------------------------------------
  {
    // Gozlemci rolu hicbir zaman nobete atanmaz, ama rol SONRADAN
    // degistirilebildiginden (muezzin -> gozlemci) eski bildirimleri
    // uzerinden self-update denemesi mumkun. isSelfBildirimUpdate'in
    // sonundaki isAssignableDutyUid (role == 'muezzin') bunu kapatir —
    // bu test o garantiyi kilitler (firestore.rules'ta redundant bir
    // `role != 'gozlemci'` terimi EKLENMEDIGININ gerekcesi, bkz. oradaki
    // "1000 ifade tavani" notu).
    name: 'P1.5: gozlemci kendi bildirimini onaylayamaz (self-update reddedilir)',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'bildirimler/gozlemciEskiGorev'), {
          haftaId: 'W2026-05-18',
          tarih: '2026-05-20',
          vakit: 'sabah',
          uid: 'gozlemci1',
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
          mazeretSonBasvuru: PENCERE_ACIK(),
        });
      });

      const db = testUser(env, 'gozlemci1').firestore();
      await assertFails(
        updateDoc(doc(db, 'bildirimler/gozlemciEskiGorev'), {
          durum: 'onaylandi',
          pendingAck: false,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'P1.5: gozlemci kendi bildirimi icin mazeret bildiremez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'bildirimler/gozlemciEskiGorev'), {
          haftaId: 'W2026-05-18',
          tarih: '2026-05-20',
          vakit: 'sabah',
          uid: 'gozlemci1',
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
          mazeretSonBasvuru: PENCERE_ACIK(),
        });
      });

      const db = testUser(env, 'gozlemci1').firestore();
      await assertFails(
        mazeretRetBatch(db, 'gozlemciEskiGorev', 'gozlemci1', 'Test', {
          devirSonucu: 'alarm_bekliyor',
        })
      );
    },
  },
  {
    // GONDEREN rolu artik isValidVekaletCreate icinde de dogrulaniyor —
    // eskiden yalnizca "bu bildirim benim mi" bakiliyordu, yani rolu
    // sonradan 'gozlemci'ye cekilmis biri eski gorevi uzerinden hala
    // teklif acabiliyordu (bkz. premium denetim P1.5).
    name: 'P1.5: gozlemci vekalet talebi olusturamaz',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'bildirimler/gozlemciEskiGorev'), {
          haftaId: 'W2026-05-18',
          tarih: '2026-05-20',
          vakit: 'sabah',
          uid: 'gozlemci1',
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
          mazeretSonBasvuru: PENCERE_ACIK(),
        });
      });

      const db = testUser(env, 'gozlemci1').firestore();
      await assertFails(
        setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_sabah_asil_muezzin2'), {
          bildirimId: 'gozlemciEskiGorev',
          haftaId: 'W2026-05-18',
          gonderenUid: 'gozlemci1',
          gonderenIsim: 'Gozlemci One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'sabah',
          saat: '05:30',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // Regresyon korumasi: gonderen rol kontrolu eklenirken NORMAL muezzin
    // akisi kirilmamali (yukaridaki "muezzin kendi bekleyen gorevi icin
    // vekalet talebi acabilir" testinin ikizi — burada acikca P1.5
    // degisikligine bagli).
    name: 'P1.5: muezzin vekalet talebi acmaya devam edebilir (regresyon)',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  // ---------------------------------------------------------------
  // P1.6 — admin / super-admin ayrimi (bkz. premium denetim)
  // ---------------------------------------------------------------
  {
    // error_logs/telemetry_logs SALT-BIRIKTIRME koleksiyonlari: mesru admin
    // akisinda yalnizca OKUNUR. Toplu silme (SistemHatalariSekmesi "TEMIZLE",
    // veriSifirlamaServisi) artik yalnizca config/bootstrap listesindeki
    // super-admin'e acik.
    name: 'P1.6: siradan admin error_logs/telemetry_logs silemez, super-admin silebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'config/bootstrap'), {
          superAdminEmails: ['superadmin@example.test'],
        });
        await setDoc(doc(db, 'error_logs/eskiHata'), {
          errorMessage: 'Eski hata',
          errorStack: '',
          componentStack: '',
          userId: 'muezzin1',
          device: {},
          breadcrumbs: [],
          stateSnapshot: {},
          timestamp: Timestamp.now(),
        });
        await setDoc(doc(db, 'telemetry_logs/eskiOlay'), {
          eventType: 'page_view',
          eventName: '/profil',
          userId: 'muezzin1',
          metadata: {},
          timestamp: Timestamp.now(),
        });
      });

      const adminDb = testUser(env, 'admin').firestore();
      await assertFails(deleteDoc(doc(adminDb, 'error_logs/eskiHata')));
      await assertFails(deleteDoc(doc(adminDb, 'telemetry_logs/eskiOlay')));

      const superDb = testUser(env, 'superadmin').firestore();
      await assertSucceeds(deleteDoc(doc(superDb, 'error_logs/eskiHata')));
      await assertSucceeds(deleteDoc(doc(superDb, 'telemetry_logs/eskiOlay')));
    },
  },
  {
    // Daraltma yalnizca update/delete'i kapsar — admin'in hata gunluklerini
    // OKUMASI (SistemHatalariSekmesi'nin tum varlik sebebi) ve istemcinin
    // hata/telemetri KAYDETMESI aynen calismaya devam etmeli.
    name: 'P1.6: siradan admin error_logs/telemetry_logs okumaya devam edebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'error_logs/eskiHata'), {
          errorMessage: 'Eski hata',
          errorStack: '',
          componentStack: '',
          userId: 'muezzin1',
          device: {},
          breadcrumbs: [],
          stateSnapshot: {},
          timestamp: Timestamp.now(),
        });
      });

      const adminDb = testUser(env, 'admin').firestore();
      await assertSucceeds(getDoc(doc(adminDb, 'error_logs/eskiHata')));
      await assertSucceeds(getDocs(query(collection(adminDb, 'error_logs'), orderBy('timestamp', 'desc'), limit(20))));

      // Siradan bir muezzin hala kendi hata kaydini olusturabilmeli.
      const muezzinDb = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        setDoc(doc(muezzinDb, 'error_logs/yeniHata'), {
          errorMessage: 'Yeni hata',
          errorStack: '',
          componentStack: '',
          userId: 'muezzin1',
          device: {},
          breadcrumbs: [],
          stateSnapshot: {},
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    // veriSifirlamaServisi'nin sildigi DIGER koleksiyonlar (bildirimler,
    // haftaPlanlari, izinler, vekalet_talepleri, adminUyarilari, duyurular)
    // BILINCLI olarak isAdmin()'de birakildi: bunlarin delete izni normal
    // admin is akislarinin (tekil bildirim silme, plan yeniden uretimi, izin
    // reddi temizligi) ayrilmaz parcasi ve Firestore kurallarinda "tekil
    // silme" ile "toplu silme" ayrilamaz. Bu test o kararin bilincli
    // oldugunu ve kazara daraltilmadigini kilitler.
    name: 'P1.6: siradan admin operasyonel koleksiyonlarda tekil silmeye devam edebilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      await assertSucceeds(deleteDoc(doc(db, 'bildirimler/ownPendingAsil')));
    },
  },
];

async function main() {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    for (const test of tests) {
      await env.clearFirestore();
      await seedBaseData(env);
      await test.run(env);
      console.log(`OK ${test.name}`);
    }

    assert.equal(tests.length > 0, true);
    console.log(`${tests.length} firestore rules test passed`);
  } finally {
    await env.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
