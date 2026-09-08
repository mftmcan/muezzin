import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AdminUyarisi } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

/** Oturum sahibine (herhangi bir müezzine), çözülmemiş en güncel sistem
 * uyarısını canlı dinler — saha tarafının admin müdahalesi gereken bir
 * arızadan (ör. zincir tükenmesi) tamamen habersiz kalmaması için
 * (bkz. tasarım denetimi). Firestore kuralı yalnızca cozuldu==false olan
 * belgeleri müezzinlere açar; admin'e özel çözüm notları sızmaz. */
export function useAktifSistemUyarisi(uid: string | undefined) {
  const [uyari, setUyari] = useState<(AdminUyarisi & { id: string }) | null>(null);

  const [lastUid, setLastUid] = useState(uid);
  if (uid !== lastUid) {
    setLastUid(uid);
    setUyari(null);
  }

  useEffect(() => {
    if (!uid) return;

    // limit(1) DEĞİL: 'kotaUyarisi' (scripts/kotaKontrol.ts'in günlük Spark
    // kota tahmini) saha müezzinini hiç ilgilendirmeyen, aksiyona
    // dönüşmeyen teknik bir ihbardır — tek başına en güncel uyarı olsaydı
    // gerçek bir arızayı (ör. zincirTukendi) sahadan GİZLERDİ. Bu yüzden
    // birkaç kayıt okunup saha-dışı tipler eleniyor; sorgu aynı
    // (cozuldu, olusturmaTarihi) index'ini kullanmaya devam ediyor.
    const q = query(collection(db, 'adminUyarilari'), where('cozuldu', '==', false), orderBy('olusturmaTarihi', 'desc'), limit(5));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const doc = snapshot.docs.find((d) => (d.data() as AdminUyarisi).tip !== 'kotaUyarisi');
        setUyari(doc ? ({ id: doc.id, ...doc.data() } as AdminUyarisi & { id: string }) : null);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'adminUyarilari');
      }
    );

    return () => unsubscribe();
  }, [uid]);

  return uyari;
}
