/**
 * `firestore.rules`'taki her top-level koleksiyonun (client'ın eriştiği,
 * `match /X/{...}` ile tanımlı) `scripts/lib/yedekKapsam.ts`'teki beyaz∪kara
 * listede olduğunu doğrular — offline, emülatör gerektirmez.
 *
 * `scripts/verify-schema-parity.ts` (Zod↔rules senkronu) ile AYNI felsefe:
 * yeni bir koleksiyon `firestore.rules`'a eklenip yedek kapsamına
 * (bilinçli dahil VEYA bilinçli hariç) eklenmezse, bu script `npm run
 * test:all`'ı kırmızıya çevirir — sessizce "yedeksiz kalan" bir koleksiyon
 * imkansız hâle gelir.
 *
 * NOT: `cronDurumu` gibi yalnızca Admin SDK'nın yazdığı (firestore.rules'ta
 * HİÇ görünmeyen) koleksiyonlar bu script'in kapsamı DIŞINDA — onların
 * gerçek güvenlik ağı `firestoreYedekle.ts`'teki RUNTIME `db.listCollections()`
 * karşılaştırmasıdır (bkz. o dosyanın başındaki gerekçe).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { YEDEKLENECEK_KOLEKSIYONLAR, HARIC_TUTULAN_KOLEKSIYONLAR } from './lib/yedekKapsam.ts';

const kapsamdakiKoleksiyonlar = new Set<string>([...YEDEKLENECEK_KOLEKSIYONLAR, ...HARIC_TUTULAN_KOLEKSIYONLAR]);

const rulesIcerik = readFileSync('firestore.rules', 'utf8');

// Yalnızca TOP-LEVEL match bloklarını yakalar (4 boşluk girinti — nested
// match'ler, ör. subcollection'lar, bu projede kullanılmıyor ama ileride
// eklenirse bu regex'in kapsam dışı kalacağı NOT edilir).
const eslesmeler = [...rulesIcerik.matchAll(/^ {4}match \/([a-zA-Z_]+)\/\{/gm)];
const rulesKoleksiyonlari = new Set(eslesmeler.map((m) => m[1]!));

assert.ok(rulesKoleksiyonlari.size > 0, 'firestore.rules içinde hiç top-level koleksiyon bulunamadı — regex bozulmuş olabilir.');

const eksikler = [...rulesKoleksiyonlari].filter((koleksiyon) => !kapsamdakiKoleksiyonlar.has(koleksiyon));

assert.deepEqual(
  eksikler,
  [],
  `Yedekleme kapsam sapması: firestore.rules'ta olup scripts/lib/yedekKapsam.ts'te (ne YEDEKLENECEK_KOLEKSIYONLAR ne ` +
    `HARIC_TUTULAN_KOLEKSIYONLAR) yer almayan koleksiyon(lar): ${eksikler.join(', ')}. ` +
    `Yeni koleksiyonu bilinçli olarak listelerden birine ekleyin (gerekçesiyle).`
);

console.log(`${rulesKoleksiyonlari.size} rules koleksiyonunun tümü yedekleme kapsamında (yedeklenen veya bilinçli hariç).`);
