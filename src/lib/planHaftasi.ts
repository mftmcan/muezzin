/**
 * Haftalık plan üretiminin (src/services/planServisi.ts) SAF (yan etkisiz,
 * Firestore'dan bağımsız) yardımcıları.
 *
 * Bu fonksiyonlar önceden `planServisi.ts` içinde dosya-yerel tanımlıydı ve
 * bu yüzden birim testlenemiyordu — oysa ikisi doğrudan riskli davranış
 * taşıyor:
 *  - `haftaGunleri`, `mazeretSonBasvuru` damgasının HANGİ günlere yazılacağını
 *    belirler (ay/yıl/artık-yıl sınırları),
 *  - `bildirimlerParmakIzi`, "mazeret reddini sessizce ezen" bir yarış
 *    koşulunun kök-neden çözümü olan iyimser eşzamanlılık denetiminin ikinci
 *    yarısıdır.
 *
 * Aynı gerekçeyle daha önce `src/lib/planSelfHealing.ts` ve
 * `src/lib/slotKorumasi.ts` çıkarılmıştı; bu dosya o deseni sürdürür.
 *
 * KATMAN KURALI: burada Firestore tiplerine (`QueryDocumentSnapshot` vb.) ya
 * da `src/services/*`'e bağımlılık YOKTUR — belgeler yalnızca ihtiyaç duyulan
 * alanları tarif eden minimal, YAPISAL (structural) arayüzlerle alınır.
 * Böylece gerçek snapshot'lar da, testlerdeki sahte düz objeler de aynı
 * imzaya uyar.
 */
import { SlotBildirimVerisi } from './slotKorumasi';

/** `bildirimlerParmakIzi`'nin bir belgeden ihtiyaç duyduğu tek şey. */
export interface ParmakIziBelgesi {
  id: string;
  data(): { sonGuncelleme?: { toMillis(): number } | null };
}

/** `bildirimleriSlotlaraAyir`'ın bir belgeden ihtiyaç duyduğu tek şey. */
export interface SlotAnahtarliBelge {
  data(): { tarih?: string; vakit?: string };
}

/** `slotVerileri`'nin bir belgeden ihtiyaç duyduğu tek şey. */
export interface SlotVeriBelgesi {
  data(): SlotBildirimVerisi | undefined;
}

/**
 * Bir haftaId'den (`W-YYYY-MM-DD`, Pazartesi başlangıçlı) o haftanın 7 gününü
 * `YYYY-MM-DD` dizisi olarak üretir.
 *
 * `Date.setDate` taşmayı kendisi yönetir (ay/yıl/artık-yıl sınırları) ve
 * tarihler YEREL saat diliminde kurulduğundan gün kayması yaşanmaz.
 */
export function haftaGunleri(haftaId: string) {
  const startStr = haftaId.substring(1);
  const [year, month, day] = startStr.split('-').map(Number);
  const pazartesi = new Date(year, month - 1, day);

  return Array.from({ length: 7 }, (_, index) => {
    const gun = new Date(pazartesi);
    gun.setDate(pazartesi.getDate() + index);
    const y = gun.getFullYear();
    const m = String(gun.getMonth() + 1).padStart(2, '0');
    const d = String(gun.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
}

// İyimser eşzamanlılık denetiminin (haftalikPlanOlusturTekSeferlik) tek
// başına haftaPlanlari.sonGuncelleme'yi karşılaştırması yeterli değildi —
// mazeretBildir/vekaletKabulEt kendi bildirimler yazımlarını YALNIZCA o
// belgede yapar, haftaPlanlari'na hiç dokunmaz (bunu yalnızca ayrı,
// asenkron bir uzlaştırma cron'u — mazeretDevirleriniIsle.ts/
// vekaletDevirleriniIsle.ts — daha sonra yapar). Bu yüzden eskiBildirimler
// okunduktan (T1) SONRA ama commit'ten (T2) ÖNCE bir müezzin mazeret
// bildirirse, haftaPlanlari.sonGuncelleme değişmediğinden freshness
// kontrolü çakışmayı hiç görmüyor, ve commit T1'deki BAYAT bildirim
// durumuna göre hesaplanmış bir plan yazıp mazeretin az önce güncellediği
// bildirim belgesini (delete+set ile) sessizce üzerine yazıyordu — mazeret
// reddi ve varsa yedek terfisi kayboluyordu (bkz. code-review, dördüncü
// denetim turu). Bu parmak izi haftaPlanlari.sonGuncelleme kontrolüne EK
// olarak bildirimler koleksiyonunun da T1-T2 arasında değişmediğini
// doğrular.
export function bildirimlerParmakIzi(docs: ParmakIziBelgesi[]): string {
  return docs
    .map((d) => `${d.id}:${d.data().sonGuncelleme?.toMillis() ?? 'null'}`)
    .sort()
    .join('|');
}

/** Belgeleri `tarih_vakit` slot anahtarına göre gruplar. */
export function bildirimleriSlotlaraAyir<T extends SlotAnahtarliBelge>(docs: T[]) {
  return docs.reduce(
    (acc, bildirimDoc) => {
      const data = bildirimDoc.data();
      const key = `${data.tarih}_${data.vakit}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(bildirimDoc);
      return acc;
    },
    {} as Record<string, T[]>
  );
}

/**
 * Belgelerin düz verisini çıkarır; var olmayan belgelerin (`data()`
 * `undefined` döner) sonucu elenir.
 */
export function slotVerileri(slotBildirimleri: SlotVeriBelgesi[]): SlotBildirimVerisi[] {
  return slotBildirimleri.map((bildirimDoc) => bildirimDoc.data()).filter((data): data is SlotBildirimVerisi => !!data);
}
