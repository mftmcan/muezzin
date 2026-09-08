import { getMessaging } from 'firebase-admin/messaging';
import { db, FieldValue } from './firebaseAdminInit.ts';
import { parcaliBatchUygula, type BatchIslemi } from './firestoreBatch.ts';

export interface FcmMessage {
  token: string;
  notification: { title: string; body: string };
  data: Record<string, string>;
}

/**
 * `sendEach`'in dönüşünün bu modülün gerçekten okuduğu alanları. Admin
 * SDK'nın `BatchResponse`'u bu yapıya yapısal olarak uyar — tip bilerek dar
 * tutulur ki testler sahte bir gönderici enjekte edebilsin (bkz.
 * `FcmGonderici`).
 */
export interface FcmGonderimYaniti {
  successCount: number;
  failureCount: number;
  responses: { success: boolean; error?: { code?: string } | null }[];
}

/** Mesaj parçasını gerçekten gönderen fonksiyon (test için enjekte edilebilir). */
export type FcmGonderici = (mesajlar: FcmMessage[]) => Promise<FcmGonderimYaniti>;

/** `fcmGonderVeTemizle`'nin çağırana döndürdüğü gönderim özeti. */
export interface FcmGonderimSonucu {
  toplam: number;
  basarili: number;
  basarisiz: number;
  /**
   * BEKLENEN (bayat/kayıtsız token) dışındaki başarısızlık sayısı — kimlik
   * bilgisi süresi dolmuş, proje düzeyinde messaging kapalı, kota vb.
   */
  beklenmeyenBasarisiz: number;
}

/**
 * Gönderimin TAMAMEN başarısız olduğunu (hiçbir mesaj ulaşmadı ve
 * başarısızlıkların en az biri bayat-token gibi kendiliğinden düzelen bir
 * durum DEĞİL) çağırana bildiren hata.
 *
 * Neden bir istisna: bu fonksiyon önceden başarısızlıkları yalnızca
 * SAYIYOR ve normal dönüyordu. Çağıranlar (duyuruBildirimGonder.ts,
 * izinDurumBildirimGonder.ts) dönüşün ardından koşulsuz olarak
 * `bildirimGonderildi: true` yazdığından, tam bir FCM arızasında bildirim
 * "gönderildi" işaretlenip bir daha asla denenmiyordu; üstelik script 0 ile
 * çıktığı için `.github/workflows/*.yml`'deki `if: success()` adımı
 * (reportWorkflowSuccess.ts) ÖNCEKİ gerçek bir arızanın admin uyarısını da
 * otomatik çözüp arızayı tamamen görünmez yapıyordu. Fail-closed olması için
 * karar burada verilir — çağıranın dönüş değerini kontrol etmeyi unutması
 * aynı sessiz hataya geri dönemez.
 */
export class FcmGonderimBasarisizHatasi extends Error {
  readonly sonuc: FcmGonderimSonucu;

  constructor(logEtiketi: string, sonuc: FcmGonderimSonucu) {
    super(
      `${logEtiketi}: FCM gönderimi tamamen başarısız oldu — ${sonuc.toplam} mesajın hiçbiri iletilemedi ` +
        `(${sonuc.beklenmeyenBasarisiz} beklenmeyen hata). Bildirimler "gönderildi" olarak işaretlenmedi.`
    );
    this.name = 'FcmGonderimBasarisizHatasi';
    this.sonuc = sonuc;
  }
}

/**
 * Token artık geçerli değil — BEKLENEN ve kendiliğinden düzelen bir
 * başarısızlık: aşağıdaki temizlik bu tokenı `muezzins/{uid}.fcmTokens`
 * haritasından siler, bir sonraki koşuda mesaj hiç üretilmez. Bu yüzden
 * "tamamen başarısız" kararında sayılmaz (tek alıcısı bayat token olan bir
 * duyuru aksi halde yanlışlıkla kritik arıza sayılırdı).
 */
const BEKLENEN_TOKEN_HATALARI = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];

/**
 * Bir `muezzins/{uid}` belgesinden gönderilebilir FCM token listesini
 * çıkarır: çok-cihazlı `fcmTokens` haritası varsa o kullanılır, yoksa eski
 * tekil `fcmToken` alanına düşülür. `haftalikPlanOlustur.ts` ve
 * `yatsiSonuIslemleri.ts` bu mantığı bağımsız birer kopya olarak taşıyordu
 * (fcmGonderVeTemizle'nin kendisiyle AYNI kök neden) — buraya çıkarıldı.
 */
export function kullaniciFcmTokenleriniTopla(data: { fcmTokens?: Record<string, unknown>; fcmToken?: string | null }): string[] {
  const tokens: string[] = [];
  if (data.fcmTokens && typeof data.fcmTokens === 'object') {
    Object.keys(data.fcmTokens).forEach((t) => {
      if (t.trim().length > 0) tokens.push(t);
    });
  }
  if (tokens.length === 0 && typeof data.fcmToken === 'string' && data.fcmToken.trim().length > 0) {
    tokens.push(data.fcmToken);
  }
  return tokens;
}

/**
 * Hazırlanmış FCM mesajlarını gönderir; gönderim başarısız olup token artık
 * geçersizse (`messaging/registration-token-not-registered` veya
 * `messaging/invalid-registration-token`) o token'ı ilgili kullanıcının
 * `muezzins/{uid}.fcmTokens` haritasından temizler.
 *
 * `scripts/haftalikPlanOlustur.ts` ve `scripts/yatsiSonuIslemleri.ts` bu
 * gönderim+temizlik iskeletini bağımsız birer kopya olarak taşıyordu (bkz.
 * kod denetimi) — buraya çıkarıldı ki bir düzeltme (ör. yeni bir hata kodu
 * eklenmesi) her iki cron'a da aynı anda yansısın.
 *
 * Hiçbir mesaj iletilemediğinde (ve bu, tamamı bayat-token temizliğiyle
 * açıklanamıyorsa) `FcmGonderimBasarisizHatasi` FIRLATIR — bkz. o sınıfın
 * yorumu. KISMİ başarısızlık (bazı cihazların tokenı bayat) normaldir ve
 * hata sayılmaz.
 *
 * @param messages       Gönderilecek mesajlar.
 * @param tokenToUidMap  Her token'ın hangi kullanıcıya ait olduğu — geçersiz
 *                       token temizliği bunu kullanır.
 * @param logEtiketi     Konsol loglarında görünecek kısa ayırt edici etiket
 *                       (ör. "Haftalık plan", "Günlük hatırlatma").
 * @param gonderici      Mesaj parçasını gönderen fonksiyon; varsayılan
 *                       `getMessaging().sendEach`. Yalnızca testler (gerçek
 *                       FCM'e çıkmadan arıza senaryosu kurmak için) geçer.
 */
export async function fcmGonderVeTemizle(
  messages: FcmMessage[],
  tokenToUidMap: Record<string, string>,
  logEtiketi: string,
  gonderici: FcmGonderici = (parca) => getMessaging().sendEach(parca)
): Promise<FcmGonderimSonucu> {
  if (messages.length === 0) {
    console.log(`${logEtiketi}: kayıtlı aktif FCM cihaz tokenı bulunamadı, bildirim gönderilmedi.`);
    return { toplam: 0, basarili: 0, basarisiz: 0, beklenmeyenBasarisiz: 0 };
  }

  console.log(`${logEtiketi}: ${messages.length} bildirim gönderiliyor...`);
  // `sendEach` en fazla 500 mesaj kabul eder — bu limitin üzerinde tek bir
  // çağrı TAMAMEN fırlatır. Bu fonksiyon çağrıldığı script'in yorumundaki
  // "mesaj sayısı her zaman küçük kalır" varsayımı tam da script'in bir
  // süre çalışmadığı (o yüzden birikmiş) durumda bozuluyordu — 500'ü aşan
  // tek bir koşu her seferinde aynı hatayla ölüp hiçbir bildirim bir daha
  // hiç gönderilemiyordu (premium hata analizi FR-O5). 500'lük parçalar
  // halinde gönderilir; bir parçanın başarısızlığı diğerlerini engellemez.
  const SEND_CHUNK_SIZE = 500;
  let successCount = 0;
  let failureCount = 0;
  let beklenmeyenBasarisiz = 0;
  const tokensToRemove: Record<string, string[]> = {};

  for (let i = 0; i < messages.length; i += SEND_CHUNK_SIZE) {
    const parca = messages.slice(i, i + SEND_CHUNK_SIZE);
    const response = await gonderici(parca);
    successCount += response.successCount;
    failureCount += response.failureCount;

    response.responses.forEach((res, index) => {
      if (!res.success) {
        const errCode = res.error?.code;
        if (errCode && BEKLENEN_TOKEN_HATALARI.includes(errCode)) {
          const failedToken = parca[index]!.token;
          const uid = tokenToUidMap[failedToken];
          if (uid) {
            if (!tokensToRemove[uid]) tokensToRemove[uid] = [];
            tokensToRemove[uid]!.push(failedToken);
          }
        } else {
          beklenmeyenBasarisiz++;
        }
      }
    });
  }
  console.log(
    `${logEtiketi}: gönderim tamamlandı. Başarılı: ${successCount}, Başarısız: ${failureCount} (beklenmeyen: ${beklenmeyenBasarisiz})`
  );

  const sonuc: FcmGonderimSonucu = {
    toplam: messages.length,
    basarili: successCount,
    basarisiz: failureCount,
    beklenmeyenBasarisiz,
  };

  const uidsToUpdate = Object.keys(tokensToRemove);
  if (uidsToUpdate.length > 0) {
    // Tek bir `db.batch()` idi: kullanıcı sayısı 500'ü aşarsa commit
    // TAMAMEN fırlatır ve gönderim başarılı olsa bile bayat token temizliği
    // bir daha hiç yapılamaz (bkz. `parcaliBatchUygula` — yukarıdaki
    // SEND_CHUNK_SIZE ile AYNI sınıf sınır, yazma tarafında).
    await parcaliBatchUygula(
      uidsToUpdate.map<BatchIslemi>((uid) => (batch) => {
        const userRef = db.collection('muezzins').doc(uid);
        const updates: Record<string, FieldValue> = {};
        tokensToRemove[uid]!.forEach((t) => {
          updates[`fcmTokens.${t}`] = FieldValue.delete();
        });
        batch.update(userRef, updates);
      })
    );
    console.log(`${logEtiketi}: FCM cleanup — ${uidsToUpdate.length} kullanıcıdan geçersiz tokenlar temizlendi.`);
  }

  // Bayat token temizliği ÖNCE yapılır, sonra karar verilir: gönderim
  // tamamen başarısız olsa bile geçersiz tokenlar temizlenmiş olmalı.
  if (successCount === 0 && beklenmeyenBasarisiz > 0) {
    throw new FcmGonderimBasarisizHatasi(logEtiketi, sonuc);
  }

  return sonuc;
}
