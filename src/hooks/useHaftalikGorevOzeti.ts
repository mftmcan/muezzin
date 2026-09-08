import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { addDays, format, startOfWeek } from 'date-fns';
import { db } from '../lib/firebase';
import { Bildirim } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { useChangeKey } from './useChangeKey';

interface HaftalikOzet {
  toplam: number;
  bekleyen: number;
  tamamlanan: number;
}

const BOS_OZET: HaftalikOzet = { toplam: 0, bekleyen: 0, tamamlanan: 0 };

/** Oturum sahibinin, `bugunDate`nin içinde bulunduğu haftaya ait görev özetini (toplam/bekleyen/tamamlanan) canlı dinler. */
export function useHaftalikGorevOzeti(uid: string | undefined, bugunDate: Date): HaftalikOzet {
  const [haftalikOzet, setHaftalikOzet] = useState<HaftalikOzet>(BOS_OZET);

  if (useChangeKey(uid)) {
    setHaftalikOzet(BOS_OZET);
  }

  useEffect(() => {
    if (!uid) return;

    const haftaBaslangic = startOfWeek(bugunDate, { weekStartsOn: 1 });
    const haftaBitis = addDays(haftaBaslangic, 6);
    const q = query(
      collection(db, 'bildirimler'),
      where('uid', '==', uid),
      where('tarih', '>=', format(haftaBaslangic, 'yyyy-MM-dd')),
      where('tarih', '<=', format(haftaBitis, 'yyyy-MM-dd'))
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => doc.data() as Bildirim);
        setHaftalikOzet({
          toplam: data.length,
          bekleyen: data.filter((g) => g.durum === 'bekliyor').length,
          tamamlanan: data.filter((g) => g.durum === 'onaylandi' || g.durum === 'okundu_varsayilan' || g.durum === 'sistem_atadi').length,
        });
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'bildirimler');
      }
    );

    return () => unsubscribe();
  }, [uid, bugunDate]);

  return haftalikOzet;
}
