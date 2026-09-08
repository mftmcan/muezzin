import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { VekaletTalebi } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { useChangeKey } from './useChangeKey';

/** Oturum sahibine yönelik, henüz karar verilmemiş gelen vekalet tekliflerini canlı dinler. */
export function useGelenVekaletler(uid: string | undefined) {
  const [gelenVekaletler, setGelenVekaletler] = useState<(VekaletTalebi & { id: string })[]>([]);

  if (useChangeKey(uid)) {
    setGelenVekaletler([]);
  }

  useEffect(() => {
    if (!uid) return;

    const q = query(collection(db, 'vekalet_talepleri'), where('aliciUid', '==', uid), where('durum', '==', 'beklemede'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setGelenVekaletler(snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as VekaletTalebi) })));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'vekalet_talepleri');
      }
    );

    return () => unsubscribe();
  }, [uid]);

  return gelenVekaletler;
}
