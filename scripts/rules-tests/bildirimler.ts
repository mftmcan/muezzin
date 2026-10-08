// Bildirim (nobet gorevi) testleri: olusturma kurallari, onay (okudum)
// akisi, K1 okudum transaction semasi ve kimlik alanlarinin
// degistirilemezligi.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, runTransaction, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { TestCase, testUser } from './ortak.ts';

export const tests: TestCase[] = [
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
];
