import { doc, getDocs, collection, setDoc, Timestamp, query, where, documentId } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getTurkeyNow } from '../lib/dateUtils';
import { aylikVakitleriCek, aylikVakitleriGrupla } from './ezanVaktiServisi';
import { AylikVakitler, SystemSettings } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

export type VakitCacheKaydi = AylikVakitler & { id: string };

// Firestore'da dogrudan "prefix sorgusu" yok - bir dizi araligi (id >=
// prefix ve id < prefix + en yuksek olasi karakter) ile taklit edilir.
// String.fromCharCode(0xf8ff) Unicode ozel-kullanim alaninda pratikte en
// yuksek kod noktasi; bu kalip Firestore'un kendi dokumantasyonunda
// onerilen standart idiyomdur.
const PREFIX_QUERY_UPPER_BOUND_CHAR = String.fromCharCode(0xf8ff);

/**
 * `vakitler` doc id'leri `${ilceId}_${yil-ay}` şeklindedir; koleksiyonda hiçbir
 * zaman temizlenmeyen bir geçmiş birikir — cami ilçe kodu bir gün değişirse
 * eski ilçenin kayıtları burada kalıcı olarak kalır. `ilceId` verildiğinde
 * yalnızca o ilçeye ait kayıtlar döner; verilmezse (geriye dönük uyumluluk
 * için) tüm kayıtlar döner.
 */
export async function listeleVakitCacheleri(ilceId?: string): Promise<VakitCacheKaydi[]> {
  try {
    // ilceId verildiğinde (gerçek çağıranların TAMAMI verir) önceden tüm
    // koleksiyon çekilip istemci tarafında filtreleniyordu — artık doc id
    // aralık sorgusuyla sunucu tarafında filtreleniyor (bkz. premium
    // denetim, bölüm 17).
    const baseCollection = collection(db, 'vakitler');
    const snapshot = ilceId
      ? await getDocs(
          query(
            baseCollection,
            where(documentId(), '>=', `${ilceId}_`),
            where(documentId(), '<', `${ilceId}_${PREFIX_QUERY_UPPER_BOUND_CHAR}`)
          )
        )
      : await getDocs(baseCollection);
    const data = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    })) as VakitCacheKaydi[];

    return data.sort((a, b) => b.id.localeCompare(a.id));
  } catch (err) {
    // Önceden hatalar sarmalanmadan (handleFirestoreError'dan geçmeden)
    // doğrudan fırlatılıyordu — çağıran (EzanOnbellegi.tsx) sabit bir
    // Türkçe mesajla yutuyordu ama telemetryService.logError'a hiç
    // ulaşmıyordu; en yüksek "blast-radius"lı ekranlardan birinde üretim
    // hataları admin'in kendi "Sistem Logları" ekranında görünmüyordu.
    throw handleFirestoreError(err, OperationType.LIST, 'vakitler');
  }
}

/**
 * API'nin bugünden itibaren döndürdüğü kayan pencereyi TEK bir çağrıyla
 * çekip gerçek takvim aylarına göre böler ve ortaya çıkan HER ay doc'unu
 * ayrı ayrı senkronize eder — eskiden bu fonksiyon `senkronizeVakitCacheAyi`'yi
 * "bu ay" ve "gelecek ay" için ayrı ayrı (gereksiz iki API isteğiyle)
 * çağırıyordu; ikisi de AYNI karışık pencereyi alıp kendi doc'una tam
 * olarak yazıyordu (bkz. mimari denetim O5).
 */
export async function senkronizeGuncelVeGelecekAyCache(settings: Pick<SystemSettings, 'ilceId' | 'ilceAdi'>) {
  try {
    const bugun = getTurkeyNow();
    const apiVerisi = await aylikVakitleriCek(bugun.getFullYear(), bugun.getMonth() + 1, settings.ilceId, settings.ilceAdi);
    const gruplar = aylikVakitleriGrupla(apiVerisi);

    return await Promise.all(
      Object.entries(gruplar).map(async ([ayId, grup]) => {
        const docId = `${settings.ilceId}_${ayId}`;
        const data = { ...grup, guncellenmeTarihi: Timestamp.now() };
        await setDoc(doc(db, 'vakitler', docId), data, { merge: true });
        return { docId, data };
      })
    );
  } catch (err) {
    throw handleFirestoreError(err, OperationType.WRITE, `vakitler/${settings.ilceId}_*`);
  }
}
