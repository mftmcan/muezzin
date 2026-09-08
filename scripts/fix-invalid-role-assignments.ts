import { db, Timestamp } from './lib/firebaseAdminInit.ts';
import { isFriday, getTurkeyDateString } from '../src/lib/dateUtils.ts';

type Role = 'muezzin' | 'admin' | 'gozlemci' | string;
type MuezzinDoc = { displayName?: string; role?: Role; aktif?: boolean; onayBekliyor?: boolean };
type VakitAtama = { asil?: string; yedek?: string };

const VAKITLER = ['sabah', 'ogle', 'ikindi', 'aksam', 'yatsi'] as const;

// Kod tabanındaki diğer TÜM cron script'leri (haftalikPlanOlustur.ts,
// yatsiSonuIslemleri.ts, vakitVeriSagligiKontrol.ts) geçmiş/gelecek gün
// ayrımı için `getTurkeyDateString()` kullanırken bu dosya düz `new Date()`
// (çalıştırılan makinenin/CI runner'ının yerel saat dilimi) kullanıyordu —
// UTC'de çalışan bir CI runner'da gece yarısına yakın çalıştırılırsa
// "bugün" yanlış hesaplanabilirdi (bkz. kod denetimi). Artık projenin tek
// Türkiye-tarihi kaynağıyla tutarlı.
function getTodayStr(): string {
  return getTurkeyDateString();
}

function pickMostFrequent(values: string[], excluded = new Set<string>()): string | null {
  const freq = new Map<string, number>();
  for (const v of values) {
    if (!v || excluded.has(v)) continue;
    freq.set(v, (freq.get(v) || 0) + 1);
  }
  let best: string | null = null;
  let max = -1;
  for (const [uid, count] of freq.entries()) {
    if (count > max) {
      best = uid;
      max = count;
    }
  }
  return best;
}

export interface DuzeltmeOzeti {
  scannedSlots: number;
  invalidSlots: number;
  fixedDays: number;
  pastInvalidDays: number;
}

/**
 * @param apply `false` ise KURU ÇALIŞTIRMA — hiçbir belge yazılmaz.
 *
 * Diğer yıkıcı bakım script'leriyle (backfillCumaMi.ts, seedSuperAdminConfig.ts)
 * AYNI güvenlik ağı deseni — bu script `bildirimler` belgelerini SİLİP
 * YENİDEN OLUŞTURUYOR ve `haftaPlanlari`'nı yeniden yazıyor, önceden hiçbir
 * kuru-çalıştırma koruması yoktu (premium hata analizi FR-O9).
 */
export async function fixInvalidRoleAssignments(apply: boolean): Promise<DuzeltmeOzeti> {
  console.log(
    apply ? 'UYGULAMA MODU — belgeler yazılacak.' : 'KURU ÇALIŞTIRMA — hiçbir şey yazılmayacak (--apply ile gerçek çalıştırma yapın).'
  );

  const today = getTodayStr();
  console.log(`Tarama başlıyor. Referans tarih (TR): ${today}`);

  const muezzinSnap = await db.collection('muezzins').get();
  const userMap = new Map<string, MuezzinDoc>();
  const aktifMuezzinler: string[] = [];

  muezzinSnap.docs.forEach((d) => {
    const data = d.data() as MuezzinDoc;
    userMap.set(d.id, data);
    // onayBekliyor:true olan (admin henüz onaylamamış) bir davetli nöbete
    // atanmamalı — planlamaCekirdegi.ts `nobeteAtanabilirMi` ile AYNI kural.
    // Admin SDK firestore.rules'taki isAssignableDutyUidVeri kontrolünü
    // atladığından bu script kendi kopyasını uygulamak zorunda.
    if (data.aktif === true && data.role === 'muezzin' && data.onayBekliyor !== true) aktifMuezzinler.push(d.id);
  });

  if (aktifMuezzinler.length < 2) {
    throw new Error('Düzeltme için en az 2 aktif müezzin gerekli.');
  }

  const plansSnap = await db.collection('haftaPlanlari').get();
  let scannedSlots = 0;
  let invalidSlots = 0;
  let fixedDays = 0;
  let pastInvalidDays = 0;

  for (const planDoc of plansSnap.docs) {
    const plan = planDoc.data() as { gunler?: Record<string, Record<string, VakitAtama>> };
    const gunler = plan.gunler || {};
    const planRef = db.collection('haftaPlanlari').doc(planDoc.id);
    const batch = db.batch();
    let hasBatchWork = false;

    for (const tarih of Object.keys(gunler)) {
      const day = gunler[tarih] || {};

      const asilVals: string[] = [];
      const yedekVals: string[] = [];
      let dayHasInvalid = false;

      for (const vakit of VAKITLER) {
        const atama = day[vakit] || {};
        const asil = atama.asil || '';
        const yedek = atama.yedek || '';
        if (asil) asilVals.push(asil);
        if (yedek) yedekVals.push(yedek);

        const asilRole = asil ? userMap.get(asil)?.role : undefined;
        const yedekRole = yedek ? userMap.get(yedek)?.role : undefined;
        const asilValid =
          !asil ||
          asil === 'Sistem' ||
          (userMap.get(asil)?.aktif === true && asilRole === 'muezzin' && userMap.get(asil)?.onayBekliyor !== true);
        const yedekValid =
          !yedek ||
          yedek === 'Sistem' ||
          (userMap.get(yedek)?.aktif === true && yedekRole === 'muezzin' && userMap.get(yedek)?.onayBekliyor !== true);
        if (!asilValid || !yedekValid) {
          dayHasInvalid = true;
          invalidSlots++;
        }
        scannedSlots++;
      }

      if (!dayHasInvalid) continue;
      if (tarih < today) {
        pastInvalidDays++;
        continue;
      }

      // Bu günün bildirimleri — hem "dokunulmamalı mı?" kararı hem de
      // aşağıdaki senkronizasyon için TEK sefer okunur.
      //
      // SIRA ÖNEMLİ: bu kontrol önceden aşağıda, `haftaPlanlari` güncellemeleri
      // ZATEN batch'e eklendikten SONRA yapılıyordu — `continue` yalnızca
      // bildirim yazımını atlıyor, plan yazımını atlamıyordu. Sonuç: "hiç
      // dokunmadan atla" sözü tutulmuyor, planda yeni asil/yedek görünürken
      // bildirimler (ve verilmiş krediler) eski kişide kalıyor, yani düzeltmek
      // istenen tutarsızlığın aynısı plan↔bildirim arasında üretiliyordu.
      const bildirimSnap = await db.collection('bildirimler').where('haftaId', '==', planDoc.id).where('tarih', '==', tarih).get();

      // `tarih === today` iken, o gün için yatsiSonuIslemleri.ts ZATEN
      // kredilendirmiş olabilir (`puanIslendi:true`). Bu belgeleri silip
      // FARKLI bir asil/yedek ile yeniden oluşturmak, kimin gerçekten
      // kredilendiği ile kimin şimdi atandığı arasında geriye dönük olarak
      // düzeltilemeyen bir tutarsızlık yaratır (ne eski sahibin kredisi geri
      // alınabilir ne yeni atanana doğru kredi verilebilir) — bu yüzden
      // güvenli seçenek bu günü hiç DOKUNMADAN atlamaktır (premium hata
      // analizi FR-O9), tıpkı geçmiş günlerin atlanması gibi.
      //
      // AYNI gerekçe tamamlanmış/bekleyen bir görev devri için de geçerli:
      // `vekaletDevredildi` (scripts/vekaletDevirleriniIsle.ts'in uyguladığı
      // GERÇEK sahiplik transferi) veya `vekaletDevriBekliyor` (kabul edilmiş
      // ama script henüz uygulamamış devir) taşıyan bir bildirimi silip
      // yeniden oluşturmak devri sessizce geri alır — src/lib/slotKorumasi.ts
      // `korumaSaglayanBildirimler` bu iki bayrağı tam da bu yüzden plan
      // yeniden üretiminden muaf tutuyor; Admin SDK o korumayı atladığından
      // bu script kendi kopyasını uygulamak zorunda.
      const dokunulmazBildirim = bildirimSnap.docs.find((d) => {
        const veri = d.data();
        return veri.puanIslendi === true || veri.vekaletDevredildi === true || veri.vekaletDevriBekliyor === true;
      });
      if (dokunulmazBildirim) {
        console.warn(
          `ATLANDI (${tarih}): kredilendirilmiş ya da görev devri uygulanmış bildirim var (${dokunulmazBildirim.id}), geriye dönük tutarsızlık riski nedeniyle dokunulmadı.`
        );
        pastInvalidDays++;
        continue;
      }

      const validAsilCandidates = asilVals.filter(
        (uid) => userMap.get(uid)?.aktif === true && userMap.get(uid)?.role === 'muezzin' && userMap.get(uid)?.onayBekliyor !== true
      );
      const validYedekCandidates = yedekVals.filter(
        (uid) => userMap.get(uid)?.aktif === true && userMap.get(uid)?.role === 'muezzin' && userMap.get(uid)?.onayBekliyor !== true
      );

      const asil = pickMostFrequent(validAsilCandidates) || aktifMuezzinler[0];
      let yedek =
        pickMostFrequent(validYedekCandidates, new Set([asil])) || aktifMuezzinler.find((uid) => uid !== asil) || aktifMuezzinler[1];
      if (yedek === asil) {
        const fallback = aktifMuezzinler.find((uid) => uid !== asil);
        if (!fallback) throw new Error(`Yedek seçiminde farklı müezzin bulunamadı: ${tarih}`);
        yedek = fallback;
      }

      for (const vakit of VAKITLER) {
        const current = day[vakit] || {};
        if (current.asil !== asil || current.yedek !== yedek) {
          batch.update(planRef, {
            [`gunler.${tarih}.${vakit}.asil`]: asil,
            [`gunler.${tarih}.${vakit}.yedek`]: yedek,
          });
          hasBatchWork = true;
        }
      }

      // Bildirimleri senkronize et (bugün ve sonrası): sadece asil/yedek kalacak.
      bildirimSnap.docs.forEach((d) => {
        const tip = d.data().tip as string | undefined;
        if (tip === 'asil' || tip === 'yedek' || tip === 'gorev_cagrisi') {
          batch.delete(d.ref);
          hasBatchWork = true;
        }
      });

      // scripts/haftalikPlanOlustur.ts ve src/services/planServisi.ts'in
      // her bildirim oluşturma yolu cumaMi'yi hesaplayıp yazıyor —
      // burada eksikti. firestore.rules'taki cumaMiIsaretli() eksik alanda
      // "Cuma değil" sayarak fail-open olduğundan, bu onarım scripti bir
      // Cuma gününün bildirimlerini dokunursa (ör. arşivlenmiş bir
      // müezzinin bayat atamasını düzeltmek için) o Cuma'nın sunucu
      // tarafı mazeret/vekalet kısıtlaması sessizce devre dışı kalıyordu
      // (bkz. code-review, dördüncü denetim turu).
      const [cY, cM, cD] = tarih.split('-').map(Number);
      const cumaMi = isFriday(new Date(cY, cM - 1, cD));

      for (const vakit of VAKITLER) {
        const base = {
          haftaId: planDoc.id,
          tarih,
          vakit,
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          cumaMi,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
        };
        batch.set(db.collection('bildirimler').doc(`${planDoc.id}_${tarih}_${vakit}_asil`), { ...base, uid: asil, tip: 'asil' });
        batch.set(db.collection('bildirimler').doc(`${planDoc.id}_${tarih}_${vakit}_yedek`), { ...base, uid: yedek, tip: 'yedek' });
        hasBatchWork = true;
      }

      fixedDays++;
    }

    if (hasBatchWork && apply) {
      await batch.commit();
    }
  }

  console.log('--- Özet ---');
  console.log(`Toplam taranan slot: ${scannedSlots}`);
  console.log(`Tespit edilen kural dışı slot: ${invalidSlots}`);
  console.log(`Bugün/gelecek için düzeltilen gün: ${fixedDays}${apply ? '' : ' (KURU ÇALIŞTIRMA — hiçbiri yazılmadı)'}`);
  console.log(`Geçmişte veya zaten kredilendirilmiş (dokunulmadı) gün: ${pastInvalidDays}`);
  if (!apply && fixedDays > 0) {
    console.log('Gerçekten uygulamak için: npx tsx scripts/fix-invalid-role-assignments.ts --apply');
  }

  return { scannedSlots, invalidSlots, fixedDays, pastInvalidDays };
}

// Yalnızca dosya DOĞRUDAN çalıştırıldığında koş (diğer script'lerdeki AYNI
// desen, bkz. reportWorkflowFailure.ts / duyuruBildirimGonder.ts) — bu blok
// önceden koşulsuzdu, dolayısıyla dosyayı import eden herhangi bir modül
// (ör. entegrasyon testi) tüm koleksiyonlar üzerinde bir tarama başlatırdı.
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  fixInvalidRoleAssignments(process.argv.includes('--apply')).catch((err) => {
    console.error('Düzeltme hatası:', err);
    process.exit(1);
  });
}
