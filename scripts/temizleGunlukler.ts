import { db, Timestamp } from './lib/firebaseAdminInit.ts';

/**
 * error_logs ve telemetry_logs koleksiyonları admin SDK ile (kurallar
 * atlanarak) sınırsız büyüyebilir; Firestore native TTL policy bu repodan
 * uygulanamadığı için (Firebase Console/gcloud CLI erişimi gerektirir) bu
 * script eşdeğer bir işlevi periyodik bir cron ile sağlar — bkz.
 * .github/workflows/gunluk-log-temizligi.yml.
 */
const RETENTION_DAYS = 30;
const CHUNK_SIZE = 400;

async function deleteOldDocs(collectionName: string): Promise<number> {
  const cutoff = Timestamp.fromMillis(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;

  // Sınırsız büyük koleksiyonlarda tek seferde tüm eski kayıtları çekmemek
  // için sayfalama (limit + tekrar sorgu) kullanılır.
  while (true) {
    const snap = await db.collection(collectionName).where('timestamp', '<', cutoff).limit(CHUNK_SIZE).get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();

    totalDeleted += snap.size;
    if (snap.size < CHUNK_SIZE) break;
  }

  return totalDeleted;
}

async function main() {
  const errorLogsDeleted = await deleteOldDocs('error_logs');
  console.log(`error_logs: ${errorLogsDeleted} adet ${RETENTION_DAYS} günden eski kayıt silindi.`);

  const telemetryLogsDeleted = await deleteOldDocs('telemetry_logs');
  console.log(`telemetry_logs: ${telemetryLogsDeleted} adet ${RETENTION_DAYS} günden eski kayıt silindi.`);
}

main().catch((err) => {
  console.error('Günlük temizliği başarısız:', err);
  process.exit(1);
});
