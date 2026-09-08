/**
 * E2E ortam hazırlığı: Firestore + Auth emülatörlerine (firebase emulators:start
 * ile ayağa kalkmış olmalı) gerçek bir kullanıcı ve bekleyen bir "asil" görev
 * bildirimi seed eder, sonra o kullanıcı için imzalı bir custom token üretip
 * STDOUT'a yazar. tests/e2e/mazeret-flow.spec.ts bu token'ı yakalayıp
 * signInWithCustomToken ile GERÇEK bir Firebase Auth oturumu açar — böylece
 * uygulama Firestore güvenlik kurallarına göre gerçekten kimlikli istek atar
 * (önceki sürüm yalnızca localStorage üzerinden UI state'ini kandırıyordu ve
 * asıl Firestore çağrıları production'a kimliksiz gidiyordu).
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

const UID = 'muezzin_e2e_asil';
const YEDEK_UID = 'muezzin_e2e_yedek';

/**
 * Uygulama "bugün"ü her zaman Türkiye saatiyle (UTC+3, bkz. src/lib/dateUtils.ts
 * getTurkeyDateString) hesaplıyor. Bu fonksiyon önceden çalıştıran makinenin
 * SİSTEM yerel saatini kullanıyordu — GitHub Actions runner'ları UTC'de
 * çalıştığından, 21:00–24:00 UTC arası (Türkiye'de gece yarısını geçmiş)
 * seed "bugün" ile uygulamanın gördüğü "bugün" bir takvim günü farklı oluyor,
 * seed edilen bildirim hiç bulunamıyor ve E2E testi rastgele/saat-bağımlı
 * biçimde başarısız oluyordu. UTC aritmetiği + UTC getter'ları kullanarak
 * makinenin yerel saat dilimi ayarından tamamen bağımsız, uygulamayla birebir
 * aynı "Türkiye bugünü"nü hesaplıyoruz.
 */
function turkeyTodayStr(): string {
  const turkeyMs = Date.now() + 3 * 60 * 60 * 1000; // UTC+3 sabit ofset (Türkiye'de DST yok)
  const turkey = new Date(turkeyMs);
  const y = turkey.getUTCFullYear();
  const m = String(turkey.getUTCMonth() + 1).padStart(2, '0');
  const d = String(turkey.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

async function seed(): Promise<string> {
  try {
    await auth.deleteUser(UID);
  } catch {
    // kullanıcı yoktu, sorun değil
  }
  // emailVerified: true zorunlu — firestore.rules'taki isSignedIn() artık
  // request.auth.token.email_verified == true şartını arıyor (K1 güvenlik
  // düzeltmesi, gerçek kullanıcılar yalnızca doğrulanmış e-postayla gelen
  // Google girişi kullandığından). Bu alan olmadan createCustomToken'dan
  // üretilen oturumun email_verified'ı false kalıyor, isSignedIn() HER
  // Firestore isteğinde false dönüyor, dinleyiciler sessizce (yeniden
  // denemeden) hata alıp kapanıyor — seed edilen görev hiç görünmüyordu
  // (bkz. E2E flakiness soruşturması).
  await auth.createUser({ uid: UID, email: `${UID}@example.test`, displayName: 'E2E Asil', emailVerified: true });

  await db
    .collection('muezzins')
    .doc(UID)
    .set({
      displayName: 'E2E Asil',
      email: `${UID}@example.test`,
      role: 'muezzin',
      aktif: true,
      photoURL: '',
      fcmToken: null,
      aylikVakitSayisi: 0,
    });

  await db
    .collection('muezzins')
    .doc(YEDEK_UID)
    .set({
      displayName: 'E2E Yedek',
      email: `${YEDEK_UID}@example.test`,
      role: 'muezzin',
      aktif: true,
      photoURL: '',
      fcmToken: null,
      aylikVakitSayisi: 0,
    });

  const todayStr = turkeyTodayStr();
  const haftaId = `W${todayStr}`;

  await vakitleriTohumla(todayStr);

  // mazeret_detaylari (bkz. firestore.rules) doc ID'leri bildirimler ile
  // AYNI (deterministik: haftaId_tarih_vakit_tip) ve kural gereği sabit/
  // değişmez (`allow update, delete: if false`). Bu ID'ler bugünün tarihine
  // bağlı olduğundan, aynı CI koşusunda birden fazla Playwright projesi
  // (chromium, mobile-chrome) aynı emülatöre karşı art arda seed çalıştırınca
  // önceki projenin başarılı mazeret denemesinden kalan kayıt burada hâlâ
  // duruyor olabilir — bildirimler'i "bekliyor"a resetlemek yeterli değil,
  // sonraki mazeretBildir() çağrısındaki `set()` bu eski kaydı bir UPDATE
  // sayılıp kural tarafından reddediliyordu ("Bu işlem için yetkiniz yok.").
  // Admin SDK kuralları atladığından burada temiz bir silme her zaman güvenli.
  await db.collection('mazeret_detaylari').doc(`${haftaId}_${todayStr}_yatsi_asil`).delete();
  await db.collection('mazeret_detaylari').doc(`${haftaId}_${todayStr}_yatsi_yedek`).delete();

  await db.collection('bildirimler').doc(`${haftaId}_${todayStr}_yatsi_asil`).set({
    haftaId,
    tarih: todayStr,
    vakit: 'yatsi',
    uid: UID,
    tip: 'asil',
    durum: 'bekliyor',
    pendingAck: true,
    retSebebi: null,
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
    mazeretSonBasvuru: acikPencereDamgasi(),
  });

  await db.collection('bildirimler').doc(`${haftaId}_${todayStr}_yatsi_yedek`).set({
    haftaId,
    tarih: todayStr,
    vakit: 'yatsi',
    uid: YEDEK_UID,
    tip: 'yedek',
    durum: 'bekliyor',
    pendingAck: true,
    retSebebi: null,
    olusturmaTarihi: Timestamp.now(),
    sonGuncelleme: Timestamp.now(),
    mazeretSonBasvuru: acikPencereDamgasi(),
  });

  return auth.createCustomToken(UID);
}

seed()
  .then((token) => {
    // Yalnızca token'ı yazdır — Playwright bunu stdout'tan doğrudan okuyor.
    process.stdout.write(token);
    process.exit(0);
  })
  .catch((err) => {
    console.error('E2E seed başarısız:', err);
    process.exit(1);
  });
