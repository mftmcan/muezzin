import { db, Timestamp } from './firebaseAdminInit.ts';
import { getTurkeyDateString } from '../../src/lib/dateUtils.ts';

/** `isAdi`den (workflow adı) deterministik bir belge ID'si türetir — bkz.
 * altındaki `raporlaBasarisizlik` yorumu: aynı iş tekrar tekrar başarısız
 * olursa (10 dakikalık cron'larda günde ~288 kez olabilir) her seferinde
 * YENİ bir belge yerine AYNI belge güncellenir. `reportWorkflowSuccess.ts`
 * (başarıda aynı belgeyi otomatik çözen companion script) da AYNI
 * fonksiyonu kullanır — bu yüzden burada export edilir, iki dosyada ayrı
 * ayrı yazılmaz. */
export function slugify(s: string): string {
  return (
    s
      .toLocaleLowerCase('tr-TR')
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '')
      .slice(0, 80) || 'bilinmeyen'
  );
}

export function otomasyonUyarisiDocId(tip: string, isAdi: string): string {
  return `otomasyon_${slugify(tip)}_${slugify(isAdi)}`;
}

/**
 * Bir GitHub Actions cron job'u başarısız olduğunda admin panelinde
 * görünür bir uyarı bırakır (bkz. src/pages/admin/modules/KrizAlarmlari.tsx).
 *
 * Önceden BEŞ farklı cron'un (aylık ezan takvimi, günlük log temizliği,
 * günlük yatsı sonu, haftalık plan, vakit veri sağlığı) hepsi 'apiHatasi'
 * tipiyle raporlanıyordu — bu tip aslında "dış API'ye ulaşılamıyor"
 * anlamına geliyor (bkz. src/pages/admin/modules/KrizAlarmlari.tsx ikon/
 * renk/başlık eşlemesi: 'API BAĞLANTI ARIZASI'), oysa bir GitHub Actions
 * işinin çökmesinin nedeni genelde API'yle ilgisiz (kod hatası, zaman
 * aşımı, kota vb.). Admin panelinde bu beşi diğer gerçek API arızalarından
 * (ör. scripts/vakitVeriSagligiKontrol.ts'in kendi 'apiHatasi' uyarısı)
 * ayırt edilemiyordu (bkz. kod denetimi). Varsayılan tip bu yüzden daha
 * doğru bir kategori: 'otomasyonHatasi'.
 */
export async function raporlaBasarisizlik(isAdi: string, tip = 'otomasyonHatasi'): Promise<void> {
  // Deterministik ID (tip+isAdi) — bkz. yukarıdaki slugify yorumu. Aynı iş
  // tekrar başarısız olursa (10 dakikalık cron'larda sık) `.add()`'in
  // ürettiği gibi her seferinde yeni bir belge değil, AYNI belge
  // güncellenir; admin panelinde onlarca kopya birikmesi önlenir (düşük
  // öncelikli bulgu). İş daha önce çözülmüş (cozuldu:true) ama yeniden
  // başarısız olduysa bu, belgeyi doğru şekilde tekrar açar.
  const docId = otomasyonUyarisiDocId(tip, isAdi);

  await db
    .collection('adminUyarilari')
    .doc(docId)
    .set({
      tip,
      mesaj: `Otomasyon hatası: "${isAdi}" GitHub Actions işi başarısız oldu. Loglara bakın ve gerekirse elle çalıştırın (workflow_dispatch).`,
      tarih: getTurkeyDateString(),
      vakit: null,
      cozuldu: false,
      olusturmaTarihi: Timestamp.now(),
    });

  console.log(`Admin uyarısı oluşturuldu: ${isAdi}`);
}

// `.github/workflows/*.yml` içindeki `if: failure()` adımı basitçe
// `npx tsx scripts/lib/reportWorkflowFailure.ts "<İş Adı>"` çağırabilsin
// diye argümanlar `process.argv`den okunup `raporlaBasarisizlik`e geçirilir.
// Bu blok yalnızca dosya DOĞRUDAN çalıştırıldığında tetiklenir (diğer
// script'lerdeki AYNI desen, bkz. vekaletDevirleriniIsle.ts) — `main()`
// önceden koşulsuzdu, bu dosyayı import eden herhangi bir modül (ör.
// tests/integration/reportWorkflowStatus.test.ts) istemeden "Bilinmeyen İş"
// başarısızlık uyarısı yazardı.
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const isAdi = process.argv[2] || 'Bilinmeyen İş';
  const tip = process.argv[3] || 'otomasyonHatasi';
  raporlaBasarisizlik(isAdi, tip).catch((err) => {
    // Bu script'in kendisi bir "iyi denemedir" (best-effort) — asıl işin
    // başarısızlığını maskelememesi için burada process.exit(1) YAPILMAZ,
    // sadece loglanır.
    console.error('Başarısızlık bildirimi yazılamadı:', err);
  });
}
