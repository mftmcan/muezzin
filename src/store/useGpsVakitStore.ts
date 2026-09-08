import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GunlukVakit } from '../types';
import { konumVakitleriniCek } from '../services/gpsVakitServisi';
import { getTurkeyDateString } from '../lib/dateUtils';

interface GpsVakitState {
  gpsEnabled: boolean;
  gpsLoading: boolean;
  gpsCoords: { latitude: number; longitude: number } | null;
  gpsVakitler: GunlukVakit | null;
  gpsKonumAdi: string | null;
  /** "Bugün zaten taze veri çektik mi" önbellek kilidi — Türkiye'nin
   *  takvim gününe göre karşılaştırılır (aşağıdaki refreshGpsVakitler).
   *  GunlukVakit.tarih (konum bazlı vakitlerin `tarih` alanı) de artık
   *  HER ZAMAN Türkiye tarihini taşıyor (bkz. gpsVakitServisi.ts —
   *  konumun kendi yerel günü DEĞİL; bu oturumda önceki bir "yerel gün"
   *  denemesi useEzanVakitleri.ts'in tazelik kontrolünü bozduğu için geri
   *  alınmıştı), yani ikisi artık fiilen aynı kaynağı yansıtıyor —
   *  yine de her biri kendi `getTurkeyDateString()` çağrısıyla bağımsız
   *  hesaplanır (birbirine türetilmiş değildir), bu yüzden ayrı alanlar
   *  olarak tutulmaya devam ediyor. */
  lastFetchDate: string | null;
  enableGps: () => Promise<void>;
  disableGps: () => void;
  refreshGpsVakitler: () => Promise<void>;
}

export const useGpsVakitStore = create<GpsVakitState>()(
  persist(
    (set, get) => ({
      gpsEnabled: false,
      gpsLoading: false,
      gpsCoords: null,
      gpsVakitler: null,
      gpsKonumAdi: null,
      lastFetchDate: null,

      enableGps: async () => {
        if (typeof window === 'undefined' || !('geolocation' in navigator)) {
          throw new Error('Cihazınız konum özelliğini desteklemiyor.');
        }

        set({ gpsLoading: true });

        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0,
            });
          });

          const { latitude, longitude } = position.coords;
          const result = await konumVakitleriniCek(latitude, longitude);

          set({
            gpsEnabled: true,
            gpsLoading: false,
            gpsCoords: { latitude, longitude },
            gpsVakitler: result.vakitler,
            gpsKonumAdi: result.konumAdi,
            // result.date'ten TÜRETİLMEDEN bağımsızca hesaplanır — bkz.
            // yukarıdaki lastFetchDate alan yorumu.
            lastFetchDate: getTurkeyDateString(),
          });
        } catch (err) {
          set({ gpsLoading: false });
          throw err;
        }
      },

      disableGps: () => {
        set({
          gpsEnabled: false,
          // Uçuşta bir istek varken GPS kapatılırsa kilit takılı kalmasın
          // (savunma derinliği — asıl kök neden aşağıdaki `partialize`).
          gpsLoading: false,
          gpsCoords: null,
          gpsVakitler: null,
          gpsKonumAdi: null,
          lastFetchDate: null,
        });
      },

      refreshGpsVakitler: async () => {
        const { gpsEnabled, gpsCoords, lastFetchDate, gpsLoading } = get();
        if (!gpsEnabled || !gpsCoords) return;

        const bugunStr = getTurkeyDateString();
        // Skip calling if already updated today to save API requests
        if (lastFetchDate === bugunStr) return;
        // Uçuş halinde bir istek zaten varsa ikinci bir eşzamanlı istek
        // başlatma — `lastFetchDate` yalnızca istek TAMAMLANDIĞINDA
        // yazıldığından, 60sn'lik periyodik tetikleyici (useDashboardLogic.ts)
        // yavaş bir ağda önceki istek bitmeden tekrar çağrılabiliyordu
        // (düşük öncelikli bulgu — gereksiz dış API trafiği + gpsLoading
        // titremesi).
        if (gpsLoading) return;

        set({ gpsLoading: true });
        try {
          const result = await konumVakitleriniCek(gpsCoords.latitude, gpsCoords.longitude);
          set({
            gpsLoading: false,
            gpsVakitler: result.vakitler,
            gpsKonumAdi: result.konumAdi,
            // Türkiye takvim günü — result.date (konumun kendi yerel günü)
            // DEĞİL, bkz. lastFetchDate alan yorumu.
            lastFetchDate: bugunStr,
          });
        } catch (err) {
          console.error('GPS vakitleri güncellenemedi:', err);
          set({ gpsLoading: false });
        }
      },
    }),
    {
      name: 'muezzin-gps-vakit-storage',
      // `gpsLoading` UÇUŞTAKİ bir isteği temsil eden geçici bir bayrak —
      // kalıcılaştırılmamalı. `partialize` yokken tüm state (gpsLoading
      // dahil) yazılıyordu: sekme/uygulama tam da `refreshGpsVakitler`
      // sürerken kapatılırsa (ya da PWA öldürülürse) bayrak `true` olarak
      // saklanıyor, bir sonraki açılışta `true` olarak canlanıyor ve
      // `refreshGpsVakitler`'in "zaten uçuşta" kilidi (aşağıdaki
      // `if (gpsLoading) return;`) HER çağrıyı kalıcı olarak erken
      // döndürüyordu — GPS vakitleri bir daha asla tazelenmiyordu (bkz. kod
      // denetimi). Yalnızca gerçekten kalıcı olması gereken alanlar yazılır;
      // `gpsLoading` her açılışta varsayılanına (false) döner.
      partialize: (state) => ({
        gpsEnabled: state.gpsEnabled,
        gpsCoords: state.gpsCoords,
        gpsVakitler: state.gpsVakitler,
        gpsKonumAdi: state.gpsKonumAdi,
        lastFetchDate: state.lastFetchDate,
      }),
    }
  )
);
export default useGpsVakitStore;
