import { z } from 'zod';
import { IZIN_TIPLERI, LIMITLER } from './limitler';
import { trimliMetin } from './primitives';
import { getTurkeyDateString, isFriday, izinGunSayisi } from '../dateUtils';

const tarihSemasi = z.string().min(1, 'Bu alan zorunludur.');

/** VacationRequestCard.tsx'in izin talebi formu — firestore.rules
 * isValidIzin + isValidIzinTarihAraligi (satır 1072+) ile eşlenir. Cuma
 * içeren aralık reddi burada da (sunucudaki Hinnant takvim formülüyle
 * MATEMATİKSEL OLARAK AYNI sonucu üreten) `isFriday` gün-gün taramasıyla
 * yapılır — iki taraf ayrı algoritma kullanıyor olsa da aynı kümeyi
 * (aralıktaki herhangi bir Cuma) reddeder.
 *
 * `yillikKalanKota`, çağıranın (kullanıcıya özgü, gerçek zamanlı) state'i
 * olduğu için sabit bir şema değil, bir fabrika fonksiyonudur. */
export function izinFormSemasiOlustur(yillikKalanKota: number) {
  return z
    .object({
      baslangic: tarihSemasi,
      bitis: tarihSemasi,
      tip: z.enum(IZIN_TIPLERI, { error: 'Geçerli bir muafiyet türü seçin.' }),
      sebep: trimliMetin(LIMITLER.izinSebepMax, 'Gerekçe'),
    })
    .refine((data) => new Date(data.baslangic) >= new Date(getTurkeyDateString()), {
      message: 'Başlangıç tarihi bugünden önce olamaz.',
      path: ['baslangic'],
    })
    .refine((data) => new Date(data.bitis) >= new Date(data.baslangic), {
      message: 'Bitiş tarihi başlangıç tarihinden önce olamaz.',
      path: ['bitis'],
    })
    .superRefine((data, ctx) => {
      if (data.tip !== 'yillik') return;
      const talepGunSayisi = izinGunSayisi(data.baslangic, data.bitis);
      if (talepGunSayisi > yillikKalanKota) {
        ctx.addIssue({
          code: 'custom',
          message: `Bu talep (${talepGunSayisi} gün) kalan yıllık izin kotanızı (${yillikKalanKota} gün) aşıyor.`,
          path: ['bitis'],
        });
      }
    })
    .refine(
      (data) => {
        const start = new Date(data.baslangic);
        const end = new Date(data.bitis);
        if (end < start) return true; // önceki refine zaten yakaladı, çift hata verme
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          if (isFriday(d)) return false;
        }
        return true;
      },
      {
        message: 'Cuma günü, haftalık mihrap koordinasyonunun aksamaması adına izin kapsamına alınamaz.',
        path: ['bitis'],
      }
    );
}

export type IzinFormGirdisi = z.infer<ReturnType<typeof izinFormSemasiOlustur>>;
