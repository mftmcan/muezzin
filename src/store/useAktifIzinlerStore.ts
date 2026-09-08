import { create } from 'zustand';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Izin } from '../types';
import { getTurkeyDateString } from '../lib/dateUtils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

interface AktifIzinlerState {
  aktifIzinler: Izin[];
  loading: boolean;
  initialized: boolean;
  dateKey: string;
  init: () => () => void;
}

/**
 * Aktif (bugün için onaylı) izinlere birden fazla bileşen aynı anda ihtiyaç
 * duyabiliyor — bkz. useBugunPlanDurumu.ts (ana ekranda her zaman aktif) ve
 * GorevKarti.tsx (bugünkü görev listesindeki HER kart). Önceden bu, ayrı bir
 * `useAktifIzinler` hook'uydu ve her çağıran kendi `onSnapshot`'ını VE kendi
 * bağımsız 60sn "gün değişti mi" zamanlayıcısını açıyordu — bir kullanıcının
 * bugün 2 görevi varsa aynı sorguya 3 bağımsız dinleyici + 3 bağımsız
 * zamanlayıcı anlamına geliyordu (bkz. performans denetimi). Diğer paylaşılan
 * store'larla (useAdminIzinlerStore, useKrizAlarmlariStore, useVakitStore)
 * AYNI desene taşındı: tek abonelik, tek zamanlayıcı, `initialized` guard'ı.
 */
export const useAktifIzinlerStore = create<AktifIzinlerState>((set, get) => ({
  aktifIzinler: [],
  loading: true,
  initialized: false,
  dateKey: getTurkeyDateString(),

  init: () => {
    if (get().initialized) return () => {};
    set({ initialized: true });

    let cleanup: (() => void) | null = null;

    const subscribe = (dateStr: string) => {
      cleanup?.();
      const path = 'izinler';
      const q = query(collection(db, path), where('durum', '==', 'onaylandi'), where('bitis', '>=', dateStr));
      cleanup = onSnapshot(
        q,
        (snapshot) => {
          const activeAndFuture = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Izin[];
          // Firestore sorgusu yalnızca `bitis >= bugün` filtresi uygulayabiliyor
          // (bileşik aralık sorgusu Firestore'da desteklenmiyor) — `baslangic`
          // filtresi istemci tarafında uygulanır, henüz başlamamış (ileri
          // tarihli) onaylı izinler "aktif" sayılmasın diye.
          const active = activeAndFuture.filter((izin) => dateStr >= izin.baslangic);
          set({ aktifIzinler: active, loading: false });
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, path);
          set({ loading: false });
          // onSnapshot hata callback'i dinleyiciyi KALICI olarak sonlandırır
          // (SDK otomatik yeniden bağlanmaz) — bir sonraki gün-değişimi
          // kontrolüne kadar (60sn periyodik, ama gün değişmediği sürece asla
          // tetiklenmez) yeniden abone olunmuyordu; geçici bir bağlantı
          // sorunu store'u oturum boyunca bayat bırakabiliyordu (premium hata
          // analizi HS-O1). En son bilinen dateKey ile yeniden dener.
          setTimeout(() => subscribe(get().dateKey), 15000);
        }
      );
    };

    subscribe(get().dateKey);

    // Gece yarısı geçişini yakalamak için periyodik kontrol — bkz.
    // useVakitStore.ts'teki AYNI desen.
    const interval = setInterval(() => {
      const nowStr = getTurkeyDateString();
      if (get().dateKey !== nowStr) {
        set({ dateKey: nowStr });
        subscribe(nowStr);
      }
    }, 60_000);

    return () => {
      cleanup?.();
      clearInterval(interval);
    };
  },
}));
