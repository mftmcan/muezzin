import { db } from './firebaseAdminInit.ts';
import { ezanAniUtc, normalizeVakitSaati, oncekiGunTarihi } from '../../src/lib/dateUtils.ts';
import { mazeretSonBasvuruHesapla } from '../../src/lib/mazeretKurallari.ts';
import type { Vakit } from '../../src/types';

/**
 * `vakitler` koleksiyonunun Admin SDK tarafındaki TEK okuma noktası.
 *
 * Önceden bu mantık scripts/vekaletDevirleriniIsle.ts içinde (`ezanSaatiniGetir`)
 * ve src/services/mazeretServisi.ts içinde (`getEzanVakti`) BİRBİRİNDEN BAĞIMSIZ
 * iki kopya halinde yaşıyordu ve ikisi farklı doğrulama yapıyordu: cron KATI bir
 * `/^\d{2}:\d{2}$/` uyguluyor, istemci HİÇ doğrulamıyordu. Bu asimetri, `"9:05"`
 * gibi tek haneli saatli bir kaydın istemcide pencereyi kapatırken cron'da
 * `null` → "ezan geçmedi" (FAIL-OPEN) sayılmasına yol açıyordu (bkz.
 * src/lib/dateUtils.ts `normalizeVakitSaati` yorumu). Artık her iki taraf da
 * AYNI `normalizeVakitSaati` + `ezanAniUtc` çiftinden geçiyor.
 *
 * Okunan ay belgeleri örnek başına önbelleklenir — `haftalikPlanOlustur.ts` ve
 * `mazeretPenceresiBackfill.ts` yüzlerce (tarih, vakit) çifti için sorar,
 * aksi halde her biri ayrı bir Firestore okuması olurdu (Spark kotası).
 */
export class EzanVakitOkuyucu {
  private ilceIdPromise: Promise<string> | null = null;
  private ayCache = new Map<string, Promise<Record<string, Record<string, unknown>> | null>>();

  private ilceIdGetir(): Promise<string> {
    if (!this.ilceIdPromise) {
      this.ilceIdPromise = db
        .collection('settings')
        .doc('system')
        .get()
        .then((snap) => (snap.data()?.ilceId as string) || '9148');
    }
    return this.ilceIdPromise;
  }

  private async ayGunleriGetir(ay: string): Promise<Record<string, Record<string, unknown>> | null> {
    const ilceId = await this.ilceIdGetir();
    const docId = `${ilceId}_${ay}`;
    if (!this.ayCache.has(docId)) {
      this.ayCache.set(
        docId,
        db
          .collection('vakitler')
          .doc(docId)
          .get()
          .then((snap) => {
            if (!snap.exists) return null;
            const gunler = snap.data()?.gunler;
            return gunler && typeof gunler === 'object' ? (gunler as Record<string, Record<string, unknown>>) : null;
          })
      );
    }
    return this.ayCache.get(docId)!;
  }

  /** Ham (doğrulanmamış) saat değerini döner — normalize etmez. */
  async hamSaat(tarih: string, vakit: string): Promise<unknown> {
    if (typeof tarih !== 'string' || tarih.length < 7) return null;
    const gunler = await this.ayGunleriGetir(tarih.slice(0, 7));
    return gunler?.[tarih]?.[vakit] ?? null;
  }

  /** Normalize edilmiş "HH:MM"; bozuk/eksikse `null`. */
  async saat(tarih: string, vakit: string): Promise<string | null> {
    return normalizeVakitSaati(await this.hamSaat(tarih, vakit));
  }

  /**
   * O vaktin ezanının GERÇEK UTC anı (runner'ın saat diliminden bağımsız —
   * Türkiye sabit UTC+3). Veri yoksa/bozuksa `null`.
   */
  async ezanAni(tarih: string, vakit: string): Promise<Date | null> {
    return ezanAniUtc(tarih, await this.hamSaat(tarih, vakit));
  }

  /**
   * `bildirimler.mazeretSonBasvuru` alanına yazılacak son başvuru anı —
   * mazeret/vekalet penceresinin KAPANDIĞI gerçek UTC anı. Sabah vakti için
   * bir önceki günün (gerekirse önceki AYIN) yatsısını okur.
   */
  async mazeretSonBasvuru(tarih: string, vakit: Vakit): Promise<Date | null> {
    if (vakit === 'sabah') {
      const oncekiGun = oncekiGunTarihi(tarih);
      if (!oncekiGun) return null;
      return mazeretSonBasvuruHesapla(tarih, vakit, null, await this.hamSaat(oncekiGun, 'yatsi'));
    }
    return mazeretSonBasvuruHesapla(tarih, vakit, await this.hamSaat(tarih, vakit), null);
  }
}
