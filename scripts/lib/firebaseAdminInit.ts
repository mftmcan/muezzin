import { cert, applicationDefault, initializeApp, getApps, type Credential } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json' assert { type: 'json' };
import fs from 'fs';
import path from 'path';

let credential: Credential | undefined;
const credentialsPath = path.resolve(process.cwd(), 'credentials.json');
const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

if (envKey) {
  try {
    const rawKey = envKey.startsWith('{') ? envKey : Buffer.from(envKey, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(rawKey);
    console.log(
      `Firebase Admin: Using service account for project: ${serviceAccount.project_id} (Client Email: ${serviceAccount.client_email})`
    );
    credential = cert(serviceAccount);
  } catch {
    // SIR SIZINTISI: yakalanan hata NESNESİ ASLA loglanmaz. Node 20+'ta
    // `JSON.parse`'ın SyntaxError mesajı, ayrıştırılamayan girdinin ~30
    // karakterlik bir PARÇASINI mesajın içine gömer ("... is not valid JSON"
    // öncesinde). Burada ayrıştırılan girdi SERVİS HESABI ANAHTARININ TA
    // KENDİSİ (private_key dahil) olduğundan, bozuk bir secret'ta bu mesaj
    // gerçek anahtarın bir alt dizgesini bu PUBLIC repo'nun GitHub Actions
    // loglarına yazardı — GitHub'ın secret maskeleme özelliği yalnızca
    // secret'ın TAMAMINI eşleştirir, rastgele bir alt dizgesini değil.
    // `cert()` de anahtar alanlarını hatalarına koyabildiğinden yalnızca
    // JSON.parse değil, tüm blok bu şekilde ele alınır.
    //
    // Fail-fast: eskiden hata yutuluyor ve applicationDefault()'a
    // düşülüyordu — CI'da bu, kök nedeni (yanlış yapılandırılmış secret)
    // gizleyen çok daha kafa karıştırıcı bir izin hatası üretiyordu.
    // Loglanan tek şey sırdan türetilmeyen metadata: uzunluk ve biçim.
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY / GOOGLE_APPLICATION_CREDENTIALS_JSON ' +
        'geçerli bir servis hesabı anahtarı olarak ayrıştırılamadı ' +
        `(uzunluk: ${envKey.length}, biçim: ${envKey.startsWith('{') ? 'düz JSON' : 'base64'}). ` +
        'Ayrıntılı hata metni, gerçek anahtarın bir parçasını içerebileceği için bilinçli olarak gizlendi.'
    );
  }
}

if (!credential && fs.existsSync(credentialsPath)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    credential = cert(serviceAccount);
    console.log('Using service account from credentials.json');
  } catch {
    // Hata nesnesi yine loglanmaz (yukarıdaki AYNI gerekçe — dosyanın
    // içeriği de bir servis hesabı anahtarıdır). Burada FIRLATILMAZ:
    // credentials.json yalnızca yerel geliştirmede kullanılan opsiyonel bir
    // yoldur, bozuksa applicationDefault()'a düşmek meşru davranıştır.
    console.error(`credentials.json okunamadı/ayrıştırılamadı (${credentialsPath}) — application default credentials denenecek.`);
  }
}

if (!credential) {
  credential = applicationDefault();
  console.log('Using application default credentials');
}

const existingApps = getApps();
const app = existingApps.length
  ? existingApps[0]!
  : initializeApp({
      credential,
      projectId: firebaseConfig.projectId,
    });

// Named database usage in Admin SDK: getFirestore(databaseId)
// If the ID is "(default)", we use the default database by passing no arguments.
const dbId =
  firebaseConfig.firestoreDatabaseId === '(default)' || !firebaseConfig.firestoreDatabaseId
    ? undefined
    : firebaseConfig.firestoreDatabaseId;

export const db = dbId ? getFirestore(app, dbId) : getFirestore(app);
export const auth = getAuth(app);
export { Timestamp, FieldValue };
