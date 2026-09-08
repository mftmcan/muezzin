import { create } from 'zustand';
import { collection, doc, onSnapshot, query, orderBy, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AdminUyarisi } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { telemetryService } from '../services/telemetryService';

interface KrizAlarmlariState {
  alarmlar: (AdminUyarisi & { id: string })[];
  cozulmamisSayisi: number;
  loading: boolean;
  initialized: boolean;
  /** `initialized`den AYRI bir bayrak — `initialized` yalnızca BAŞARILI ilk
   * yüklemede true olur (HS-O1 retry mekanizması bunu gerektirir). Bu
   * bayrak init() çağrıldığı anda SENKRON true olur, ilk snapshot henüz
   * gelmemişken (onSnapshot asenkron) `isAdmin` hızlı false→true→false→true
   * geçişi yaparsa (AdminPanel.tsx) init()'in tekrar çağrılıp İKİNCİ bir
   * dinleyici açmasını engeller (düşük öncelikli bulgu). */
  initializing: boolean;
  /** adminUyarilari dinleyicisi hata verdiğinde dolar (bkz. kod denetimi —
   * önceden hata console.error'a düşüp hiçbir yere yazılmıyordu, admin boş
   * listeyi "uyarı yok" sanıyordu). */
  error: string | null;
  init: () => () => void;
  /** Bir nöbet uyarısını çözüldü olarak işaretler ve denetim izine kaydeder. */
  alarmCoz: (id: string, auditBaslik: string, auditDetay: string) => Promise<void>;
}

// Admin paneli içinde birden fazla bileşen (AdminPanel rozet sayacı,
// ExecutiveHeroScreen dashboard'u, KrizAlarmlari drawer'ı) aynı anda monte
// olabiliyor. Her biri kendi onSnapshot'ını açan bir hook yerine, tek bir
// paylaşılan abonelik burada tutulur.
export const useKrizAlarmlariStore = create<KrizAlarmlariState>((set, get) => ({
  alarmlar: [],
  cozulmamisSayisi: 0,
  loading: true,
  initialized: false,
  initializing: false,
  error: null,

  init: () => {
    if (get().initialized || get().initializing) return () => {};
    set({ initializing: true });

    const q = query(collection(db, 'adminUyarilari'), orderBy('olusturmaTarihi', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let activeCount = 0;
        const data = snapshot.docs.map((doc) => {
          const d = doc.data();
          if (!d.cozuldu) activeCount++;
          return { id: doc.id, ...d } as AdminUyarisi & { id: string };
        });

        // Çözülmemişler önce, ardından tarihe göre azalan sıra
        data.sort((a, b) => {
          if (a.cozuldu === b.cozuldu) return 0;
          return a.cozuldu ? 1 : -1;
        });

        set({ alarmlar: data, cozulmamisSayisi: activeCount, loading: false, initializing: false, initialized: true, error: null });
      },
      (err) => {
        // handleFirestoreError'ın DÖNÜŞ değeri (ham SDK mesajını kullanıcıya
        // uygun Türkçe metne çeviren) kullanılır — ham err.message değil,
        // aksi halde "Missing or insufficient permissions" gibi ham İngilizce
        // SDK metni doğrudan admin'e sızabilir (bkz. firestore-errors.ts).
        const friendly = handleFirestoreError(err, OperationType.LIST, 'adminUyarilari');
        // `initialized:true` YAZILMAZ (bkz. useAdminIzinlerStore.ts'teki AYNI
        // düzeltme, premium hata analizi HS-O1) — dinleyici hata sonrası
        // kalıcı öldüğünden, bunu yazmak store'u oturum boyunca kilitliyordu.
        set({ loading: false, initializing: false, error: friendly.message });
        setTimeout(() => {
          if (!get().initialized) get().init();
        }, 15000);
      }
    );

    return unsubscribe;
  },

  alarmCoz: async (id, auditBaslik, auditDetay) => {
    const path = `adminUyarilari/${id}`;
    try {
      await updateDoc(doc(db, 'adminUyarilari', id), { cozuldu: true, cozulmeTarihi: new Date() });
      await telemetryService.logAudit(auditBaslik, id, auditDetay);
    } catch (err) {
      throw handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },
}));
