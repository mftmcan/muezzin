// Kimlik/rol testleri: temel auth erisimi (K1), profil kendi kendine
// guncelleme, fcm token haritasi, davetle profil olusturma akisi,
// config/bootstrap admin listesi ve P1.5 (gozlemci) / P1.6 (super-admin)
// rol sinirlari.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { TestCase, testUser, mazeretRetBatch, PENCERE_ACIK } from './ortak.ts';

export const tests: TestCase[] = [
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
