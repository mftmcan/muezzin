import { db, Timestamp } from './lib/firebaseAdminInit.ts';
import { EzanVakitOkuyucu } from './lib/ezanVakitleri.ts';
import { getTurkeyDateString, getTurkeyNow } from '../src/lib/dateUtils.ts';
import type { Vakit } from '../src/types';

/**
 * `bildirimler.mazeretSonBasvuru` uzlaştırma (reconciliation) işi.
 *
 * NEDEN VAR: 1 saatlik mazeret/vekalet penceresi artık sunucu tarafında,
 * bildirim belgesine önceden yazılan bu damga ile uygulanıyor (bkz.
 * firestore.rules `mazeretPenceresiAcik` — mimari gerekçe orada). Kural
 * FAIL-CLOSED'dır: damga yoksa mazeret/vekalet reddedilir. Damganın eksik
 * kalabileceği üç meşru durum var:
 *  1. Bu özellik devreye alınmadan ÖNCE oluşturulmuş bildirimler.
 *  2. scripts/haftalikPlanOlustur.ts 3 hafta ileriye plan üretir; o günlerin
 *     ayına ait `vakitler` belgesi henüz yazılmamış olabilir (aylık cron ayın
 *     28'inde çalışır) — plan üretimi sırasında damga hesaplanamaz.
 *  3. `vakitler` verisi sonradan düzeltilir/yeniden çekilirse (bkz.
 *     scripts/vakitVeriSagligiKontrol.ts) ezan saati değişebilir.
 * Bu iş, mazeret/vekalet uzlaştırma cron'uyla (10 dakikada bir) birlikte
 * çalışır ve GELECEKTEKİ günlere ait bildirimlerin damgasını tamamlar/günceller.
 *
 * GÜVENLİK NOTU: damga yalnızca güvenilir Admin SDK bağlamında, doğrulanmış
 * (`normalizeVakitSaati`) ezan verisinden hesaplanır — istemciden gelen hiçbir
 * değer kullanılmaz. Ezan verisi okunamıyorsa alan YAZILMAZ ve mevcut değer de
 * DEĞİŞTİRİLMEZ (bozuk veri, çalışan bir damgayı silip meşru kullanıcıları
 * kilitlememelidir); bu durum konsola uyarı olarak düşer.
 */

type BildirimVeri = {
  tarih?: string;
  vakit?: string;
  tip?: string;
  mazeretSonBasvuru?: FirebaseFirestore.Timestamp;
};

const VAKITLER: Vakit[] = ['sabah', 'ogle', 'ikindi', 'aksam', 'yatsi'];

export async function backfillMazeretPenceresi(dryRun = false) {
  const okuyucu = new EzanVakitOkuyucu();
  const bugun = getTurkeyDateString(getTurkeyNow());

  // Yalnızca BUGÜN ve sonrası: geçmiş bir görevin penceresi zaten kapalıdır,
  // damgayı geriye dönük yazmanın hiçbir etkisi olmaz (ve gereksiz okuma/yazma
  // kotası harcar — bkz. scripts/vekaletDevirleriniIsle.ts'teki aynı gerekçeli
  // 30 günlük pencere).
  const snapshot = await db.collection('bildirimler').where('tarih', '>=', bugun).get();

  let yazilan = 0;
  let atlanan = 0;
  let veriYok = 0;

  let batch = db.batch();
  let batchAdet = 0;

  for (const docSnap of snapshot.docs) {
    const veri = docSnap.data() as BildirimVeri;
    if (typeof veri.tarih !== 'string' || !VAKITLER.includes(veri.vakit as Vakit)) {
      atlanan++;
      continue;
    }

    const sonBasvuru = await okuyucu.mazeretSonBasvuru(veri.tarih, veri.vakit as Vakit);
    if (!sonBasvuru) {
      veriYok++;
      continue;
    }

    // Zaten doğru değerdeyse yazma (her 10 dakikada bir tüm gelecek
    // bildirimleri yeniden yazmak Spark yazma kotasını boşa harcar).
    const mevcut = veri.mazeretSonBasvuru;
    if (mevcut && typeof mevcut.toMillis === 'function' && mevcut.toMillis() === sonBasvuru.getTime()) {
      atlanan++;
      continue;
    }

    yazilan++;
    if (dryRun) continue;

    batch.update(docSnap.ref, { mazeretSonBasvuru: Timestamp.fromDate(sonBasvuru) });
    batchAdet++;
    if (batchAdet >= 400) {
      await batch.commit();
      batch = db.batch();
      batchAdet = 0;
    }
  }

  if (!dryRun && batchAdet > 0) await batch.commit();

  if (veriYok > 0) {
    console.warn(`${veriYok} bildirim için ezan verisi okunamadı/bozuk — mazeret penceresi o slotlarda KAPALI kalıyor (fail-closed).`);
  }
  console.log(
    `mazeretSonBasvuru uzlaştırması tamamlandı${dryRun ? ' (dry-run)' : ''}. yazilan=${yazilan}, atlanan=${atlanan}, veriYok=${veriYok}`
  );
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const isDryRun = process.argv.includes('--dry-run');
  backfillMazeretPenceresi(isDryRun).catch((err) => {
    console.error('mazeretSonBasvuru uzlaştırması başarısız:', err);
    process.exit(1);
  });
}
