import type { DocumentReference, Timestamp } from 'firebase-admin/firestore';
import { FieldValue } from './firebaseAdminInit.ts';
import { parcaliBatchUygula, type BatchIslemi } from './firestoreBatch.ts';

/**
 * "Gönderim başladı" damgasının alan adı. `bildirimGonderildi` ile AYNI
 * belgede (duyurular / izinler) yaşar ve onunla birlikte okunur.
 */
export const GONDERIM_CLAIM_ALANI = 'bildirimGonderimBaslangici';

/**
 * Bir "gönderiliyor" damgasının artık ölü bir sürece ait sayılacağı süre.
 *
 * `.github/workflows/bildirim-gonder.yml` her 10 dakikada bir çalışır ve
 * job'un `timeout-minutes: 5` tavanı vardır; workflow ayrıca bir
 * `concurrency` grubunda olduğundan iki koşu üst üste binemez. Dolayısıyla
 * 15 dakikadan eski bir damga, damgayı yazan sürecin ARTIK YAŞAMADIĞINI
 * (crash / iptal / runner ölümü) kesin olarak gösterir: canlı bir koşu
 * en fazla 5 dakika yaşayabilir. Eşiği job timeout'undan büyük tutmak bu
 * mekanizmanın tek doğruluk koşuludur — timeout artırılırsa bu değer de
 * artırılmalı.
 */
export const GONDERIM_CLAIM_BAYATLAMA_MS = 15 * 60 * 1000;

/**
 * "Bu kayıt yeniden gönderilebilir mi?" kararının SAF fonksiyonu.
 *
 * KÖK NEDEN (çift push bildirimi): `duyuruBildirimGonder.ts` /
 * `izinDurumBildirimGonder.ts` önce FCM push'unu gönderiyor, SONRA
 * `bildirimGonderildi: true` bayrağını commit ediyordu. Süreç ikisinin
 * ARASINDA ölürse (runner iptali, `timeout-minutes` aşımı, OOM) bayrak hiç
 * kalıcılaşmıyor ve 10 dakika sonraki koşu aynı bildirimi TÜM cihazlara
 * yeniden gönderiyordu — üstelik her koşuda tekrar, süresiz.
 *
 * Ters sıra ("önce işaretle, sonra gönder") aynı pencerede TERS hatayı
 * üretirdi: bildirim "gönderildi" sayılır ama hiç ulaşmaz. FCM'in
 * `sendEach` API'si bir idempotency anahtarı KABUL ETMEDİĞİNDEN (mesaj
 * kimliği yalnızca yanıtta döner, istekte verilemez) tekilliği sunucu
 * tarafında sağlamak da mümkün değil.
 *
 * Bu yüzden iki fazlı bir "claim" kullanılır:
 *   1. FAZ (claim)  — işlenecek her belgeye `bildirimGonderimBaslangici`
 *                     damgası yazılır ve commit edilir.
 *   2. FAZ (send)   — FCM gönderimi yapılır.
 *   3. FAZ (mark)   — `bildirimGonderildi: true` yazılır, damga silinir.
 *
 * Herhangi iki faz arasındaki bir çökme, belgeyi "taze damgalı" bırakır;
 * sonraki koşu onu ATLAR. Böylece 10 dakikalık ritimde sonsuza kadar
 * tekrarlanan gönderim, damga bayatlayana kadar (en fazla bir kez, 15
 * dakikada) tekrarlanan bir gönderime iner — "hiç ulaşmadı" ile "iki kez
 * ulaştı" arasındaki gerçekten belirsiz durum için doğru olan davranış
 * budur (at-least-once, sınırlı tekrar).
 *
 * @param claim   Belgedeki damga alanının okunmuş hâli (Timestamp | yok).
 * @param simdiMs Karar anı (`Date.now()`).
 * @returns `true` ise kayıt (yeniden) gönderilebilir.
 */
export function gonderimClaimBayatMi(claim: unknown, simdiMs: number, esikMs: number = GONDERIM_CLAIM_BAYATLAMA_MS): boolean {
  // Damga hiç yok (normal durum: kayıt henüz hiç işlenmedi) ya da beklenen
  // tipte değil (bozuk/elle yazılmış veri) → işlenebilir.
  if (!claim || typeof (claim as Timestamp).toMillis !== 'function') return true;

  const claimMs = (claim as Timestamp).toMillis();
  if (!Number.isFinite(claimMs)) return true;

  // GELECEKTEKİ bir damga da bayat sayılır. `izinler` şemasında bu alan
  // (bkz. firestore.rules `isValidIzin` hasOnly'si — alan orada listelenmek
  // ZORUNDA, aksi halde damgayı taşıyan bir belgeye yapılan her istemci
  // güncellemesi kalıcı olarak reddedilirdi) istemcinin de yazabileceği bir
  // alandır; ileri tarihli bir damga aksi halde o kaydın bildirimini
  // SÜRESİZ bloke eden bir kilit olurdu.
  return !(claimMs <= simdiMs && simdiMs - claimMs < esikMs);
}

/**
 * 1. FAZ: verilen belgelere "gönderiliyor" damgasını yazar (500'lük batch
 * tavanına takılmadan). Damga tek bir `Timestamp` değeriyle yazılır ki bir
 * koşunun tüm kayıtları AYNI anda bayatlasın.
 */
export async function gonderimClaimYaz(refler: DocumentReference[], damga: Timestamp): Promise<void> {
  await parcaliBatchUygula(
    refler.map<BatchIslemi>((ref) => (batch) => {
      batch.update(ref, { [GONDERIM_CLAIM_ALANI]: damga });
    })
  );
}

/**
 * Damgayı geri alır — yalnızca gönderimin KESİN olarak hiç yapılmadığı
 * bilindiğinde (bkz. `FcmGonderimBasarisizHatasi`) çağrılır; belirsiz bir
 * çökmede damga bilerek yerinde bırakılır.
 *
 * Bu temizliğin kendisi başarısız olursa hata YUTULUR: asıl (FCM) hata daha
 * bilgilendiricidir ve damga zaten en fazla `GONDERIM_CLAIM_BAYATLAMA_MS`
 * sonra kendiliğinden geçersizleşir.
 */
export async function gonderimClaimSerbestBirak(refler: DocumentReference[]): Promise<void> {
  try {
    await parcaliBatchUygula(
      refler.map<BatchIslemi>((ref) => (batch) => {
        batch.update(ref, { [GONDERIM_CLAIM_ALANI]: FieldValue.delete() });
      })
    );
  } catch (temizlikHatasi) {
    console.error('Gönderim damgası geri alınamadı (asıl hata ayrıca fırlatılacak):', temizlikHatasi);
  }
}
