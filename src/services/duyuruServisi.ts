import { addDoc, collection, deleteDoc, doc, FirestoreError, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Duyuru } from '../hooks/useDuyurular';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { telemetryService } from './telemetryService';
import { toTurkishUpperCase } from '../lib/dateUtils';

export function duyurularAbone(onData: (duyurular: Duyuru[]) => void, onError: (error: FirestoreError) => void): () => void {
  const q = query(collection(db, 'duyurular'), orderBy('tarih', 'desc'));
  return onSnapshot(q, (snapshot) => onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Duyuru)), onError);
}

export async function duyuruYayinla(data: { baslik: string; icerik: string; tip: Duyuru['tip'] }): Promise<void> {
  const path = 'duyurular';
  try {
    // bildirimGonderildi: false — scripts/duyuruBildirimGonder.ts (Admin SDK
    // cron) bu bayrağı push bildirimi gönderdikten sonra true'ya çevirir.
    // Yayın anında burada açıkça yazılması, o script'in sorgusunun sınırsız
    // büyüyen koleksiyonu taramak yerine tek bir eşitlik filtresiyle
    // (`== false`) yalnızca henüz bildirilmemiş duyuruları bulmasını sağlar
    // (bkz. Firebase/GitHub veri akışı optimizasyonu — mazeretDevirleriniyle
    // AYNI sınıf sorun, farklı çözüm: zaman penceresi yerine kaynağında
    // baştan sınırlı bir bayrak).
    await addDoc(collection(db, path), { ...data, tarih: Timestamp.now(), bildirimGonderildi: false });
    await telemetryService.logAudit(
      'Duyuru Yayınlama',
      data.baslik,
      `Yeni duyuru panoda paylaşıldı. Kategori: ${toTurkishUpperCase(data.tip)}`
    );
  } catch (err) {
    throw handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function duyuruSil(id: string, title: string): Promise<void> {
  const path = `duyurular/${id}`;
  try {
    await deleteDoc(doc(db, 'duyurular', id));
    await telemetryService.logAudit('Duyuru Silme', title, 'Yayınlanmış olan duyuru panodan kaldırıldı ve kalıcı olarak silindi.');
  } catch (err) {
    throw handleFirestoreError(err, OperationType.DELETE, path);
  }
}
