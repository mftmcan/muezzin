import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Calendar, ClipboardList } from 'lucide-react';
import { EASE } from '../../lib/motion';

interface BentoNavigasyonProps {
  haftalikOzet: { toplam: number; tamamlanan: number; bekleyen: number };
}

/**
 * Bento gezinme ızgarası — içerik kolonunun altındaki "Haftalık Plan" ve
 * "Haftalık Görev Özeti" kartları.
 *
 * MuezzinAnaEkran.tsx'ten FE-001 bileşenleme çalışmasında çıkarıldı; JSX ve
 * animasyon değerleri birebir korundu (görsel regresyon sıfır fark hedefi).
 */
export function BentoNavigasyon({ haftalikOzet }: BentoNavigasyonProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.32, ease: EASE.out }}
      >
        <Link
          to="/takvim"
          className="h-full p-6 spatial-glass hover:bg-[var(--text-primary)]/[0.015] hover:border-[var(--text-primary)]/10 dark:hover:border-[var(--text-primary)]/15 hover:shadow-[var(--spatial-shadow)] transition-all duration-500 flex flex-col justify-between relative overflow-hidden shimmer-trigger group/cal"
        >
          <div className="kinetic-sheen" />
          <div className="w-12 h-12 rounded-2xl bg-[var(--text-primary)]/[0.04] border border-[var(--glass-border)] flex items-center justify-center group-hover/cal:scale-105 group-hover/cal:bg-[var(--text-primary)]/[0.08] transition-all duration-500 mb-6">
            <Calendar size={20} className="text-muted group-hover/cal:text-[var(--text-secondary)]/85 transition-colors duration-500" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-light text-[var(--text-primary)] group-hover/cal:font-normal transition-all duration-500">
              Haftalık Plan
            </h3>
            <p className="text-2xs text-muted mt-1.5 uppercase tracking-wide leading-none">Koordinasyon Takvimi</p>
          </div>
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.38, ease: EASE.out }}
      >
        <Link
          to="/profil"
          className="h-full p-6 spatial-glass hover:bg-[var(--text-primary)]/[0.015] hover:border-[var(--text-primary)]/10 dark:hover:border-[var(--text-primary)]/15 hover:shadow-[var(--spatial-shadow)] transition-all duration-500 flex flex-col justify-between relative overflow-hidden shimmer-trigger group/prof"
        >
          <div className="kinetic-sheen" />
          <div className="w-12 h-12 rounded-2xl bg-[var(--text-primary)]/[0.04] border border-[var(--glass-border)] flex items-center justify-center group-hover/prof:scale-105 group-hover/prof:bg-[var(--text-primary)]/[0.08] transition-all duration-500 mb-6">
            <ClipboardList
              size={20}
              className="text-muted group-hover/prof:text-[var(--text-secondary)]/85 transition-colors duration-500"
              strokeWidth={1.7}
            />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-light text-[var(--text-primary)] group-hover/prof:font-normal transition-all duration-500">
              Haftalık Görev Özeti
            </h3>
            <p className="text-2xs text-muted mt-1.5 uppercase tracking-wide leading-none">
              {haftalikOzet.toplam} görev • {haftalikOzet.tamamlanan} tamamlandı • {haftalikOzet.bekleyen} bekliyor
            </p>
          </div>
        </Link>
      </motion.div>
    </div>
  );
}
