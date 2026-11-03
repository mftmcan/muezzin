// Muezzin profil yonetimi: admin`in haftalik izin gunu / profil semasi
// guncellemeleri ve davet (invite) yonetimi.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { TestCase, testUser } from './ortak.ts';

export const tests: TestCase[] = [
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
    name: 'siradan admin yonetici daveti olusturamaz veya personeli yoneticiye terfi ettiremez',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertFails(
        setDoc(doc(db, 'invites/yeni-admin@example.test'), {
          email: 'yeni-admin@example.test',
          displayName: 'Yeni Admin',
          role: 'admin',
          olusturmaTarihi: Timestamp.now(),
        })
      );
      await assertFails(updateDoc(doc(db, 'muezzins/muezzin2'), { role: 'admin' }));
    },
  },
  {
    name: 'yalnizca super-admin yonetici daveti olusturup personeli yoneticiye terfi ettirebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'config/bootstrap'), { superAdminEmails: ['superadmin@example.test'] });
      });
      const db = testUser(env, 'superadmin').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'invites/yeni-admin@example.test'), {
          email: 'yeni-admin@example.test',
          displayName: 'Yeni Admin',
          role: 'admin',
          olusturmaTarihi: Timestamp.now(),
        })
      );
      await assertSucceeds(updateDoc(doc(db, 'muezzins/muezzin2'), { role: 'admin' }));
    },
  },
  {
    name: 'siradan admin baska bir yonetici hesabini degistiremez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'muezzins/digerAdmin'), {
          displayName: 'Diger Admin',
          email: 'diger-admin@example.test',
          role: 'admin',
          aktif: true,
        });
      });

      const db = testUser(env, 'admin').firestore();
      await assertFails(updateDoc(doc(db, 'muezzins/digerAdmin'), { aktif: false }));
    },
  },
  {
    name: 'admin personel davetini denetim kaydiyla atomik olusturabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      const batch = writeBatch(db);
      batch.set(doc(db, 'invites/atomic@example.test'), {
        email: 'atomic@example.test',
        displayName: 'Atomic User',
        role: 'muezzin',
        olusturmaTarihi: Timestamp.now(),
      });
      batch.set(doc(db, 'audit_logs/atomikPersonelDaveti'), {
        actionType: 'Personel Daveti',
        targetName: 'atomic@example.test',
        details: 'Yeni personel daveti oluşturuldu.',
        userId: 'admin',
        userDisplayName: 'Admin',
        timestamp: serverTimestamp(),
      });
      await assertSucceeds(batch.commit());
    },
  },
  {
    name: 'personel daveti olusturma tarihi timestamp disi bir deger olamaz',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      await assertFails(
        setDoc(doc(db, 'invites/invalid-time@example.test'), {
          email: 'invalid-time@example.test',
          displayName: 'Invalid Time',
          role: 'muezzin',
          olusturmaTarihi: '2026-10-31',
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
    name: 'personel kaydini yalnizca super-admin kalici silebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'config/bootstrap'), { superAdminEmails: ['superadmin@example.test'] });
        await setDoc(doc(db, 'muezzins/kaliciSilmeAdayi'), {
          displayName: 'Silme Adayı',
          role: 'muezzin',
          aktif: false,
        });
      });

      const adminDb = testUser(env, 'admin').firestore();
      await assertFails(deleteDoc(doc(adminDb, 'muezzins/kaliciSilmeAdayi')));

      const superDb = testUser(env, 'superadmin').firestore();
      await assertSucceeds(deleteDoc(doc(superDb, 'muezzins/kaliciSilmeAdayi')));
    },
  },
];
