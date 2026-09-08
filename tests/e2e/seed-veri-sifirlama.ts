/**
 * E2E ortam hazırlığı: `veriSifirlamaServisi.ts` / VeriSifirlamaModal.tsx
 * ("Tehlikeli Bölge" — operasyonel veri sıfırlama) için Firestore/Auth
 * emülatörlerine 1 admin seed eder ve BEŞ varsayılan-seçili operasyonel
 * koleksiyona (bildirimler, haftaPlanlari, izinler, vekalet_talepleri,
 * adminUyarilari) bilinen SAYIDA belge yazar — modal'daki canlı belge
 * sayılarının doğru gösterildiğini VE silme sonrası gerçekten sıfır
 * kaldığını doğrulamak için. Ayrıca:
 *  - `mazeret_detaylari` ve `audit_logs`'a birer belge yazılır — bunlar
 *    firestore.rules'da kalıcı/silinemez (bkz. o dosyadaki "Sabit kayıt"
 *    yorumları), reset SONRASINDA da hâlâ var olmaları gerekir.
 *  - Seed edilen muezzin'in aylikVakitSayisi/aylikCumaSayisi/
 *    aylikYedekSayisi/yillikIzinKullanilanGun alanları sıfırdan farklı
 *    (5/2/1/3) — "kadro sayaçlarını da sıfırla" seçeneğinin gerçekten
 *    0'a çektiğini doğrulamak için.
 * Desen tests/e2e/seed-haftalik-plan.ts ile aynı.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const app = getApps().length ? getApps()[0]! : initializeApp({ projectId: firebaseConfig.projectId });
const db = getFirestore(app);
const auth = getAuth(app);

const ADMIN_UID = 'muezzin_e2e_sifirlama_admin';
const MUEZZIN_UID = 'muezzin_e2e_sifirlama_kisi';

const BILDIRIM_SAYISI = 3;
const IZIN_SAYISI = 2;
const VEKALET_SAYISI = 1;
const UYARI_SAYISI = 2;
// haftaPlanlari tek belge (haftaId başına 1 plan) — sayı sabit.

async function ensureUser(uid: string, displayName: string) {
  try {
    await auth.deleteUser(uid);
  } catch {
    // kullanıcı yoktu, sorun değil
  }
  await auth.createUser({ uid, email: `${uid}@example.test`, displayName, emailVerified: true });
}

async function temizlePrefix(koleksiyon: string, prefix: string) {
  const snap = await db.collection(koleksiyon).get();
  const batch = db.batch();
  let sayildi = 0;
  snap.docs.forEach((d) => {
    if (d.id.startsWith(prefix)) {
      batch.delete(d.ref);
      sayildi++;
    }
  });
  if (sayildi > 0) await batch.commit();
}

async function seed() {
  await ensureUser(ADMIN_UID, 'E2E Sifirlama Admin');
  await db
    .collection('muezzins')
    .doc(ADMIN_UID)
    .set({
      displayName: 'E2E Sifirlama Admin',
      email: `${ADMIN_UID}@example.test`,
      role: 'admin',
      aktif: true,
      photoURL: '',
      fcmToken: null,
      aylikVakitSayisi: 0,
    });
  // Operasyonel veri sıfırlama artık sıradan admin'e değil yalnızca
  // config/bootstrap.superAdminEmails listesindeki süper-admin'e açık (bkz.
  // premium denetim P1.6, VeriSifirlamaModal.tsx). Bu e2e akış "TEHLİKELİ
  // BÖLGE" düğmesinin gerçekten silme yaptığını doğruladığı için test
  // kullanıcısının süper-admin olması gerekiyor — merge:true ile yazılır ki
  // aynı koşuda önce çalışan başka bir seed'in (bkz. scripts/
  // firestore-rules-tests.ts'teki 'superadmin@example.test' gibi) bootstrap
  // dokümanındaki diğer alanlarını/e-postalarını SİLMESİN.
  await db
    .collection('config')
    .doc('bootstrap')
    .set(
      {
        superAdminEmails: FieldValue.arrayUnion(`${ADMIN_UID}@example.test`),
      },
      { merge: true }
    );

  await ensureUser(MUEZZIN_UID, 'E2E Sifirlama Kisi');
  await db
    .collection('muezzins')
    .doc(MUEZZIN_UID)
    .set({
      displayName: 'E2E Sifirlama Kisi',
      email: `${MUEZZIN_UID}@example.test`,
      role: 'muezzin',
      aktif: true,
      photoURL: '',
      fcmToken: null,
      // Sıfırdan farklı — "kadro sayaçlarını da sıfırla" seçeneğinin
      // gerçekten 0'a çektiğini doğrulamak için.
      aylikVakitSayisi: 5,
      aylikCumaSayisi: 2,
      aylikYedekSayisi: 1,
      yillikIzinKullanilanGun: 3,
    });

  const prefix = 'e2eSifirlamaTest_';

  // Önceki bir koşudan kalmış olabilecek belgeleri temizle (idempotent re-run).
  await temizlePrefix('bildirimler', prefix);
  await temizlePrefix('izinler', prefix);
  await temizlePrefix('vekalet_talepleri', prefix);
  await temizlePrefix('adminUyarilari', prefix);
  await db.collection('haftaPlanlari').doc(`${prefix}hafta`).delete();
  await db.collection('mazeret_detaylari').doc(`${prefix}mazeret`).delete();
  await db.collection('audit_logs').doc(`${prefix}log`).delete();

  // Modal'ın gösterdiği canlı sayı (getCountFromServer, bkz.
  // veriSifirlamaServisi.ts) koleksiyonun TAMAMINI sayar — yalnızca bu
  // seed'in yazdığı belgeleri değil. `firebase emulators:exec` TÜM
  // `npx playwright test` koşusu için TEK bir emülatör örneği başlattığından
  // (bkz. .github/workflows/test.yml), aynı koşuda önce çalışan başka e2e
  // spec'leri (haftalık plan/mazeret/vekalet seed'leri) bu koleksiyonlara
  // kendi belgelerini bırakmış olabilir. Test önceden sıfır önceden-var-olan
  // belge varsaydığından, spec çalıştırma sırasına/paralelliğine bağlı
  // olarak flaky bir şekilde başarısız oluyordu (bkz. code-review). Baseline
  // burada ölçülüp seed sayısına eklenir ki beklenen toplam HER ZAMAN
  // modal'ın gerçekte göstereceği sayıyla eşleşsin.
  const baseline = async (koleksiyon: string) => (await db.collection(koleksiyon).get()).size;
  const [bildirimBaseline, izinBaseline, uyariBaseline] = await Promise.all([
    baseline('bildirimler'),
    baseline('izinler'),
    baseline('adminUyarilari'),
  ]);

  const batch = db.batch();

  for (let i = 0; i < BILDIRIM_SAYISI; i++) {
    batch.set(db.collection('bildirimler').doc(`${prefix}bildirim_${i}`), {
      haftaId: 'W2026-09-07',
      tarih: '2026-09-07',
      vakit: 'ogle',
      uid: MUEZZIN_UID,
      tip: 'asil',
      durum: 'bekliyor',
      pendingAck: true,
      retSebebi: null,
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
    });
  }

  batch.set(db.collection('haftaPlanlari').doc(`${prefix}hafta`), {
    haftaBaslangic: '2026-09-07',
    haftaBitis: '2026-09-13',
    durum: 'yayinda',
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
    gunler: {},
  });

  for (let i = 0; i < IZIN_SAYISI; i++) {
    batch.set(db.collection('izinler').doc(`${prefix}izin_${i}`), {
      uid: MUEZZIN_UID,
      baslangic: '2026-09-10',
      bitis: '2026-09-10',
      tip: 'yillik',
      durum: 'onay_bekliyor',
      olusturmaTarihi: Timestamp.now(),
    });
  }

  for (let i = 0; i < VEKALET_SAYISI; i++) {
    batch.set(db.collection('vekalet_talepleri').doc(`${prefix}vekalet_${i}`), {
      bildirimId: `${prefix}bildirim_0`,
      haftaId: 'W2026-09-07',
      gonderenUid: MUEZZIN_UID,
      gonderenIsim: 'E2E Sifirlama Kisi',
      aliciUid: ADMIN_UID,
      aliciIsim: 'E2E Sifirlama Admin',
      tarih: '2026-09-07',
      vakit: 'ogle',
      saat: '12:45',
      tip: 'asil',
      durum: 'beklemede',
      olusturmaTarihi: Timestamp.now(),
    });
  }

  for (let i = 0; i < UYARI_SAYISI; i++) {
    batch.set(db.collection('adminUyarilari').doc(`${prefix}uyari_${i}`), {
      tip: 'zincirTukendi',
      mesaj: 'E2E test uyarisi',
      tarih: '2026-09-07',
      cozuldu: false,
      olusturmaTarihi: Timestamp.now(),
    });
  }

  // Kapsam DIŞI, silinmemesi gereken belgeler (bkz. dosya başı yorumu).
  batch.set(db.collection('mazeret_detaylari').doc(`${prefix}mazeret`), {
    uid: MUEZZIN_UID,
    retSebebi: 'E2E test - silinmemeli',
    olusturmaTarihi: Timestamp.now(),
  });
  batch.set(db.collection('audit_logs').doc(`${prefix}log`), {
    actionType: 'E2E Test Kaydi',
    targetName: 'Silinmemeli',
    details: 'Bu kayit sifirlama sonrasi da var olmali.',
    userId: ADMIN_UID,
    userDisplayName: 'E2E Sifirlama Admin',
    timestamp: Timestamp.now(),
  });

  await batch.commit();

  const tokenAdmin = await auth.createCustomToken(ADMIN_UID);
  return {
    tokenAdmin,
    prefix,
    muezzinUid: MUEZZIN_UID,
    beklenenSayilar: {
      bildirimler: bildirimBaseline + BILDIRIM_SAYISI,
      haftaPlanlari: 1,
      izinler: izinBaseline + IZIN_SAYISI,
      vekalet_talepleri: VEKALET_SAYISI,
      adminUyarilari: uyariBaseline + UYARI_SAYISI,
    },
  };
}

seed()
  .then((result) => {
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  })
  .catch((err) => {
    console.error('E2E veri sifirlama seed basarisiz:', err);
    process.exit(1);
  });
