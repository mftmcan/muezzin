import { db, FieldValue, Timestamp } from './lib/firebaseAdminInit.ts';
import {
  fcmGonderVeTemizle,
  FcmGonderimBasarisizHatasi,
  kullaniciFcmTokenleriniTopla,
  type FcmMessage,
  type FcmGonderici,
} from './lib/fcmNotify.ts';
import { parcaliBatchUygula, type BatchIslemi } from './lib/firestoreBatch.ts';
import { GONDERIM_CLAIM_ALANI, gonderimClaimBayatMi, gonderimClaimSerbestBirak, gonderimClaimYaz } from './lib/gonderimClaim.ts';

type IzinData = {
  uid: string;
  baslangic: string;
  bitis: string;
  tip: 'haftalik' | 'yillik' | 'mazeret';
  durum: 'onay_bekliyor' | 'onaylandi' | 'reddedildi';
  redSebebi?: string;
  bildirimGonderildi?: boolean;
  bildirimGonderimBaslangici?: unknown;
};

type MuezzinData = {
  notificationSettings?: { mazeretDurumu?: boolean };
  fcmTokens?: Record<string, unknown>;
  fcmToken?: string | null;
};

const TIP_ETIKETI: Record<IzinData['tip'], string> = {
  haftalik: 'Haftalık izin',
  yillik: 'Yıllık izin',
  mazeret: 'Mazeret',
};

/**
 * `izinler` koleksiyonunda `bildirimGonderildi: false` olan (henüz push
 * bildirimi gönderilmemiş) her karara varılmış talep için, talebi
 * gönderen kişiye — `notificationSettings.mazeretDurumu !== false` ise —
 * FCM push gönderir.
 *
 * `izinGuncelle` karar anında (`onaylandi`/`reddedildi`) bu bayrağı
 * `false` yazar, `izinGeriAl` kararı geri alırken siler (bkz.
 * useAdminIzinlerStore.ts) — bu sorgu tek bir eşitlik filtresi (`== false`)
 * olduğundan, işlenen her karar anında `true`'ya çevrildiğinden bu küme
 * her zaman küçük/geçici kalır (bkz. Firebase/GitHub veri akışı
 * optimizasyonu — mazeretDevirleriniIsle.ts'teki AYNI prensip, kaynağında
 * baştan sınırlı bir bayrakla).
 *
 * Gönderim İKİ FAZLI bir "claim" ile idempotent kılınır (claim → send →
 * mark); gerekçenin tamamı `scripts/lib/gonderimClaim.ts` içindedir.
 *
 * @param gonderici Yalnızca testler için — bkz. `fcmGonderVeTemizle`.
 */
export async function processIzinDurumBildirimleri(
  dryRun = false,
  gonderici?: FcmGonderici
): Promise<{ kararSayisi: number; mesajSayisi: number }> {
  console.log(`İzin durumu bildirimleri gönderiliyor${dryRun ? ' (dry-run)' : ''}...`);

  const izinSnap = await db.collection('izinler').where('bildirimGonderildi', '==', false).get();

  if (izinSnap.empty) {
    console.log('Bildirilecek yeni izin kararı yok.');
    return { kararSayisi: 0, mesajSayisi: 0 };
  }

  // Hâlâ TAZE bir "gönderiliyor" damgası taşıyan kayıtlar, gönderimin
  // gerçekleşip gerçekleşmediği BİLİNMEYEN bir koşuya aittir; damga
  // bayatlayana kadar dokunulmaz (bkz. gonderimClaim.ts).
  const simdiMs = Date.now();
  const islenecekler = izinSnap.docs.filter((docSnap) =>
    gonderimClaimBayatMi((docSnap.data() as IzinData).bildirimGonderimBaslangici, simdiMs)
  );
  const beklemedeSayisi = izinSnap.size - islenecekler.length;
  if (beklemedeSayisi > 0) {
    console.log(`${beklemedeSayisi} izin kararı, önceki bir koşunun taze "gönderiliyor" damgasını taşıyor — bu turda atlandı.`);
  }
  if (islenecekler.length === 0) {
    return { kararSayisi: 0, mesajSayisi: 0 };
  }

  const tumMesajlar: FcmMessage[] = [];
  const tokenToUidMap: Record<string, string> = {};
  // Yalnızca gerçekten PUSH ÜRETEN kayıtlar claim'lenir: mesaj üretmeyen
  // kayıtlarda (karara varılmamış, alıcı kaydı yok, tercih kapalı, token
  // yok) hiçbir dış yan etki olmadığından "gönderildi mi" belirsizliği de
  // yoktur — onları yalnızca işaretlemek yeterli ve gereksiz yazma
  // üretmez (Spark yazma kotası).
  const claimlenecekRefler: FirebaseFirestore.DocumentReference[] = [];
  let kararSayisi = 0;
  let mesajSayisi = 0;

  for (const docSnap of islenecekler) {
    const izin = docSnap.data() as IzinData;

    // Yalnızca kararı verilmiş talepler ilgilenir — `bildirimGonderildi`
    // yalnızca izinGuncelle'de (durum değişimiyle AYNI transaction'da)
    // false yazıldığından bu dal normalde hiç tetiklenmez; yine de taze
    // veriyle yeniden doğrulanır (bkz. mazeretDevirleriniIsle.ts'teki AYNI
    // savunma derinliği ilkesi).
    if (izin.durum !== 'onaylandi' && izin.durum !== 'reddedildi') continue;
    kararSayisi++;

    const muezzinSnap = await db.collection('muezzins').doc(izin.uid).get();
    const muezzin = muezzinSnap.exists ? (muezzinSnap.data() as MuezzinData) : null;

    if (!muezzin || muezzin.notificationSettings?.mazeretDurumu === false) continue;
    const tokens = kullaniciFcmTokenleriniTopla(muezzin);
    if (tokens.length === 0) continue;

    const tipEtiketi = TIP_ETIKETI[izin.tip];
    const title = izin.durum === 'onaylandi' ? 'İzin Talebiniz Onaylandı ✅' : 'İzin Talebiniz Reddedildi';
    const body =
      izin.durum === 'onaylandi'
        ? `${tipEtiketi} talebiniz (${izin.baslangic} - ${izin.bitis}) onaylandı.`
        : `${tipEtiketi} talebiniz (${izin.baslangic} - ${izin.bitis}) reddedildi.${izin.redSebebi ? ` Gerekçe: ${izin.redSebebi}` : ''}`;

    tokens.forEach((token) => {
      tokenToUidMap[token] = izin.uid;
      tumMesajlar.push({
        token,
        notification: { title, body },
        data: { type: 'izin_durumu', izinId: docSnap.id, durum: izin.durum },
      });
    });
    mesajSayisi += tokens.length;
    claimlenecekRefler.push(docSnap.ref);
  }

  console.log(`${kararSayisi} yeni izin kararı, ${mesajSayisi} alıcı cihaza gönderilecek.`);

  if (dryRun) {
    console.log(`Tamamlandi (dry-run). kararSayisi=${kararSayisi}, mesajSayisi=${mesajSayisi}`);
    return { kararSayisi, mesajSayisi };
  }

  // 1. FAZ — CLAIM (gönderimden ÖNCE kalıcılaşır; bkz. duyuruBildirimGonder.ts'teki
  // AYNI üç fazlı akış ve gonderimClaim.ts'teki kök neden açıklaması).
  await gonderimClaimYaz(claimlenecekRefler, Timestamp.now());

  // 2. FAZ — SEND. Tam arızada (FcmGonderimBasarisizHatasi) hiçbir mesajın
  // ulaşmadığı KESİN olduğundan damga hemen geri alınır: kayıt bayatlama
  // süresini beklemeden bir sonraki koşuda yeniden denenir. Hata çağıranına
  // kadar çıkıp process.exit(1) ürettiğinden workflow'un `if: success()`
  // adımı da çalışmaz.
  try {
    await fcmGonderVeTemizle(tumMesajlar, tokenToUidMap, 'FCM izin durumu bildirimi', gonderici);
  } catch (err) {
    if (err instanceof FcmGonderimBasarisizHatasi) {
      await gonderimClaimSerbestBirak(claimlenecekRefler);
    }
    throw err;
  }

  // 3. FAZ — MARK: bu turda ele alınan TÜM kayıtlar (mesaj üretmeyenler
  // dahil) işaretlenir, damga silinir.
  await parcaliBatchUygula(
    islenecekler.map<BatchIslemi>((docSnap) => (batch) => {
      batch.update(docSnap.ref, { bildirimGonderildi: true, [GONDERIM_CLAIM_ALANI]: FieldValue.delete() });
    })
  );
  console.log(`Tamamlandi. kararSayisi=${kararSayisi}`);
  return { kararSayisi, mesajSayisi };
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const isDryRun = process.argv.includes('--dry-run');
  processIzinDurumBildirimleri(isDryRun).catch((err) => {
    console.error('İzin durumu bildirimleri gönderilemedi:', err);
    process.exit(1);
  });
}
