import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { HaftaPlan } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { useChangeKey } from './useChangeKey';

import { SizeLimitedCache } from '../lib/cache';

// Sayfa geçişlerinde skeleton 'zıplamasını' engellemek için Global Memory Cache
const globalHaftaPlanCache = new SizeLimitedCache<string, HaftaPlan & { id: string }>(10);

export function useHaftaPlan(haftaId: string) {
  const [plan, setPlan] = useState<(HaftaPlan & { id: string }) | null>(() => globalHaftaPlanCache.get(haftaId) || null);
  const [loading, setLoading] = useState(!globalHaftaPlanCache.has(haftaId));
  // EN SON snapshot sunucudan mı (fromCache: false) geldi? `!plan` negatifine
  // yalnızca bu true'yken güvenilebilir — gerekçe: src/lib/planSelfHealing.ts.
  // `globalHaftaPlanCache` (yalnızca bellek-içi UI önbelleği) bu bayrağı ASLA
  // besleyemez, bu yüzden her zaman false'tan başlar.
  const [sunucudanDogrulandi, setSunucudanDogrulandi] = useState(false);

  if (useChangeKey(haftaId)) {
    setPlan(haftaId ? globalHaftaPlanCache.get(haftaId) || null : null);
    setLoading(haftaId ? !globalHaftaPlanCache.has(haftaId) : false);
    setSunucudanDogrulandi(false);
  }

  useEffect(() => {
    if (!haftaId) {
      return;
    }

    // `includeMetadataChanges: true` ŞART: varsayılan modda onSnapshot
    // yalnızca VERİ değiştiğinde tetiklenir. Belge yokken önce önbellekten
    // ("yok", fromCache: true) bir snapshot gelir; sunucu da "yok" dediğinde
    // veri DEĞİŞMEDİĞİNDEN callback bir daha hiç çağrılmaz ve fromCache: false
    // durumu asla görülmezdi — self-healing meşru durumda da hiç
    // tetiklenemezdi.
    const unsubPlan = onSnapshot(
      doc(db, 'haftaPlanlari', haftaId),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (snapshot.exists()) {
          const data = { id: snapshot.id, ...snapshot.data() } as HaftaPlan & { id: string };
          globalHaftaPlanCache.set(haftaId, data);
          setPlan(data);
        } else {
          globalHaftaPlanCache.delete(haftaId);
          setPlan(null);
        }
        // Bilinçli olarak "yapışkan" DEĞİL: bağlantı kopup dinleyici yeniden
        // önbellekten beslenmeye başlarsa (fromCache: true) bayrak tekrar
        // false'a döner ve self-healing yeniden kilitlenir.
        setSunucudanDogrulandi(!snapshot.metadata.fromCache);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `haftaPlanlari/${haftaId}`);
        setSunucudanDogrulandi(false);
        setLoading(false);
      }
    );

    return () => unsubPlan();
  }, [haftaId]);

  return { plan, loading, sunucudanDogrulandi };
}
