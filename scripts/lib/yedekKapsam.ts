/**
 * Firestore yedekleme kapsamının TEK kaynağı — `firestoreYedekle.ts` (runtime
 * fail-closed keşif, `db.listCollections()`) ve `verify-schema-parity.ts`nin
 * kardeşi `verify-backup-coverage.ts` (offline, firestore.rules metnini
 * tarar) BURADAN import eder. Yeni bir koleksiyon eklerken bu iki listeden
 * birine BİLEREK eklenmeli — aksi halde `firestoreYedekle.ts` `listCollections()`
 * sonucuyla karşılaştırırken bilinmeyen koleksiyonu görüp `process.exit(1)`
 * ile durur (bkz. o dosyanın başındaki gerekçe).
 */

/** Yedeklenecek iş verisi koleksiyonları. */
export const YEDEKLENECEK_KOLEKSIYONLAR = [
  'muezzins',
  'invites',
  'izinler',
  'izin_detaylari',
  'mazeret_detaylari',
  'bildirimler',
  'haftaPlanlari',
  'duyurular',
  'vekalet_talepleri',
  'adminUyarilari',
  'settings',
  'config',
  'audit_logs',
] as const;

/**
 * Bilinçli olarak yedeklenmeyen koleksiyonlar — HER biri için gerekçe:
 * - `error_logs` / `telemetry_logs`: `scripts/temizleGunlukler.ts` ile 30
 *   günde bir zaten silinen, TTL'li teşhis verisi — iş verisi değil, yedeği
 *   kotayı gereksiz tüketir.
 * - `vakitler`: Diyanet API'den `scripts/aylikEzanTakvimiGuncelle.ts` ile
 *   her ay yeniden üretilebilir — kaynak veri harici bir API'de yaşıyor.
 * - `cronDurumu`: yalnızca Admin SDK'nın yazdığı, kısa ömürlü idempotency/
 *   sentinel damgaları (bkz. `yatsiSonuIslemleri.ts`) — kaybolsa bir
 *   sonraki cron koşusunda kendiliğinden yeniden üretilir, firestore.rules'ta
 *   hiç görünmez (istemci hiç erişmez).
 */
export const HARIC_TUTULAN_KOLEKSIYONLAR = ['error_logs', 'telemetry_logs', 'vakitler', 'cronDurumu'] as const;
