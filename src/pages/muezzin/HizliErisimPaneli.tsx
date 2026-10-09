import { motion } from 'motion/react';
import { Compass, Navigation } from 'lucide-react';
import { hapticMedium } from '../../lib/haptic';

interface HizliErisimPaneliProps {
  gpsEnabled: boolean;
  gpsLoading: boolean;
  onGpsToggle: () => void;
  onQiblaOpen: () => void;
}

/**
 * Hızlı Erişim Kontrol Paneli — hero kolonunun altındaki GPS vakit senkronu
 * ve Kıble pusulası düğme ikilisi.
 *
 * MuezzinAnaEkran.tsx'ten FE-001 bileşenleme çalışmasında çıkarıldı; JSX ve
 * animasyon değerleri birebir korundu (görsel regresyon sıfır fark hedefi).
 */
export function HizliErisimPaneli({ gpsEnabled, gpsLoading, onGpsToggle, onQiblaOpen }: HizliErisimPaneliProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.45 }}
      className="w-full p-3 spatial-glass rounded-card border border-[var(--glass-border)] grid grid-cols-2 gap-2 shadow-[var(--spatial-shadow)]"
    >
      {/* GPS Senkronizasyonu */}
      <button
        onClick={() => {
          hapticMedium();
          onGpsToggle();
        }}
        disabled={gpsLoading}
        className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl transition-all duration-300 relative group cursor-pointer border-none bg-transparent"
      >
        {/* Önceden opacity-0 group-hover:opacity-100 idi — dolgu dokunmatik
            cihazda hiç görünmüyordu, buton dinlenme halinde ikon+metinden
            ibaret kalıyordu (bkz. görsel tasarım denetimi V19). Dolgu artık
            her zaman görünür (zaten çok soluk, 4%/10% alfa); hover yalnızca
            ikon/metin renk geçişleri gibi ek bir cila katıyor. */}
        <div
          className={`absolute inset-0 rounded-2xl transition-colors duration-500 ${
            gpsEnabled ? 'bg-emerald-500/10' : 'bg-[var(--text-primary)]/[0.04]'
          }`}
        />

        <div
          className={`p-1.5 rounded-xl border transition-all duration-300 relative ${
            gpsEnabled
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
              : 'bg-[var(--text-primary)]/[0.03] border-[var(--glass-border)] text-muted group-hover:text-[var(--text-secondary)]/85'
          }`}
        >
          {gpsLoading ? (
            <div className="w-4 h-4 rounded-full border-2 border-[var(--dynamic-aura,var(--aura-indigo))]/20 border-t-[var(--dynamic-aura,var(--aura-indigo))] animate-spin" />
          ) : (
            <Navigation size={15} className={`transition-transform duration-300 ${gpsEnabled ? 'rotate-45' : 'group-hover:-rotate-12'}`} />
          )}
          {gpsEnabled && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
          )}
        </div>

        <div className="flex flex-col items-start leading-tight">
          <span
            className={`text-2xs font-bold tracking-wide transition-colors ${
              gpsEnabled ? 'text-emerald-400' : 'text-muted group-hover:text-[var(--text-secondary)]/80'
            }`}
          >
            GPS VAKİT
          </span>
          <span className="text-2xs text-muted group-hover:text-[var(--text-secondary)]/60 uppercase">
            {gpsEnabled ? 'Aktif' : 'Pasif'}
          </span>
        </div>
      </button>

      {/* Kıble Pusulası */}
      <button
        onClick={() => {
          hapticMedium();
          onQiblaOpen();
        }}
        className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl transition-all duration-300 relative group cursor-pointer border-none bg-transparent"
      >
        <div className="absolute inset-0 rounded-2xl transition-colors duration-500 bg-[var(--text-primary)]/[0.04]" />

        <div className="p-1.5 rounded-xl border bg-[var(--text-primary)]/[0.03] border-[var(--glass-border)] text-muted group-hover:text-[var(--text-secondary)]/85 group-hover:border-[var(--dynamic-aura,var(--aura-indigo))]/30 transition-all duration-300">
          <Compass size={15} className="transition-transform duration-500 group-hover:rotate-180" />
        </div>

        <div className="flex flex-col items-start leading-tight">
          <span className="text-2xs font-bold tracking-wide text-muted group-hover:text-[var(--text-secondary)]/80">KIBLE</span>
          <span className="text-2xs text-muted group-hover:text-[var(--text-secondary)]/60 uppercase">Pusula</span>
        </div>
      </button>
    </motion.div>
  );
}
