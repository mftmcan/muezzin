import React, { useMemo } from 'react';
import { motion, type Variants } from 'motion/react';
import { Star, CheckCircle2, Eye } from 'lucide-react';
import { parseISO } from 'date-fns';
import { GorevKarti } from './GorevKarti';
import { EmptyState } from './ui/EmptyState';
import { Bildirim, GunlukVakit } from '../types';
import { getTurkeyNow, isFriday as isFridayTarih } from '../lib/dateUtils';
import { useOneShotAnimation } from '../hooks/useOneShotAnimation';
import { useAuthStore } from '../store/useAuthStore';
import { GOZLEMCI_SALT_OKUMA_IPUCU } from '../lib/rolMetinleri';

interface Props {
  loading: boolean;
  gorevler: Bildirim[];
  bugunVakitler: GunlukVakit | null;
  autoOpenMazeretId?: string | null;
  onMazeretHandled?: () => void;
}

export const KisiselGorevAkisi: React.FC<Props> = ({ loading, gorevler, bugunVakitler, autoOpenMazeretId, onMazeretHandled }) => {
  const shouldAnimate = useOneShotAnimation('kisisel-gorev-akisi');
  // Gözlemci rolü akışı görebilir ama hiçbir onay/mazeret/devir aksiyonunu
  // kullanamaz (bkz. premium denetim P1.5) — GorevKarti içindeki düğmeler
  // zaten devre dışı, buradaki tek satırlık şerit "neden" sorusunu kart
  // seviyesine inmeden yanıtlar.
  const isReadOnly = useAuthStore((s) => s.isReadOnly);

  const isFriday = useMemo(() => {
    if (bugunVakitler?.tarih) {
      return isFridayTarih(parseISO(bugunVakitler.tarih));
    }
    return isFridayTarih(getTurkeyNow());
  }, [bugunVakitler?.tarih]);

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: shouldAnimate ? 0.1 : 0,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: shouldAnimate ? 0.5 : 0, ease: 'easeOut' },
    },
  };

  return (
    <motion.section initial={shouldAnimate ? 'hidden' : false} animate="visible" variants={containerVariants} className="px-0">
      <motion.div variants={itemVariants} className="flex items-center gap-4 sm:gap-8 mb-8 sm:mb-12">
        <div
          className={`w-12 h-12 sm:w-16 sm:h-16 rounded-3xl bg-[var(--text-primary)]/[0.03] flex items-center justify-center border border-[var(--glass-border)] shadow-sm ${isFriday ? 'text-emerald-400' : 'text-[var(--dynamic-aura,var(--aura-indigo))]'}`}
        >
          <Star size={24} className="sm:size-8" strokeWidth={1.2} />
        </div>
        <div>
          <h2 className="text-2xl sm:text-4xl font-light text-[var(--text-primary)] tracking-tight leading-none">Kişisel Görevlerim</h2>
          <p className={`authority-title text-2xs mt-2.5 tracking-wide font-medium ${isFriday ? 'text-emerald-400/60' : 'opacity-40'}`}>
            BUGÜNKÜ GÖREV VE ONAY AKIŞI
          </p>
        </div>
      </motion.div>

      {isReadOnly && (
        <motion.div
          variants={itemVariants}
          className="mb-6 sm:mb-8 flex items-center gap-4 p-5 rounded-card spatial-glass border border-[var(--glass-border)] bg-[var(--text-primary)]/[0.015]"
        >
          <div className="w-10 h-10 rounded-2xl bg-[var(--text-primary)]/[0.04] border border-[var(--glass-border)] text-[var(--text-secondary)]/60 flex items-center justify-center shrink-0">
            <Eye size={17} strokeWidth={1.6} />
          </div>
          <p className="authority-title !text-2xs opacity-45 leading-relaxed">{GOZLEMCI_SALT_OKUMA_IPUCU}</p>
        </motion.div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-6">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="skeleton-shimmer h-36 rounded-card flex items-center px-8 gap-6 border border-[var(--text-primary)]/[0.04] relative overflow-hidden"
            >
              <div className="w-12 h-12 rounded-2xl bg-[var(--text-primary)]/5" />
              <div className="flex-1 space-y-3">
                <div className="w-1/3 h-2 bg-[var(--text-primary)]/5 rounded-full" />
                <div className="w-1/2 h-3 bg-[var(--text-primary)]/5 rounded-full opacity-50" />
              </div>
            </div>
          ))}
        </div>
      ) : gorevler.length === 0 ? (
        <motion.div variants={itemVariants}>
          <EmptyState
            icon={<CheckCircle2 size={32} strokeWidth={1.2} className="animate-float" />}
            title="Bugün görev yok"
            description="Bugün için atanmış bir göreviniz bulunmamaktadır."
            tone="emerald"
          />
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          {gorevler.map((g) => (
            <motion.div key={g.id} variants={itemVariants}>
              <GorevKarti
                bildirim={g}
                saat={bugunVakitler ? bugunVakitler[g.vakit] : '00:00'}
                autoOpenMazeret={autoOpenMazeretId === g.id}
                onMazeretHandled={onMazeretHandled}
              />
            </motion.div>
          ))}
        </div>
      )}
    </motion.section>
  );
};
