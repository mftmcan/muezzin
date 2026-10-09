import { motion } from 'motion/react';
import { ChevronRight, ClipboardList } from 'lucide-react';
import { EASE } from '../../lib/motion';
import { VAKIT_GORA_ISIMLERI, toTurkishUpperCase } from '../../lib/dateUtils';
import { Vakit, Bildirim } from '../../types';

/**
 * "Sıradaki görevim" sinyal kartı — MuezzinAnaEkran hero kolonunda, vakit
 * geri sayımının hemen altında. Kullanıcıyı görev akışına (`#gorev-akisi`)
 * kaydıran tek düğme.
 *
 * MuezzinAnaEkran.tsx'ten FE-001 bileşenleme çalışmasında çıkarıldı; JSX ve
 * animasyon değerleri birebir korundu (görsel regresyon sıfır fark hedefi).
 * Dosya adı ASCII (kod tabanı kuralı, bkz. admin modülleri).
 */
export function SiradakiGorevSinyali({ siradakiGorev }: { siradakiGorev: Bildirim | null }) {
  if (!siradakiGorev) return null;

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.12, ease: EASE.out }}
      onClick={() => document.getElementById('gorev-akisi')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      className="w-full spatial-glass p-5 sm:p-6 border border-[var(--dynamic-aura,var(--aura-indigo))]/20 bg-[var(--dynamic-aura,var(--aura-indigo))]/[0.025] flex items-center justify-between gap-4 text-left cursor-pointer hover:bg-[var(--dynamic-aura,var(--aura-indigo))]/[0.045] transition-all"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-12 h-12 rounded-panel bg-[var(--dynamic-aura,var(--aura-indigo))]/10 border border-[var(--dynamic-aura,var(--aura-indigo))]/20 text-[var(--dynamic-aura,var(--aura-indigo))] flex items-center justify-center shrink-0">
          <ClipboardList size={20} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <p className="authority-title !text-2xs text-[var(--dynamic-aura,var(--aura-indigo))]/80 font-bold tracking-wide uppercase">
            Sıradaki görevim
          </p>
          <h3 className="text-base sm:text-lg font-light text-[var(--text-primary)] tracking-tight truncate">
            {toTurkishUpperCase(VAKIT_GORA_ISIMLERI[siradakiGorev.vakit as Vakit] || siradakiGorev.vakit)} vakti -{' '}
            {siradakiGorev.tip === 'asil' ? 'Asil görev' : siradakiGorev.tip === 'yedek' ? 'Yedek nöbet' : 'Acil çağrı'}
          </h3>
        </div>
      </div>
      <ChevronRight size={18} className="text-[var(--text-secondary)]/45 shrink-0" />
    </motion.button>
  );
}
