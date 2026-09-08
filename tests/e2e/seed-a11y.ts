/**
 * E2E ortam hazırlığı: `tests/e2e/a11y.spec.ts` için 1 admin + 1 müezzin
 * seed eder. Desen `seed-haftalik-plan.ts`/`seed-mazeret.ts` ile aynı
 * (emailVerified:true zorunlu, `__testSignIn` için custom token üretir).
 * Kapsamlı görev/plan verisi seed ETMİYOR — amaç ekranların BOŞ/temel
 * durumda bile gerçek a11y ihlali (eksik label, kontrast, klavye tuzağı)
 * taşımadığını doğrulamak; dolu veri senaryoları diğer e2e testlerinde
 * zaten kapsanıyor.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const app = getApps().length ? getApps()[0]! : initializeApp({ projectId: firebaseConfig.projectId });
const db = getFirestore(app);
const auth = getAuth(app);

const ADMIN_UID = 'muezzin_e2e_a11y_admin';
const MUEZZIN_UID = 'muezzin_e2e_a11y_muezzin';

async function ensureUser(uid: string, displayName: string, role: 'admin' | 'muezzin') {
  try {
    await auth.deleteUser(uid);
  } catch {
    // kullanıcı yoktu, sorun değil
  }
  await auth.createUser({ uid, email: `${uid}@example.test`, displayName, emailVerified: true });
  await db
    .collection('muezzins')
    .doc(uid)
    .set({
      displayName,
      email: `${uid}@example.test`,
      role,
      aktif: true,
      photoURL: '',
      fcmToken: null,
      onayBekliyor: false,
      // firestore.rules isValidMuezzin `kayitTarihi is string` şartı koşuyor
      // (bkz. o dosyadaki yorum — useAuthStore.ts ISO string yazar, Timestamp
      // DEĞİL). Burada yanlışlıkla Timestamp.now() yazılmıştı; bu, muezzins
      // koleksiyonunun TAMAMINI güncelleyen HERHANGİ bir işlemin (ör.
      // veriSifirlamaServisi.ts kadroSayaclariniSifirla — tek bir writeBatch,
      // içindeki TEK bir belge kuralı ihlal etse bile TÜMÜ reddedilir)
      // PERMISSION_DENIED almasına yol açıyordu (bkz. premium denetim P2.5
      // sonrası CI regresyonu — veri-sifirlama.spec.ts).
      kayitTarihi: new Date().toISOString(),
    });
}

async function seed() {
  await ensureUser(ADMIN_UID, 'A11y Admin', 'admin');
  await ensureUser(MUEZZIN_UID, 'A11y Muezzin', 'muezzin');

  const tokenAdmin = await auth.createCustomToken(ADMIN_UID);
  const tokenMuezzin = await auth.createCustomToken(MUEZZIN_UID);
  return { tokenAdmin, tokenMuezzin };
}

seed()
  .then((result) => {
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  })
  .catch((err) => {
    console.error('E2E a11y seed başarısız:', err);
    process.exit(1);
  });
