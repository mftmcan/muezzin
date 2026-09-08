import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Bildirim, Vakit } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { useChangeKey } from './useChangeKey';

import { SizeLimitedCache } from '../lib/cache';

// Sayfa geçişlerinde skeleton zıplamasını engellemek için Global Memory Cache
const globalVakitBildirimleriCache = new SizeLimitedCache<string, Bildirim[]>(50);

export function useVakitBildirimleri(tarih: string | undefined, vakit: Vakit | undefined) {
  const cacheKey = tarih && vakit ? `${tarih}_${vakit}` : '';
  const [bildirimler, setBildirimler] = useState<Bildirim[]>(() => globalVakitBildirimleriCache.get(cacheKey) || []);
  const [loading, setLoading] = useState(cacheKey ? !globalVakitBildirimleriCache.has(cacheKey) : false);

  if (useChangeKey(cacheKey)) {
    setBildirimler(globalVakitBildirimleriCache.get(cacheKey) || []);
    setLoading(cacheKey ? !globalVakitBildirimleriCache.has(cacheKey) : false);
  }

  useEffect(() => {
    if (!tarih || !vakit || !cacheKey) {
      return;
    }

    const q = query(collection(db, 'bildirimler'), where('tarih', '==', tarih), where('vakit', '==', vakit));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Bildirim, 'id'>) }) as Bildirim);
        globalVakitBildirimleriCache.set(cacheKey, data);
        setBildirimler(data);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'bildirimler');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tarih, vakit, cacheKey]);

  return { bildirimler, loading };
}
