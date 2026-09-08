import { z } from 'zod';
import { LIMITLER } from './limitler';

/** SistemAyarlari.tsx form alanları — firestore.rules isValidSystemSettings
 * (satır 1003+) ile eşlenir. `hicriDuzeltme` formda serbest metin/number
 * input'undan geldiği için Number()'a çevrilmiş haliyle parse edilir. */
export const sistemAyarlariFormSemasi = z.object({
  ilceId: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Diyanet ilçe kodu yalnızca rakamlardan oluşmalıdır.')
    .min(LIMITLER.ilceIdMin, 'Diyanet ilçe kodu geçerli uzunlukta olmalıdır.')
    .max(LIMITLER.ilceIdMax, 'Diyanet ilçe kodu geçerli uzunlukta olmalıdır.'),
  ilceAdi: z
    .string()
    .trim()
    .min(LIMITLER.ilceAdiMin, 'İlçe tanımı 2-80 karakter arasında olmalıdır.')
    .max(LIMITLER.ilceAdiMax, 'İlçe tanımı 2-80 karakter arasında olmalıdır.'),
  hicriDuzeltme: z
    .number()
    .int('Hicri tarih düzeltmesi tam sayı olmalıdır.')
    .min(LIMITLER.hicriDuzeltmeMin, 'Hicri tarih düzeltmesi -2 ile +2 gün arasında olmalıdır.')
    .max(LIMITLER.hicriDuzeltmeMax, 'Hicri tarih düzeltmesi -2 ile +2 gün arasında olmalıdır.'),
});

export type SistemAyarlariFormGirdisi = z.input<typeof sistemAyarlariFormSemasi>;
