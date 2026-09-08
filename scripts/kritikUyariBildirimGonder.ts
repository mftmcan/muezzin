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

type AdminUyarisiData = {
  tip: string;
  mesaj: string;
  cozuldu: boolean;
  bildirimGonderildi?: boolean;
  bildirimGonderimBaslangici?: unknown;
};

type MuezzinData = {
  role: 'admin' | 'muezzin' | 'gozlemci';
  aktif: boolean;
  fcmToken?: string | null;
  fcmTokens?: Record<string, unknown>;
};

/**
 * `adminUyarilari`'nda `cozuldu: false` olan (KrizAlarmlari.tsx'te zaten
 * görünen) her uyarı için — `bildirimGonderildi !== true` ise — tüm aktif
 * admin'lere FCM push gönderir.
 *
 * Bilinçli tasarım kararları:
 * - `bildirimGonderildi` alanı YENİ — mevcut uyarıları YAZAN 5 ayrı yer
 *   (kotaKontrol.ts, reportWorkflowFailure.ts, planServisi.ts,
 *   mazeretServisi.ts, vb.) hiçbirine dokunulmadı; alan opsiyonel kabul
 *   edilir (`!== true` sorgusu), yokluğu "henüz gönderilmedi" sayılır. Blast
 *   radius sıfır: bu script yalnızca OKUR + kendi yazdığı iki alanı günceller.
 * - Bildirim TERCİHİ yok — `firestore.rules` `isValidNotificationSettings`
 *   (`hasOnly(['nobetHatirlatici','duyurular','mazeretDurumu'])`) yeni bir
 *   anahtar eklemeyi rules değişikliği gerektirir hâle getiriyordu. Kritik
 *   sistem arızası opt-out edilebilir olmamalı — bu yüzden rules'a HİÇ
 *   dokunulmadı, tüm aktif admin'ler koşulsuz bildirilir.
 * - Gönderim İKİ FAZLI "claim" ile idempotent (bkz. gonderimClaim.ts) —
 *   izinDurumBildirimGonder.ts / duyuruBildirimGonder.ts ile AYNI mekanizma,
 *   alan adı bile aynı (`bildirimGonderimBaslangici`), koleksiyon-agnostik.
 *
 * @param gonderici Yalnızca testler için — bkz. `fcmGonderVeTemizle`.
 */
export async function processKritikUyariBildirimleri(
  dryRun = false,
  gonderici?: FcmGonderici
): Promise<{ uyariSayisi: number; mesajSayisi: number }> {
  console.log(`Kritik uyarı bildirimleri gönderiliyor${dryRun ? ' (dry-run)' : ''}...`);

  const uyariSnap = await db.collection('adminUyarilari').where('cozuldu', '==', false).get();
  const bildirilmemis = uyariSnap.docs.filter((docSnap) => (docSnap.data() as AdminUyarisiData).bildirimGonderildi !== true);

  if (bildirilmemis.length === 0) {
    console.log('Bildirilecek yeni kritik uyarı yok.');
    return { uyariSayisi: 0, mesajSayisi: 0 };
  }

  const simdiMs = Date.now();
  const islenecekler = bildirilmemis.filter((docSnap) =>
    gonderimClaimBayatMi((docSnap.data() as AdminUyarisiData).bildirimGonderimBaslangici, simdiMs)
  );
  const beklemedeSayisi = bildirilmemis.length - islenecekler.length;
  if (beklemedeSayisi > 0) {
    console.log(`${beklemedeSayisi} uyarı, önceki bir koşunun taze "gönderiliyor" damgasını taşıyor — bu turda atlandı.`);
  }
  if (islenecekler.length === 0) {
    return { uyariSayisi: 0, mesajSayisi: 0 };
  }

  // Alıcılar (aktif admin'ler) TÜM uyarılar için ortak — döngü başına değil
  // bir kez okunur (bkz. firestore.indexes.json: muezzins [role, aktif]).
  const adminSnap = await db.collection('muezzins').where('role', '==', 'admin').where('aktif', '==', true).get();
  const tokenToUidMap: Record<string, string> = {};
  const adminTokenlari: string[] = [];
  adminSnap.docs.forEach((docSnap) => {
    const muezzin = docSnap.data() as MuezzinData;
    kullaniciFcmTokenleriniTopla(muezzin).forEach((token) => {
      tokenToUidMap[token] = docSnap.id;
      adminTokenlari.push(token);
    });
  });

  if (adminTokenlari.length === 0) {
    console.log('Kayıtlı FCM token taşıyan aktif admin bulunamadı — bildirim gönderilmedi, uyarılar yine de işaretlenecek.');
  }

  const tumMesajlar: FcmMessage[] = [];
  islenecekler.forEach((docSnap) => {
    const uyari = docSnap.data() as AdminUyarisiData;
    adminTokenlari.forEach((token) => {
      tumMesajlar.push({
        token,
        notification: { title: '⚠️ Kritik Sistem Uyarısı', body: uyari.mesaj },
        data: { type: 'admin_uyarisi', uyariId: docSnap.id, tip: uyari.tip },
      });
    });
  });

  console.log(`${islenecekler.length} yeni kritik uyarı, ${tumMesajlar.length} alıcı cihaza gönderilecek.`);

  if (dryRun) {
    console.log(`Tamamlandi (dry-run). uyariSayisi=${islenecekler.length}, mesajSayisi=${tumMesajlar.length}`);
    return { uyariSayisi: islenecekler.length, mesajSayisi: tumMesajlar.length };
  }

  const claimlenecekRefler = islenecekler.map((docSnap) => docSnap.ref);

  // 1. FAZ — CLAIM
  await gonderimClaimYaz(claimlenecekRefler, Timestamp.now());

  // 2. FAZ — SEND. Tam arızada damga hemen geri alınır (bkz.
  // izinDurumBildirimGonder.ts'teki AYNI desen).
  try {
    await fcmGonderVeTemizle(tumMesajlar, tokenToUidMap, 'FCM kritik uyarı bildirimi', gonderici);
  } catch (err) {
    if (err instanceof FcmGonderimBasarisizHatasi) {
      await gonderimClaimSerbestBirak(claimlenecekRefler);
    }
    throw err;
  }

  // 3. FAZ — MARK
  await parcaliBatchUygula(
    islenecekler.map<BatchIslemi>((docSnap) => (batch) => {
      batch.update(docSnap.ref, { bildirimGonderildi: true, [GONDERIM_CLAIM_ALANI]: FieldValue.delete() });
    })
  );
  console.log(`Tamamlandi. uyariSayisi=${islenecekler.length}`);
  return { uyariSayisi: islenecekler.length, mesajSayisi: tumMesajlar.length };
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const isDryRun = process.argv.includes('--dry-run');
  processKritikUyariBildirimleri(isDryRun).catch((err) => {
    console.error('Kritik uyarı bildirimleri gönderilemedi:', err);
    process.exit(1);
  });
}
