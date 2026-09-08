/**
 * E2E ortam hazırlığı: vekalet (görev devri) akışı için Firestore + Auth
 * emülatörlerine İKİ gerçek kullanıcı (gönderen A, alıcı B) seed eder, ikisi
 * için de imzalı custom token üretip STDOUT'a TEK SATIR JSON olarak yazar
 * (`{"tokenA":"...","tokenB":"..."}`) — tests/e2e/vekalet-flow.spec.ts iki
 * ayrı tarayıcı context'inde bu token'larla signInWithCustomToken çağırıp
 * gerçek, birbirinden bağımsız Firebase Auth oturumları açar. Desen
 * seed-mazeret.ts ile birebir aynı (emailVerified:true zorunluluğu dahil —
 * bkz. o dosyadaki yorum, firestore.rules isSignedIn()).
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const app = getApps().length ? getApps()[0]! : initializeApp({ projectId: firebaseConfig.projectId });
const db = getFirestore(app);
const auth = getAuth(app);

const UID_A = 'muezzin_e2e_vekalet_gonderen';
const UID_B = 'muezzin_e2e_vekalet_alici';

// seed-mazeret.ts'teki turkeyTodayStr ile birebir aynı — makinenin yerel saat
// dilimi ayarından bağımsız, uygulamayla aynı "Türkiye bugünü".
function turkeyTodayStr(): string {
  const turkeyMs = Date.now() + 3 * 60 * 60 * 1000;
  const turkey = new Date(turkeyMs);
  const y = turkey.getUTCFullYear();
  const m = String(turkey.getUTCMonth() + 1).padStart(2, '0');
  const d = String(turkey.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function ensureUser(uid: string, displayName: string) {
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
      role: 'muezzin',
      aktif: true,
      photoURL: '',
      fcmToken: null,
      aylikVakitSayisi: 0,
    });
}

/**
 * Mazeret/vekalet penceresinin SUNUCU tarafı damgası (bkz. firestore.rules
 * `mazeretPenceresiAcik`). Kural bu alanı Firestore'un KENDİ `request.time`
 * değeriyle karşılaştırır — testin `page.clock.setFixedTime` ile dondurduğu
 * TARAYICI saati burada geçerli değildir. Alan yoksa kural FAIL-CLOSED
 * davranır ve akış "Bu işlem için yetkiniz yok" ile düşer; bu yüzden seed,
 * pencerenin GERÇEK zamanda açık olduğu bir damga yazar.
 */
function acikPencereDamgasi() {
  return Timestamp.fromMillis(Date.now() + 6 * 60 * 60 * 1000);
}

/**
 * `vakitler/{ilceId}_{YYYY-MM}` + `settings/system` tohumlar.
 *
 * `mazeretZamanKontrolYap` (src/services/mazeretServisi.ts) ezan saatini
 * çağıran açıkça vermediğinde (ör. `vekaletKabulEt`) buradan okur ve saat
 * bulunamazsa artık FAIL-CLOSED davranır — yani seed edilmemiş bir emülatörde
 * akış "ezan vakti bilinmiyor" ile dururdu. Saatler, testlerin dondurduğu
 * "bugün 10:00" Türkiye saatine göre kasıtlı olarak İLERİDEDİR (pencere açık).
 */
async function vakitleriTohumla(todayStr: string) {
  const ilceId = '9148';
  await db.collection('settings').doc('system').set({ ilceId }, { merge: true });
  await db
    .collection('vakitler')
    .doc(`${ilceId}_${todayStr.slice(0, 7)}`)
    .set(
      {
        gunler: {
          [todayStr]: {
            sabah: '04:10',
            gunes: '05:42',
            ogle: '12:45',
            ikindi: '16:30',
            aksam: '19:51',
            yatsi: '21:18',
          },
        },
      },
      { merge: true }
    );
}

async function seed() {
  await ensureUser(UID_A, 'E2E Vekalet Gönderen');
  await ensureUser(UID_B, 'E2E Vekalet Alıcı');

  const todayStr = turkeyTodayStr();
  const haftaId = `W${todayStr}`;

  await vakitleriTohumla(todayStr);

  // Teklif-gönderme testi: A'ya ait, bugünün YATSI asil görevi. B bu slot
  // için HİÇBİR bildirim kaydına sahip değil (kasıtlı) — GorevKarti.tsx'teki
  // eligiblePeers, aynı tarih+vakit için zaten (reddedilmemiş) bir bildirimi
  // olan müezzinleri hariç tutuyor; B'nin burada bir kaydı olsaydı teklif
  // edilebilir akranlar listesinden düşerdi.
  const teklifBildirimId = `${haftaId}_${todayStr}_yatsi_asil`;
  await db.collection('bildirimler').doc(teklifBildirimId).set({
    haftaId,
    tarih: todayStr,
    vakit: 'yatsi',
    uid: UID_A,
    tip: 'asil',
    durum: 'bekliyor',
    pendingAck: true,
    retSebebi: null,
    vekaletDevredildi: false,
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
    mazeretSonBasvuru: acikPencereDamgasi(),
  });
  // Daha önceki bir CI koşusundan kalan teklifi temizle (deterministik ID).
  await db.collection('vekalet_talepleri').doc(`${haftaId}_${todayStr}_yatsi_asil_${UID_B}`).delete();

  // Kabul testi: farklı bir vakit (ikindi) kullanılarak yukarıdaki slotla
  // çakışması önlenir. Burada teklif adımı ATLANIR — vekalet_talepleri
  // belgesi doğrudan "A zaten teklif etmiş, beklemede" durumuyla seed
  // edilir (tests/integration/vekaletDevirleriniIsle.test.ts'teki "kabul
  // edilmiş kabul edilir" seed deseniyle aynı mantık) — bu test yalnızca
  // vekaletKabulEt'in gerçek UI/transaction yolunu doğrular.
  const kabulBildirimId = `${haftaId}_${todayStr}_ikindi_asil`;
  await db.collection('bildirimler').doc(kabulBildirimId).set({
    haftaId,
    tarih: todayStr,
    vakit: 'ikindi',
    uid: UID_A,
    tip: 'asil',
    durum: 'bekliyor',
    pendingAck: true,
    retSebebi: null,
    vekaletDevredildi: false,
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
    mazeretSonBasvuru: acikPencereDamgasi(),
  });
  const kabulTalepId = `${haftaId}_${todayStr}_ikindi_asil_${UID_B}`;
  await db.collection('vekalet_talepleri').doc(kabulTalepId).set({
    bildirimId: kabulBildirimId,
    haftaId,
    gonderenUid: UID_A,
    gonderenIsim: 'E2E Vekalet Gönderen',
    aliciUid: UID_B,
    aliciIsim: 'E2E Vekalet Alıcı',
    tarih: todayStr,
    vakit: 'ikindi',
    saat: '16:34',
    tip: 'asil',
    durum: 'beklemede',
    olusturmaTarihi: Timestamp.now(),
  });

  const tokenA = await auth.createCustomToken(UID_A);
  const tokenB = await auth.createCustomToken(UID_B);
  return { tokenA, tokenB };
}

seed()
  .then((tokens) => {
    process.stdout.write(JSON.stringify(tokens));
    process.exit(0);
  })
  .catch((err) => {
    console.error('E2E vekalet seed başarısız:', err);
    process.exit(1);
  });
