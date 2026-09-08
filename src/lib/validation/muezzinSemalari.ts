import { z } from 'zod';
import { LIMITLER, ROLLER } from './limitler';
import { epostaSemasi, turkceAdSemasi } from './primitives';

/** PersonelFormModal.tsx'in gönderdiği ham alanlar — firestore.rules
 * isValidMuezzin (satır 158+) ile eşlenir. `ad`+`soyad` sunucuda tek bir
 * `displayName` alanına birleşiyor, o yüzden birleşik uzunluk burada da
 * (refine ile) denetlenir. */
export const personelFormSemasi = z
  .object({
    email: epostaSemasi,
    ad: turkceAdSemasi,
    soyad: turkceAdSemasi,
    role: z.enum(ROLLER, { error: 'Geçerli bir yetki seviyesi seçin.' }),
    haftalikIzinGunu: z
      .number()
      .int()
      .min(LIMITLER.haftalikIzinGunuMin)
      .max(LIMITLER.haftalikIzinGunuMax)
      .refine((v) => v !== LIMITLER.haftalikIzinGunuYasak, {
        message:
          'Cuma artık haftalık izin günü olarak seçilemiyor — planlama çekirdeği Cuma vakitlerini ayrı bir kurala göre yönetiyor. Başka bir gün seçin (ya da İZİNSİZ).',
      }),
  })
  .refine((data) => `${data.ad} ${data.soyad}`.trim().length <= LIMITLER.muezzinDisplayNameMax, {
    message: `Ad soyad birleşimi en fazla ${LIMITLER.muezzinDisplayNameMax} karakter olabilir.`,
    path: ['soyad'],
  });

export type PersonelFormGirdisi = z.input<typeof personelFormSemasi>;
