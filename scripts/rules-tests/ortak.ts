// Kural testlerinin paylasilan cekirdegi: TestCase tipi, testUser fixture
// ureteci, mazeret ret batch yardimcisi, 1 saatlik pencere damga
// sabitleri (PENCERE_ACIK/PENCERE_KAPALI), seedBaseData ve
// validVakitGunleri. Grup dosyalari yardimcilari `./ortak.ts`ten alir;
// orkestrator (scripts/firestore-rules-tests.ts) yalnizca projectId,
// seedBaseData ve TestCase tipini kullanir.

import { RulesTestContext, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp, writeBatch } from 'firebase/firestore';

// Grup dosyalarinin dogrudan import edebilmesi icin re-exportlar.
export { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
export {
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

export const projectId = 'demo-muezzin-rules';

export type TestCase = {
  name: string;
  run: (env: RulesTestEnvironment) => Promise<void>;
};

export const testUser = (env: RulesTestEnvironment, uid: string, role?: string): RulesTestContext => {
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
export function mazeretRetBatch(
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
export const PENCERE_ACIK = () => Timestamp.fromMillis(Date.now() + 6 * 60 * 60 * 1000);
export const PENCERE_KAPALI = () => Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);

export async function seedBaseData(env: RulesTestEnvironment) {
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

export function validVakitGunleri() {
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
