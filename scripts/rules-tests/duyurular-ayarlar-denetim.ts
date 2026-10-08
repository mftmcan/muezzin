// Duyurular, sistem ayarlari (settings), vakit onbellegi, denetim
// (audit) kayitlari ve K6 error_log/telemetry_log semasi.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDocs, limit, orderBy, query, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { TestCase, testUser, validVakitGunleri } from './ortak.ts';

export const tests: TestCase[] = [
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
];
