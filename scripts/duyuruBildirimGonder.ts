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

type DuyuruData = {
  baslik: string;
  icerik: string;
  tip: 'onemli' | 'bilgi' | 'duyuru';
  bildirimGonderildi?: boolean;
  bildirimGonderimBaslangici?: unknown;
};

type MuezzinData = {
  aktif?: boolean;
  notificationSettings?: { duyurular?: boolean };
  fcmTokens?: Record<string, unknown>;
  fcmToken?: string | null;
};

const ICERIK_ONIZLEME_UZUNLUGU = 200;

/**
 * `duyurular` koleksiyonunda `bildirimGonderildi: false` olan (henüz push
 * bildirimi gönderilmemiş) her yeni duyuru için, `notificationSettings.duyurular
 * !== false` olan tüm aktif müezzinlere FCM push gönderir.
 *
 * `duyuruYayinla` (src/services/duyuruServisi.ts) her yeni duyuruyu
 * `bildirimGonderildi: false` ile oluşturur — bu sorgu tek bir eşitlik
 * filtresi (`== false`) olduğundan, mazeretDevirleriniIsle.ts/
 * vekaletDevirleriniIsle.ts'in daha önce sınırsız büyüyen koleksiyonları tam
 * taradığı sınıftan bir sorunu baştan taşımaz (bkz. Firebase/GitHub veri
 * akışı optimizasyonu) — işlenen her duyuru anında `true`'ya çevrildiğinden
 * bu küme her zaman küçük/geçici kalır.
 *
 * Gönderim İKİ FAZLI bir "claim" ile idempotent kılınır (claim → send →
 * mark); gerekçenin tamamı `scripts/lib/gonderimClaim.ts` içindedir.
 *
 * @param gonderici Yalnızca testler için — bkz. `fcmGonderVeTemizle`.
 */
export async function processDuyuruBildirimleri(
  dryRun = false,
  gonderici?: FcmGonderici
): Promise<{ duyuruSayisi: number; mesajSayisi: number }> {
  console.log(`Duyuru bildirimleri gönderiliyor${dryRun ? ' (dry-run)' : ''}...`);

  const duyuruSnap = await db.collection('duyurular').where('bildirimGonderildi', '==', false).get();

  if (duyuruSnap.empty) {
    console.log('Bildirilecek yeni duyuru yok.');
    return { duyuruSayisi: 0, mesajSayisi: 0 };
  }

  // 1. FAZ ÖNCESİ: hâlâ TAZE bir "gönderiliyor" damgası taşıyan kayıtlar,
  // ya şu an koşan (imkânsız — concurrency grubu var) ya da az önce ölmüş
  // bir sürecin elindedir; ikinci kez göndermek yerine damga bayatlayana
  // kadar beklenir (bkz. gonderimClaim.ts).
  const simdiMs = Date.now();
  const islenecekler = duyuruSnap.docs.filter((docSnap) =>
    gonderimClaimBayatMi((docSnap.data() as DuyuruData).bildirimGonderimBaslangici, simdiMs)
  );
  const beklemedeSayisi = duyuruSnap.size - islenecekler.length;
  if (beklemedeSayisi > 0) {
    console.log(`${beklemedeSayisi} duyuru, önceki bir koşunun taze "gönderiliyor" damgasını taşıyor — bu turda atlandı.`);
  }
  if (islenecekler.length === 0) {
    return { duyuruSayisi: 0, mesajSayisi: 0 };
  }

  const muezzinSnap = await db.collection('muezzins').where('aktif', '==', true).get();
  const tokenToUidMap: Record<string, string> = {};
  const alicilarinFcmTokenleri: string[] = [];
  muezzinSnap.docs.forEach((docSnap) => {
    const m = docSnap.data() as MuezzinData;
    if (m.notificationSettings?.duyurular === false) return;
    const tokens = kullaniciFcmTokenleriniTopla(m);
    tokens.forEach((t) => {
      tokenToUidMap[t] = docSnap.id;
    });
    alicilarinFcmTokenleri.push(...tokens);
  });

  const tumMesajlar: FcmMessage[] = [];
  const duyuruSayisi = islenecekler.length;

  islenecekler.forEach((docSnap) => {
    const duyuru = docSnap.data() as DuyuruData;

    const icerikOnizleme =
      duyuru.icerik.length > ICERIK_ONIZLEME_UZUNLUGU ? `${duyuru.icerik.slice(0, ICERIK_ONIZLEME_UZUNLUGU)}…` : duyuru.icerik;

    alicilarinFcmTokenleri.forEach((token) => {
      tumMesajlar.push({
        token,
        notification: { title: duyuru.baslik, body: icerikOnizleme },
        data: { type: 'duyuru_yayinlandi', duyuruId: docSnap.id, duyuruTip: duyuru.tip },
      });
    });
  });

  console.log(`${duyuruSayisi} yeni duyuru, ${alicilarinFcmTokenleri.length} alıcı cihaza gönderilecek.`);

  if (dryRun) {
    console.log(`Tamamlandi (dry-run). duyuruSayisi=${duyuruSayisi}, mesajSayisi=${tumMesajlar.length}`);
    return { duyuruSayisi, mesajSayisi: tumMesajlar.length };
  }

  // 1. FAZ — CLAIM: gönderimden ÖNCE "bu kayıtları ben işliyorum" damgası
  // kalıcılaştırılır. Bundan sonraki HERHANGİ bir noktada süreç ölse bile
  // sonraki koşu bu kayıtları taze damgalı görüp atlar; eskiden bayrak
  // yalnızca gönderimden SONRA yazıldığından, gönderimle commit arasındaki
  // bir çökme aynı duyuruyu her 10 dakikada bir yeniden gönderiyordu.
  const refler = islenecekler.map((docSnap) => docSnap.ref);
  await gonderimClaimYaz(refler, Timestamp.now());

  // 2. FAZ — SEND. Gönderim TAMAMEN başarısız olursa fcmGonderVeTemizle
  // FIRLATIR (bkz. FcmGonderimBasarisizHatasi): bu, "hiçbir şey ulaşmadı"
  // bilgisinin KESİN olduğu tek durumdur, o yüzden damga hemen geri alınır
  // ve kayıt 15 dakikalık bayatlama süresini beklemeden bir sonraki koşuda
  // yeniden denenir. Hata çağıranına (CLI sarmalayıcı) kadar çıkıp
  // process.exit(1) ürettiğinden workflow'un `if: success()` adımı
  // (reportWorkflowSuccess.ts) da çalışmaz ve önceki arıza uyarısı
  // yanlışlıkla "çözüldü" işaretlenmez.
  try {
    await fcmGonderVeTemizle(tumMesajlar, tokenToUidMap, 'FCM duyuru bildirimi', gonderici);
  } catch (err) {
    if (err instanceof FcmGonderimBasarisizHatasi) {
      await gonderimClaimSerbestBirak(refler);
    }
    throw err;
  }

  // 3. FAZ — MARK: bayrak yazılır, damga silinir (belge kalıcı olarak
  // fazladan bir alan taşımasın — bkz. firestore.rules `isValidDuyuru`).
  await parcaliBatchUygula(
    islenecekler.map<BatchIslemi>((docSnap) => (batch) => {
      batch.update(docSnap.ref, { bildirimGonderildi: true, [GONDERIM_CLAIM_ALANI]: FieldValue.delete() });
    })
  );
  console.log(`Tamamlandi. duyuruSayisi=${duyuruSayisi}`);
  return { duyuruSayisi, mesajSayisi: tumMesajlar.length };
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const isDryRun = process.argv.includes('--dry-run');
  processDuyuruBildirimleri(isDryRun).catch((err) => {
    console.error('Duyuru bildirimleri gönderilemedi:', err);
    process.exit(1);
  });
}
