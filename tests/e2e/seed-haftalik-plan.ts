/**
 * E2E ortam hazırlığı: `planServisi.ts`'in admin tarafı için (vakitAtamasiniGuncelle
 * + haftalikPlanOlustur self-healing) Firestore/Auth emülatörlerine 1 admin +
 * 4 aktif müezzin seed eder, iki AYRI hafta hazırlar:
 *  - Hafta A: vakitAtamasiniGuncelle testleri için — bir slot 'bekliyor'
 *    (düzenlenebilir), bir slot 'onaylandi' (korunan/protected).
 *  - Hafta B: haftaPlanlari YOK (self-healing'i tetiklemek için silinir),
 *    yalnızca bir 'onaylandi' slot var — self-healing'in bunu koruyup
 *    korumadığını doğrulamak için.
 * Desen seed-mazeret.ts/seed-vekalet.ts ile aynı (emailVerified:true zorunlu).
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { startOfWeek, addWeeks, format } from 'date-fns';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const app = getApps().length ? getApps()[0]! : initializeApp({ projectId: firebaseConfig.projectId });
const db = getFirestore(app);
const auth = getAuth(app);

const ADMIN_UID = 'muezzin_e2e_plan_admin';
const MUEZZIN_UIDS = ['muezzin_e2e_plan_bir', 'muezzin_e2e_plan_iki', 'muezzin_e2e_plan_uc', 'muezzin_e2e_plan_dort'];
const MUEZZIN_NAMES = ['PlanBir', 'PlanIki', 'PlanUc', 'PlanDort'];

const VAKITLER = ['sabah', 'ogle', 'ikindi', 'aksam', 'yatsi'] as const;

// src/lib/dateUtils.ts getHaftaIdFromDate ile birebir aynı formül
// (startOfWeek weekStartsOn:1 + 'W' önekli yyyy-MM-dd).
function haftaIdFromDate(date: Date): string {
  const pazartesi = startOfWeek(date, { weekStartsOn: 1 });
  return `W${format(pazartesi, 'yyyy-MM-dd')}`;
}

function haftaGunleri(haftaId: string): string[] {
  const pazartesi = new Date(haftaId.substring(1) + 'T00:00:00');
  return Array.from({ length: 7 }, (_, i) => {
    const gun = new Date(pazartesi);
    gun.setDate(pazartesi.getDate() + i);
    return format(gun, 'yyyy-MM-dd');
  });
}

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
      aylikVakitSayisi: 0,
    });
}

async function clearWeekBildirimleri(haftaId: string) {
  const gunler = haftaGunleri(haftaId);
  const batch = db.batch();
  for (const gun of gunler) {
    for (const vakit of VAKITLER) {
      for (const tip of ['asil', 'yedek']) {
        batch.delete(db.collection('bildirimler').doc(`${haftaId}_${gun}_${vakit}_${tip}`));
      }
    }
  }
  await batch.commit();
}

async function seed() {
  await ensureUser(ADMIN_UID, 'E2E Plan Admin', 'admin');
  for (let i = 0; i < MUEZZIN_UIDS.length; i++) {
    await ensureUser(MUEZZIN_UIDS[i]!, MUEZZIN_NAMES[i]!, 'muezzin');
  }
  const [uid1, uid2, uid3, uid4] = MUEZZIN_UIDS;

  const now = new Date();
  const haftaIdA = haftaIdFromDate(now);
  const haftaIdB = haftaIdFromDate(addWeeks(now, 1));
  const gunlerA = haftaGunleri(haftaIdA);
  const pazartesiA = gunlerA[0]!;

  // --- Hafta A: bir 'bekliyor' (düzenlenebilir) + bir 'onaylandi' (korunan) slot ---
  await clearWeekBildirimleri(haftaIdA);
  await db.collection('haftaPlanlari').doc(haftaIdA).delete();

  const gunlerAObj: Record<string, Record<string, { asil: string; yedek: string }>> = {};
  for (const gun of gunlerA) {
    gunlerAObj[gun] = {};
    for (const vakit of VAKITLER) {
      gunlerAObj[gun]![vakit] = { asil: 'Sistem', yedek: 'Sistem' };
    }
  }
  gunlerAObj[pazartesiA]!['ogle'] = { asil: uid1!, yedek: uid2! };
  gunlerAObj[pazartesiA]!['ikindi'] = { asil: uid3!, yedek: uid4! };

  await db.collection('haftaPlanlari').doc(haftaIdA).set({
    haftaBaslangic: pazartesiA,
    haftaBitis: gunlerA[6],
    durum: 'yayinda',
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
    gunler: gunlerAObj,
  });

  await db.collection('bildirimler').doc(`${haftaIdA}_${pazartesiA}_ogle_asil`).set({
    haftaId: haftaIdA,
    tarih: pazartesiA,
    vakit: 'ogle',
    uid: uid1,
    tip: 'asil',
    durum: 'bekliyor',
    pendingAck: true,
    retSebebi: null,
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
  });
  await db.collection('bildirimler').doc(`${haftaIdA}_${pazartesiA}_ogle_yedek`).set({
    haftaId: haftaIdA,
    tarih: pazartesiA,
    vakit: 'ogle',
    uid: uid2,
    tip: 'yedek',
    durum: 'bekliyor',
    pendingAck: true,
    retSebebi: null,
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
  });
  await db.collection('bildirimler').doc(`${haftaIdA}_${pazartesiA}_ikindi_asil`).set({
    haftaId: haftaIdA,
    tarih: pazartesiA,
    vakit: 'ikindi',
    uid: uid3,
    tip: 'asil',
    durum: 'onaylandi',
    pendingAck: false,
    retSebebi: null,
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
  });
  await db.collection('bildirimler').doc(`${haftaIdA}_${pazartesiA}_ikindi_yedek`).set({
    haftaId: haftaIdA,
    tarih: pazartesiA,
    vakit: 'ikindi',
    uid: uid4,
    tip: 'yedek',
    durum: 'onaylandi',
    pendingAck: false,
    retSebebi: null,
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
  });

  // --- Hafta B: haftaPlanlari YOK, tek bir 'onaylandi' slot var ---
  const gunlerB = haftaGunleri(haftaIdB);
  const pazartesiB = gunlerB[0]!;
  await clearWeekBildirimleri(haftaIdB);
  await db.collection('haftaPlanlari').doc(haftaIdB).delete();

  await db.collection('bildirimler').doc(`${haftaIdB}_${pazartesiB}_ogle_asil`).set({
    haftaId: haftaIdB,
    tarih: pazartesiB,
    vakit: 'ogle',
    uid: uid1,
    tip: 'asil',
    durum: 'onaylandi',
    pendingAck: false,
    retSebebi: null,
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
  });
  await db.collection('bildirimler').doc(`${haftaIdB}_${pazartesiB}_ogle_yedek`).set({
    haftaId: haftaIdB,
    tarih: pazartesiB,
    vakit: 'ogle',
    uid: uid2,
    tip: 'yedek',
    durum: 'onaylandi',
    pendingAck: false,
    retSebebi: null,
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
  });

  const tokenAdmin = await auth.createCustomToken(ADMIN_UID);
  return {
    tokenAdmin,
    haftaIdA,
    pazartesiA,
    haftaIdB,
    pazartesiB,
    uid1,
    uid2,
    uid3,
    uid4,
  };
}

seed()
  .then((result) => {
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  })
  .catch((err) => {
    console.error('E2E haftalık plan seed başarısız:', err);
    process.exit(1);
  });
