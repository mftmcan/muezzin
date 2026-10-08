// Muezzin profil yonetimi: admin`in haftalik izin gunu / profil semasi
// guncellemeleri ve davet (invite) yonetimi.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
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
];
