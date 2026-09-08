import { create } from 'zustand';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { SystemSettings } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

interface SystemSettingsState {
  settings: SystemSettings;
  loading: boolean;
  initialized: boolean;
  init: () => () => void;
  updateSettings: (newSettings: Partial<SystemSettings>) => Promise<boolean>;
}

const defaultSettings: SystemSettings = {
  ilceId: '9148',
  ilceAdi: 'Ceyhan',
  hicriDuzeltme: 0,
};

if (typeof globalThis !== 'undefined') {
  globalThis.__hicriOffset = 0;
}

export const useSystemSettingsStore = create<SystemSettingsState>((set, get) => ({
  settings: defaultSettings,
  loading: true,
  initialized: false,
  init: () => {
    if (get().initialized) return () => {};

    const unsub = onSnapshot(
      doc(db, 'settings', 'system'),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as SystemSettings;
          if (typeof globalThis !== 'undefined') {
            globalThis.__hicriOffset = data.hicriDuzeltme ?? 0;
          }
          set({ settings: { ...defaultSettings, ...data }, loading: false, initialized: true });
        } else {
          set({ loading: false, initialized: true });
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, 'settings/system');
        // `initialized:true` YAZILMAZ (bkz. useAdminIzinlerStore.ts'teki AYNI
        // düzeltme, premium hata analizi HS-O1) — dinleyici hata sonrası kalıcı
        // öldüğünden, bunu yazmak store'u oturum boyunca kilitliyordu.
        set({ loading: false });
        setTimeout(() => {
          if (!get().initialized) get().init();
        }, 15000);
      }
    );

    return unsub;
  },
  updateSettings: async (newSettings) => {
    try {
      const merged = { ...get().settings, ...newSettings };
      await setDoc(doc(db, 'settings', 'system'), merged, { merge: true });
      // Global offset YAZIMDAN SONRA güncellenir — önceden yazımdan ÖNCE
      // mutasyona uğruyordu, yani setDoc reddedilirse (permission-denied)
      // global hâlâ hiç kaydedilmemiş değerde kalıyordu; sunucudaki gerçek
      // değerle sessizce ayrışabiliyordu (düşük öncelikli bulgu).
      if (typeof globalThis !== 'undefined' && merged.hicriDuzeltme !== undefined) {
        globalThis.__hicriOffset = merged.hicriDuzeltme;
      }
      return true;
    } catch (error) {
      // `init()`'teki onSnapshot hatası zaten handleFirestoreError'dan geçip
      // telemetriye gidiyordu — bu catch yalnızca console.error yapıp ham
      // hatayı fırlatıyordu, error_logs'a hiç düşmüyordu (bkz. mimari
      // denetim, aynı dosyada iç tutarsızlık).
      throw handleFirestoreError(error, OperationType.UPDATE, 'settings/system');
    }
  },
}));
