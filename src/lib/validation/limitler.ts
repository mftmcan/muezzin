/**
 * Zod şemalarının kullandığı tüm sayısal/enum limitlerin TEK kaynağı.
 *
 * Bu dosyadaki her değer, `firestore.rules`'taki karşılığıyla birebir
 * eşleşmek ZORUNDA — sunucu (rules) gerçek güvenlik sınırıdır, buradaki
 * Zod şemaları yalnızca istemci UX'i sağlar (bkz. src/lib/validation/index.ts
 * başındaki not). Senkronu elle değil `scripts/verify-schema-parity.ts`
 * ile makine denetler: `npm run test:all` bu dosyadaki bir sayı
 * `firestore.rules`'takiyle uyuşmazsa kırmızıya döner.
 *
 * Bir limit değiştiğinde: burada + firestore.rules'ta AYNI ANDA güncelle,
 * sonra `npm run verify:schema-parity` ile doğrula.
 */
export const LIMITLER = {
  // firestore.rules isValidMuezzin
  muezzinDisplayNameMax: 100, // data.displayName.size() <= 100
  muezzinEmailMax: 100, // data.email.size() <= 100
  yillikIzinMaxGun: 30, // data.yillikIzinKullanilanGun <= 30
  haftalikIzinGunuMin: 0,
  haftalikIzinGunuMax: 7,
  haftalikIzinGunuYasak: 5, // Cuma — data.haftalikIzinGunu != 5

  // firestore.rules isValidDuyuru
  duyuruBaslikMax: 200, // data.baslik.size() <= 200
  duyuruIcerikMax: 5000, // data.icerik.size() <= 5000
  duyuruYazarMax: 100, // data.yazar.size() <= 100

  // firestore.rules isValidSystemSettings
  ilceIdMin: 3,
  ilceIdMax: 8,
  ilceAdiMin: 2,
  ilceAdiMax: 80,
  hicriDuzeltmeMin: -2,
  hicriDuzeltmeMax: 2,

  // firestore.rules isValidIzin / isValidIzinDetay — sebep izin_detaylari'na
  // taşındı, rules'ta serbest metin sınırı yok; UI'daki mevcut
  // textarea maxLength (VacationRequestCard.tsx) ile eşleşir.
  izinSebepMax: 1000,
} as const;

export const ROLLER = ['admin', 'muezzin', 'gozlemci'] as const;
export type Rol = (typeof ROLLER)[number];

export const DUYURU_TIPLERI = ['onemli', 'bilgi', 'duyuru'] as const;
export type DuyuruTipi = (typeof DUYURU_TIPLERI)[number];

export const IZIN_TIPLERI = ['haftalik', 'yillik', 'mazeret'] as const;
export type IzinTipi = (typeof IZIN_TIPLERI)[number];
