import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

export interface Duyuru {
  id: string;
  baslik: string;
  icerik: string;
  tip: 'onemli' | 'bilgi' | 'duyuru';
  yazar?: string;
  tarih: import('firebase/firestore').Timestamp | string;
  /** scripts/duyuruBildirimGonder.ts'in idempotency bayrağı — bu duyuru için
   *  push bildirimi gönderildi mi. duyuruYayinla yayınlama anında `false`
   *  yazar. */
  bildirimGonderildi?: boolean;
}

export function useDuyurular(count = 3) {
  const [duyurular, setDuyurular] = useState<Duyuru[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const path = 'duyurular';
    const q = query(collection(db, path), orderBy('tarih', 'desc'), limit(count));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Duyuru[];
        setDuyurular(data);
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, path);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [count]);

  return { duyurular, loading };
}
