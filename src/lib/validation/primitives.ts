import { z } from 'zod';
import { LIMITLER } from './limitler';

/** Boşluk-trimlenmiş, en az 1 karakter, üst sınırlı serbest metin. */
export function trimliMetin(max: number, alanAdi: string) {
  return z.string().trim().min(1, `${alanAdi} zorunludur.`).max(max, `${alanAdi} en fazla ${max} karakter olabilir.`);
}

export const epostaSemasi = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'E-posta zorunludur.')
  .max(LIMITLER.muezzinEmailMax, `E-posta en fazla ${LIMITLER.muezzinEmailMax} karakter olabilir.`)
  .refine((v) => v.includes('@'), 'Geçerli bir e-posta adresi giriniz.');

/** ad/soyad gibi kişi adı alanları — formatName() ile önceden normalize
 * edilmiş girdiyi bekler, burada yalnızca boşluk/uzunluk denetlenir. */
export const turkceAdSemasi = z.string().trim().min(1, 'Bu alan zorunludur.');

/** ZodError'ı FormField'ın beklediği { alanAdi: mesaj } haritasına çevirir.
 * İlk hata her alan için kazanır (FormField tek bir hata mesajı gösterir). */
export function alanHatalariniCikar<T extends Record<string, unknown>>(error: z.ZodError): Partial<Record<keyof T, string>> {
  const hatalar: Partial<Record<keyof T, string>> = {};
  for (const issue of error.issues) {
    const alan = issue.path[0] as keyof T | undefined;
    if (alan !== undefined && !(alan in hatalar)) {
      hatalar[alan] = issue.message;
    }
  }
  return hatalar;
}
