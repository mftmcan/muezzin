import { z } from 'zod';

/**
 * Zod, firestore.rules'un YERİNE GEÇMEZ — iki ayrı katman, ikisi de zorunlu:
 *   - Zod (bu dosyalar)  = istemci UX'i. Alan-seviyesi Türkçe hata mesajı,
 *     submit öncesi anında geri bildirim, firestore.rules'un opak
 *     PERMISSION_DENIED'ına düşmeden erken yakalama.
 *   - firestore.rules    = güvenlik sınırı. İstemci atlatılabilir, tek
 *     gerçek zorlayıcı sunucudur.
 * Limitlerin iki taraf arasında sürüklenmesini `scripts/verify-schema-parity.ts`
 * (bkz. `npm run verify:schema-parity`, `test:all` zincirinde) makine ile
 * engeller — bir sayı burada değişirse rules'ta da değişmediği sürece CI
 * kırmızıya döner.
 *
 * Tüm çağrı siteleri şemaları BU barrel'dan import etmeli (alt modüle
 * doğrudan import edilirse aşağıdaki locale kurulumu olmadan parse
 * çalışabilir).
 */
z.config(z.locales.tr());

export { LIMITLER, ROLLER, DUYURU_TIPLERI, IZIN_TIPLERI } from './limitler';
export type { Rol, DuyuruTipi, IzinTipi } from './limitler';
export { alanHatalariniCikar } from './primitives';
export { personelFormSemasi } from './muezzinSemalari';
export type { PersonelFormGirdisi } from './muezzinSemalari';
export { duyuruFormSemasi } from './duyuruSemalari';
export type { DuyuruFormGirdisi } from './duyuruSemalari';
export { sistemAyarlariFormSemasi } from './ayarlarSemalari';
export type { SistemAyarlariFormGirdisi } from './ayarlarSemalari';
export { izinFormSemasiOlustur } from './izinSemalari';
export type { IzinFormGirdisi } from './izinSemalari';
