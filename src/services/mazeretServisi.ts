import {
  addDoc,
  collection,
  deleteDoc,
  DocumentData,
  DocumentSnapshot,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { Bildirim, Vakit } from '../types';
import { getHaftaIdFromDate, getTurkeyDateString, getTurkeyNow, parseVakitToDate } from '../lib/dateUtils';
import { mazeretKapaliMi, MazeretDurumu } from '../lib/mazeretKurallari';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { telemetryService } from './telemetryService';

async function getEzanVakti(tarih: string, vakit: string): Promise<Date | null> {
  const settingsDoc = await getDoc(doc(db, 'settings', 'system'));
  const ilceId = (settingsDoc.data()?.ilceId as string) || '9148';
  const monthKey = tarih.slice(0, 7);
  const vakitDoc = await getDoc(doc(db, 'vakitler', `${ilceId}_${monthKey}`));
  if (!vakitDoc.exists()) return null;
  const saat = vakitDoc.data()?.gunler?.[tarih]?.[vakit];
  if (typeof saat !== 'string') return null;
  return parseVakitToDate(tarih, saat);
}

/**
 * Mazeret/görev devri (vekalet) zaman penceresinin açık olup olmadığını
 * belirler — Cuma kısıtlaması ve 1 saatlik süre kısıtlamasının TEK ortak
 * uygulama noktası (bkz. src/lib/mazeretKurallari.ts, CLAUDE.md "Mazeret /
 * Cuma kısıtlaması"). `mazeretBildir` ve `vekaletServisi.ts`'teki
 * `vekaletTeklifEt`/`vekaletKabulEt` hepsi bunu çağırır — bildirim
 * belgesindeki (potansiyel olarak eski/eksik) `cumaMi` alanına GÜVENMEZ,
 * Cuma'yı `tarih`'ten taze türetir (bkz. mimari denetim K3/K4).
 */
export async function mazeretZamanKontrolYap(tarih: string, vakit: Vakit, ezanSaati?: string): Promise<MazeretDurumu> {
  const [gY, gM, gD] = tarih.split('-').map(Number);
  const gunTarihi = new Date(gY, gM - 1, gD);

  const vakitSaati = vakit === 'sabah' ? null : ezanSaati ? parseVakitToDate(tarih, ezanSaati) : await getEzanVakti(tarih, vakit);

  const oncekiGunYatsiSaati = vakit === 'sabah' ? await getEzanVakti(getTurkeyDateString(new Date(gY, gM - 1, gD - 1)), 'yatsi') : null;

  const referansSaatYok = vakit === 'sabah' ? !oncekiGunYatsiSaati : !vakitSaati;
  if (referansSaatYok) {
    // FAIL-CLOSED (kod denetimi): önceden bu durumda süre kısıtlaması hiç
    // uygulanmıyordu (`mazeretKapaliMi` `{ kapali: false }` dönüyordu). Artık
    // pencere KAPALI sayılır — hem burada hem sunucu tarafında (damga yoksa
    // firestore.rules yazımı reddeder). Telemetri olayı, verinin gerçekten
    // eksik olduğu (ör. ay henüz önbelleğe alınmamış) durumları görünür
    // tutmak için korunuyor.
    console.warn(`[mazeret] ${tarih} ${vakit} için ezan/yatsı saati bulunamadı/bozuk — pencere KAPALI sayılıyor (fail-closed).`);
    telemetryService.logEvent({
      eventType: 'performance',
      eventName: 'MAZERET_SURE_KISITLAMASI_ATLANDI',
      metadata: { tarih, vakit },
    });
  }

  return mazeretKapaliMi({ gunTarihi, vakit, vakitSaati, oncekiGunYatsiSaati }, getTurkeyNow());
}

async function dinamikGorevKontrolMekanizmasi(tarih: string, vakit: string, haricUidler: string[]): Promise<void> {
  const path = 'adminUyarilari';
  try {
    const mazeretGirisiVar = haricUidler.length > 0;

    const alarmSorgu = query(
      collection(db, 'adminUyarilari'),
      where('tarih', '==', tarih),
      where('vakit', '==', vakit),
      where('cozuldu', '==', false)
    );
    const alarmSnap = await getDocs(alarmSorgu);
    if (!alarmSnap.empty) return;

    await addDoc(collection(db, 'adminUyarilari'), {
      tip: 'zincirTukendi',
      mesaj: mazeretGirisiVar
        ? 'Mazeret sonrası yedek görevi devralamadı. Kural gereği ek görevli atanamaz; admin müdahalesi gerekir.'
        : 'Kritik Hata: Veri zinciri tükendi ve yedek görevli de uygun değil.',
      tarih,
      vakit,
      cozuldu: false,
      olusturmaTarihi: serverTimestamp(),
    });
  } catch (err) {
    throw handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Mazeret bildirimi, tek bir Firestore transaction'ı içinde şu iki adımı atomik
 * olarak yapar:
 *  1. Asil görevlinin kendi bildirimini 'reddedildi' yapar (kurallarda her zaman
 *     izinli olan bir self-update).
 *  2. Uygun bir yedek varsa, YALNIZCA O YEDEĞİN kendi bildirim belgesini
 *     'asil' rolüne terfi ettirir.
 *
 * Bu ikinci yazım normalde "başka birinin belgesini güncelleme" olduğu için
 * kurallarca reddedilir; ancak bildirim ID'leri deterministik olduğundan
 * (haftaId_tarih_vakit_tip), firestore.rules'daki `isBackupPromotionFromMazeret`
 * fonksiyonu getAfter() ile aynı transaction içindeki asil belgesinin gerçekten
 * 'reddedildi' durumuna geçtiğini doğrulayıp bu terfiye izin verir.
 *
 * haftaPlanlari senkronu ve (yedek bulunamazsa) admin alarmı, bu belge
 * çiftinin "devirSonucu" alanına bakan scripts/mazeretDevirleriniIsle.ts
 * uzlaştırma (reconciliation) işi tarafından ayrıca işlenir — o yazımlar
 * admin SDK gerektirir ve Spark planında istemciden yapılamaz.
 */
export async function mazeretBildir(bildirimId: string, retSebebi: string, ezanSaati?: string): Promise<void> {
  const bildirimRef = doc(db, 'bildirimler', bildirimId);

  try {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) throw new Error('Oturum bulunamadı.');

    const mevcutBildirimSnap = await getDoc(bildirimRef);
    if (!mevcutBildirimSnap.exists()) throw new Error('Bildirim bulunamadı.');
    const mevcutBildirim = mevcutBildirimSnap.data() as Bildirim;

    if (mevcutBildirim.uid !== currentUid) {
      throw new Error('Sadece kendi göreviniz için mazeret bildirebilirsiniz.');
    }
    if (mevcutBildirim.tip !== 'asil' && mevcutBildirim.tip !== 'yedek') {
      throw new Error('Mazeret bildirimi sadece asil veya yedek görevli tarafından yapılabilir.');
    }
    if (mevcutBildirim.durum !== 'bekliyor') {
      throw new Error('Sadece bekleyen görevler için mazeret bildirilebilir.');
    }

    const { haftaId, tarih, vakit, uid } = mevcutBildirim;

    const mazeretDurumu = await mazeretZamanKontrolYap(tarih, vakit, ezanSaati);
    if (mazeretDurumu.kapali) {
      throw new Error(mazeretDurumu.sebep ?? 'Mazeret bildirimi bu görev için kapalı.');
    }

    if (mevcutBildirim.tip === 'yedek') {
      // Yedek görevli mazeret bildiriyor — devralacak bir "yedeğin yedeği"
      // yok, bu yüzden asil'deki gibi bir terfi transaction'ı gerekmiyor.
      // Doğrudan kendi belgesini reddedildi yapar; admin uyarısı (bu vakit
      // artık yedeksiz kaldı) scripts/mazeretDevirleriniIsle.ts tarafından
      // devirSonucu:'alarm_bekliyor' üzerinden işlenir.
      //
      // retSebebi artık `bildirimler` belgesine YAZILMAZ — ayrı,
      // yalnızca kendisi+admin'in okuyabildiği mazeret_detaylari
      // koleksiyonuna gider (bkz. firestore.rules isSelfBildirimUpdate
      // yorumu, mimari denetim — altıncı tur). İki yazım AYNI batch'te
      // atomik olmalı — firestore.rules bu belgenin GERÇEKTEN aynı
      // commit'te yazıldığını getAfter() ile doğruluyor.
      const batch = writeBatch(db);
      batch.update(bildirimRef, {
        durum: 'reddedildi',
        pendingAck: false,
        devirSonucu: 'alarm_bekliyor',
        sonGuncelleme: serverTimestamp(),
      });
      batch.set(doc(db, 'mazeret_detaylari', bildirimId), {
        uid: currentUid,
        retSebebi,
        olusturmaTarihi: serverTimestamp(),
      });
      await batch.commit();
      return;
    }

    const yedekRef = doc(db, 'bildirimler', `${haftaId}_${tarih}_${vakit}_yedek`);

    await runTransaction(db, async (transaction) => {
      // Firestore transaction kuralı: tüm okumalar, tüm yazımlardan önce yapılmalı.
      const asilSnap = await transaction.get(bildirimRef);
      if (!asilSnap.exists()) throw new Error('Asil bildirim bulunamadı.');
      const asilData = asilSnap.data() as Bildirim;
      if (asilData.durum !== 'bekliyor') throw new Error('Bu görev için mazeret bildirilemez.');

      const yedekSnap = await transaction.get(yedekRef);
      const yedekData = yedekSnap.exists() ? (yedekSnap.data() as Bildirim) : null;

      let yedekUserSnap: DocumentSnapshot<DocumentData> | null = null;
      if (yedekData && yedekData.durum !== 'reddedildi' && yedekData.uid !== uid) {
        yedekUserSnap = await transaction.get(doc(db, 'muezzins', yedekData.uid));
      }

      const yedekUygun = !!(
        yedekData &&
        yedekUserSnap?.exists() &&
        yedekUserSnap.data()?.role === 'muezzin' &&
        yedekUserSnap.data()?.aktif === true
      );

      transaction.update(bildirimRef, {
        durum: 'reddedildi',
        pendingAck: false,
        devirSonucu: yedekUygun ? 'yedek_atandi' : 'alarm_bekliyor',
        sonGuncelleme: serverTimestamp(),
      });

      // retSebebi artık `bildirimler` belgesine YAZILMAZ — ayrı,
      // yalnızca kendisi+admin'in okuyabildiği mazeret_detaylari
      // koleksiyonuna, AYNI transaction içinde (bkz. firestore.rules
      // isSelfBildirimUpdate yorumu, mimari denetim — altıncı tur).
      transaction.set(doc(db, 'mazeret_detaylari', bildirimId), {
        uid: currentUid,
        retSebebi,
        olusturmaTarihi: serverTimestamp(),
      });

      // NOT ("1000 ifade tavanı" kök neden çözümü): yedeğin 'asil' rolüne
      // TERFİSİ eskiden BURADA, aynı transaction içinde yazılıyordu — bu,
      // firestore.rules'taki `isBackupPromotionFromMazeret`'in emülatörün
      // "1000 ifade" bütçesine çarpan ~27 terimlik çapraz-belge
      // doğrulamasını (asil belgenin GERÇEKTEN reddedildiğini getAfter() ile
      // doğrulama + atanabilirlik) gerektiriyordu. Artık istemci yedek
      // belgeye HİÇ dokunmuyor — yukarıdaki `devirSonucu: yedekUygun ?
      // 'yedek_atandi' : 'alarm_bekliyor'` yalnızca script için bir İPUCU
      // (yetkilendirici değil). Terfi, yedeğin uygunluğunu TAZE veriyle
      // yeniden doğrulayan scripts/mazeretDevirleriniIsle.ts'te, Admin SDK
      // ile (kural bütçesi yok) gerçekleşiyor; script'in bir sonraki
      // çalışmasına kadar (~10-15 dk) gecikmeli.
    });
  } catch (err) {
    throw handleFirestoreError(err, OperationType.WRITE, `bildirimler/${bildirimId}`);
  }
}

/** Arşivdeki bir geçmiş mazeret kaydını (bildirim belgesini) kalıcı olarak siler. */
export async function mazeretKaydiSil(id: string): Promise<void> {
  const path = `bildirimler/${id}`;
  try {
    await deleteDoc(doc(db, 'bildirimler', id));
  } catch (err) {
    throw handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function kriziBaslat(tarih: string, vakit: string, haricUidler: string[]): Promise<boolean> {
  const pathPrefix = 'bildirimler';
  try {
    const yedekQuery = query(
      collection(db, 'bildirimler'),
      where('tarih', '==', tarih),
      where('vakit', '==', vakit),
      where('tip', '==', 'yedek')
    );
    const yedekSnap = await getDocs(yedekQuery);
    const yedekDoc = yedekSnap.docs[0];
    const yedekData = yedekDoc?.data() as Bildirim | undefined;

    if (yedekData && !haricUidler.includes(yedekData.uid) && yedekData.durum !== 'reddedildi') {
      const yedekPersonelDoc = await getDoc(doc(db, 'muezzins', yedekData.uid));
      const yedekPersonel = yedekPersonelDoc.data() as { role?: string; aktif?: boolean } | undefined;
      if (!yedekPersonelDoc.exists() || yedekPersonel?.role !== 'muezzin' || yedekPersonel?.aktif !== true) {
        await dinamikGorevKontrolMekanizmasi(tarih, vakit, haricUidler);
        return false;
      }

      const haftaId = getHaftaIdFromDate(tarih);
      const planRef = doc(db, 'haftaPlanlari', haftaId);

      await runTransaction(db, async (transaction) => {
        const yedekRef = doc(db, 'bildirimler', yedekDoc.id);
        // Firestore kuralı: tüm okumalar tüm yazımlardan önce yapılmalı —
        // plan belgesi burada okunmazsa yoksa (nadir ama olası — bu manuel
        // bir admin müdahale yolu) transaction.update ham bir NOT_FOUND
        // fırlatıyordu (bkz. mimari denetim O2).
        const [currentYedekSnap, planSnap] = await Promise.all([transaction.get(yedekRef), transaction.get(planRef)]);
        if (!currentYedekSnap.exists() || currentYedekSnap.data()?.durum === 'reddedildi') {
          throw new Error('Yedek görevli artık uygun değil.');
        }
        if (!planSnap.exists()) {
          throw new Error('Bu haftaya ait plan belgesi bulunamadı.');
        }

        transaction.update(yedekRef, {
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          sonGuncelleme: serverTimestamp(),
        });

        // `.yedek` alanı 'Sistem'e çekilmezse, terfi eden kişi planda hem
        // asil hem yedek olarak görünmeye devam ediyordu — bu yüzden
        // tekKisiliGunleriBul bu günü yanlışlıkla yedekli sanıp hiçbir uyarı
        // üretmiyordu (bkz. mazeretDevirleriniIsle.ts'in aynı işi yaparken
        // her iki alanı da yazması, mimari denetim O2).
        transaction.update(planRef, {
          [`gunler.${tarih}.${vakit}.asil`]: yedekData.uid,
          [`gunler.${tarih}.${vakit}.yedek`]: 'Sistem',
        });
      });

      return true;
    }

    // Kural: aynı tarih/vakit için ek bir üçüncü görevli atanamaz.
    await dinamikGorevKontrolMekanizmasi(tarih, vakit, haricUidler);
    return false;
  } catch (err) {
    throw handleFirestoreError(err, OperationType.WRITE, pathPrefix);
  }
}
