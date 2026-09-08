import { z } from 'zod';
import { DUYURU_TIPLERI, LIMITLER } from './limitler';
import { trimliMetin } from './primitives';

/** DuyuruYonetimi.tsx formData şekli — firestore.rules isValidDuyuru
 * (satır 119+) ile eşlenir. `tarih`/`yazar`/`bildirimGonderildi` sunucu
 * tarafında (writeDoc anında/Admin SDK ile) eklenir, formda yok. */
export const duyuruFormSemasi = z.object({
  baslik: trimliMetin(LIMITLER.duyuruBaslikMax, 'Başlık'),
  icerik: trimliMetin(LIMITLER.duyuruIcerikMax, 'İçerik'),
  tip: z.enum(DUYURU_TIPLERI, { error: 'Geçerli bir duyuru türü seçin.' }),
});

export type DuyuruFormGirdisi = z.input<typeof duyuruFormSemasi>;
