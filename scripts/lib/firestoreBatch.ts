import type { WriteBatch } from 'firebase-admin/firestore';
import { db } from './firebaseAdminInit.ts';

/**
 * Firestore'un SERT sınırı bir `WriteBatch` başına 500 işlemdir; sınırı aşan
 * bir `commit()` tamamen fırlatır (kısmi yazma olmaz). 400, bu sınırın
 * altında bilinçli bir güvenlik payı bırakır — `scripts/mazeretPenceresiBackfill.ts`
 * ve `scripts/backfillCumaMi.ts` aynı değeri elle uyguluyordu, buraya
 * çıkarıldı.
 */
export const BATCH_PARCA_BOYUTU = 400;

/** Tek bir batch'e eklenecek yazma işlemi (update/set/delete). */
export type BatchIslemi = (batch: WriteBatch) => void;

/**
 * Sınırsız sayıda yazma işlemini 500'lük Firestore batch tavanını aşmayacak
 * parçalar halinde commit eder.
 *
 * KÖK NEDEN: `scripts/izinDurumBildirimGonder.ts`, `scripts/duyuruBildirimGonder.ts`
 * ve `scripts/lib/fcmNotify.ts` tek bir `db.batch()` kurup sonunda bir kez
 * commit ediyordu. Bu, tam olarak `fcmGonderVeTemizle`'nin `sendEach` 500
 * sınırında düzeltilen sorunun (bkz. o fonksiyondaki `SEND_CHUNK_SIZE`
 * yorumu) yazma tarafındaki EŞİ: "işlenmemiş kayıt kümesi her zaman küçük
 * kalır" varsayımı, script'in bir süre çalışmadığı (bu yüzden birikmiş)
 * durumda bozulur ve o andan sonra HER koşu aynı hatayla ölür — birikmiş
 * kayıtlar bir daha hiç işlenemez.
 *
 * DİKKAT: parçalar ayrı commit'lerdir, yani ATOMİK DEĞİLDİR. Bu fonksiyon
 * yalnızca işlemleri birbirinden bağımsız olan (her belge kendi başına
 * idempotent işaretlenen) yollar için uygundur; atomiklik gereken yerlerde
 * `db.runTransaction` kullanılmalı (bkz. scripts/vekaletDevirleriniIsle.ts).
 *
 * @returns Yapılan commit sayısı.
 */
export async function parcaliBatchUygula(islemler: BatchIslemi[], parcaBoyutu: number = BATCH_PARCA_BOYUTU): Promise<number> {
  if (islemler.length === 0) return 0;

  let commitSayisi = 0;
  for (let i = 0; i < islemler.length; i += parcaBoyutu) {
    const batch = db.batch();
    for (const islem of islemler.slice(i, i + parcaBoyutu)) {
      islem(batch);
    }
    await batch.commit();
    commitSayisi++;
  }
  return commitSayisi;
}
