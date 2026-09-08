/**
 * `src/lib/validation/limitler.ts`'teki her limitin `firestore.rules`'ta
 * BİREBİR aynı sayıyla geçtiğini metin düzeyinde doğrular — offline, emülatör
 * gerektirmez. Zod (istemci UX) ve firestore.rules (sunucu güvenlik sınırı)
 * ayrı katmanlar olduğundan (bkz. src/lib/validation/index.ts), aralarında
 * elle senkron tutmak yerine bu script sürüklenmeyi (drift) makine ile
 * yakalar: rules'taki bir sayı değişirse ve limitler.ts güncellenmezse
 * `npm run test:all` kırmızıya döner.
 *
 * DİKKAT: bu bir metin eşleştirmesi — firestore.rules'ta ilgili satırın
 * BOŞLUK/format'ı değişirse (ör. Prettier/manuel reformat) bu script
 * yanlış-pozitif verebilir. Assert mesajları bunu açıkça belirtir; öyle bir
 * durumda aşağıdaki `beklenenParcalar` dizisini rules'un YENİ metnine göre
 * güncelle.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITLER, ROLLER, DUYURU_TIPLERI, IZIN_TIPLERI } from '../src/lib/validation/limitler';

type BeklenenParca = {
  aciklama: string;
  parca: string;
};

const beklenenParcalar: BeklenenParca[] = [
  {
    aciklama: `isValidMuezzin: displayName <= ${LIMITLER.muezzinDisplayNameMax}`,
    parca: `data.displayName is string && data.displayName.size() <= ${LIMITLER.muezzinDisplayNameMax}`,
  },
  {
    aciklama: `isValidMuezzin: email <= ${LIMITLER.muezzinEmailMax}`,
    parca: `data.email is string && data.email.size() <= ${LIMITLER.muezzinEmailMax}`,
  },
  {
    aciklama: `isValidMuezzin: yillikIzinKullanilanGun <= ${LIMITLER.yillikIzinMaxGun}`,
    parca: `data.yillikIzinKullanilanGun <= ${LIMITLER.yillikIzinMaxGun}`,
  },
  {
    aciklama: `isValidMuezzin: haftalikIzinGunu ${LIMITLER.haftalikIzinGunuMin}-${LIMITLER.haftalikIzinGunuMax}, != ${LIMITLER.haftalikIzinGunuYasak}`,
    parca: `data.haftalikIzinGunu >= ${LIMITLER.haftalikIzinGunuMin} && data.haftalikIzinGunu <= ${LIMITLER.haftalikIzinGunuMax} && data.haftalikIzinGunu != ${LIMITLER.haftalikIzinGunuYasak}`,
  },
  {
    aciklama: `isValidMuezzin: role in ${JSON.stringify(ROLLER)}`,
    parca: `data.role in ['${ROLLER.join("', '")}']`,
  },
  {
    aciklama: `isValidDuyuru: baslik <= ${LIMITLER.duyuruBaslikMax}`,
    parca: `data.baslik.size() > 0 && data.baslik.size() <= ${LIMITLER.duyuruBaslikMax}`,
  },
  {
    aciklama: `isValidDuyuru: icerik <= ${LIMITLER.duyuruIcerikMax}`,
    parca: `data.icerik.size() > 0 && data.icerik.size() <= ${LIMITLER.duyuruIcerikMax}`,
  },
  {
    aciklama: `isValidDuyuru: yazar <= ${LIMITLER.duyuruYazarMax}`,
    parca: `data.yazar.size() <= ${LIMITLER.duyuruYazarMax}`,
  },
  {
    aciklama: `isValidDuyuru: tip in ${JSON.stringify(DUYURU_TIPLERI)}`,
    parca: `data.tip in ['${DUYURU_TIPLERI.join("', '")}']`,
  },
  {
    aciklama: `isValidSystemSettings: ilceId ${LIMITLER.ilceIdMin}-${LIMITLER.ilceIdMax}`,
    parca: `data.ilceId.size() >= ${LIMITLER.ilceIdMin} && data.ilceId.size() <= ${LIMITLER.ilceIdMax}`,
  },
  {
    aciklama: `isValidSystemSettings: ilceAdi ${LIMITLER.ilceAdiMin}-${LIMITLER.ilceAdiMax}`,
    parca: `data.ilceAdi.size() >= ${LIMITLER.ilceAdiMin} && data.ilceAdi.size() <= ${LIMITLER.ilceAdiMax}`,
  },
  {
    aciklama: `isValidSystemSettings: hicriDuzeltme >= ${LIMITLER.hicriDuzeltmeMin}`,
    parca: `data.hicriDuzeltme >= ${LIMITLER.hicriDuzeltmeMin}`,
  },
  {
    aciklama: `isValidSystemSettings: hicriDuzeltme <= ${LIMITLER.hicriDuzeltmeMax}`,
    parca: `data.hicriDuzeltme <= ${LIMITLER.hicriDuzeltmeMax}`,
  },
  {
    aciklama: `isValidIzin: tip in ${JSON.stringify(IZIN_TIPLERI)}`,
    parca: `data.tip in ['${IZIN_TIPLERI.join("', '")}']`,
  },
];

const rulesIcerik = readFileSync('firestore.rules', 'utf8');

for (const { aciklama, parca } of beklenenParcalar) {
  assert.ok(
    rulesIcerik.includes(parca),
    `Şema senkron sapması: "${aciklama}" — limitler.ts'teki değer firestore.rules'ta beklenen biçimde bulunamadı.\n` +
      `Aranan metin: ${JSON.stringify(parca)}\n` +
      `Ya firestore.rules değişti (limitler.ts'i güncelle) ya da rules'un biçimi değişti ` +
      `(bu script'teki beklenenParcalar'ı güncelle) — bkz. scripts/verify-schema-parity.ts dosya başı yorumu.`
  );
  console.log(`OK ${aciklama}`);
}

console.log(`${beklenenParcalar.length} şema/rules eşleşmesi doğrulandı`);
