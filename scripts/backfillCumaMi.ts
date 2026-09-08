import { db } from './lib/firebaseAdminInit.ts';
import { isFriday } from '../src/lib/dateUtils.ts';

/**
 * Tek seferlik backfill: `cumaMi` alanı 04.08.2026'da (a30cf13) eklendi ve
 * bu iş yazılana kadar geriye dönük dolduran bir script yoktu — bu tarihten
 * önce üretilmiş `bildirimler` belgelerinde alan hiç yok. firestore.rules
 * bu alanın eksikliğini bilinçli olarak "kısıtlama yok" (fail-open) sayıyor
 * (bkz. `!data.keys().hasAny(['cumaMi']) || ...`), yani alan eksik olduğu
 * sürece o belgedeki Cuma kısıtlaması (mazeret/vekalet) sunucu tarafında
 * hiç uygulanmıyor — bkz. mimari denetim K3.
 *
 * Bu script `cumaMi` alanı OLMAYAN her bildirim belgesini `tarih`inden
 * türeterek doldurur. İdempotent'tir (zaten alanı olan belgelere dokunmaz).
 *
 * KULLANIM — bilinçli olarak npm run script'lerine EKLENMEDİ ve otomatik
 * çalıştırılmadı: prod veriyi kalıcı olarak değiştirir, admin SDK gerektirir.
 * Önce mutlaka kuru çalıştırma (dry-run, varsayılan) ile kaç belge
 * etkileneceğini gözden geçirin:
 *
 *   npx tsx scripts/backfillCumaMi.ts            # yalnızca rapor, yazmaz
 *   npx tsx scripts/backfillCumaMi.ts --apply     # gerçekten yazar
 */
async function main() {
  const apply = process.argv.includes('--apply');
  console.log(
    apply ? 'UYGULAMA MODU — belgeler yazılacak.' : 'KURU ÇALIŞTIRMA — hiçbir şey yazılmayacak (--apply ile gerçek çalıştırma yapın).'
  );

  const snapshot = await db.collection('bildirimler').get();

  let eksikOlan = 0;
  let cumaOlarakIsaretlenen = 0;
  let batch = db.batch();
  let batchSayaci = 0;
  const BATCH_LIMIT = 400;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    if (Object.prototype.hasOwnProperty.call(data, 'cumaMi')) continue;

    const tarih = data.tarih as string | undefined;
    if (!tarih || tarih.length !== 10) {
      console.warn(`[atlandi] ${docSnap.id}: gecersiz/eksik tarih alani ("${tarih}")`);
      continue;
    }

    eksikOlan++;
    const [y, m, d] = tarih.split('-').map(Number);
    const cumaMi = isFriday(new Date(y, m - 1, d));
    if (cumaMi) cumaOlarakIsaretlenen++;

    if (apply) {
      batch.update(docSnap.ref, { cumaMi });
      batchSayaci++;
      if (batchSayaci >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        batchSayaci = 0;
      }
    }
  }

  if (apply && batchSayaci > 0) {
    await batch.commit();
  }

  console.log(`Toplam belge: ${snapshot.size}`);
  console.log(`cumaMi eksik olan: ${eksikOlan}`);
  console.log(`  -> Cuma olarak isaretlenecek/isaretlenen: ${cumaOlarakIsaretlenen}`);
  console.log(`  -> Cuma degil olarak isaretlenecek/isaretlenen: ${eksikOlan - cumaOlarakIsaretlenen}`);
  if (!apply && eksikOlan > 0) {
    console.log('\nGercek yazim icin: npx tsx scripts/backfillCumaMi.ts --apply');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill basarisiz:', err);
    process.exit(1);
  });
