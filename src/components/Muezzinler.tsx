import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Users, AlertCircle } from 'lucide-react';
import { parseISO } from 'date-fns';
import { GorevliKarti } from './GorevliKarti';
import { useOneShotAnimation } from '../hooks/useOneShotAnimation';
import { isFriday as isFridayTarih } from '../lib/dateUtils';

interface Props {
  asilIsim?: string;
  yedekIsim?: string;
  asilDurum?: 'bekliyor' | 'onaylandi' | 'reddedildi';
  yedekDurum?: 'bekliyor' | 'onaylandi' | 'reddedildi';
  planVarMi: boolean;
  isAsilSizMisiniz?: boolean;
  isYedekSizMisiniz?: boolean;
  asilIzinde?: boolean;
  yedekIzinde?: boolean;
  loading?: boolean;
  /** Gösterilen atamanın ait olduğu tarih (YYYY-MM-DD) — "sonraki vakit" gece yarısını
   * aşıp yarına sarktığında bugünün tarihinden farklı olabilir, bu yüzden Cuma etiketi
   * bu tarihe göre hesaplanır. */
  planTarih: string;
}

export const Muezzinler = React.memo(
  ({
    asilIsim,
    yedekIsim,
    asilDurum,
    yedekDurum,
    planVarMi,
    isAsilSizMisiniz,
    isYedekSizMisiniz,
    asilIzinde,
    yedekIzinde,
    loading,
    planTarih,
  }: Props) => {
    const shouldAnimate = useOneShotAnimation('hademeler-listesi');
    const isFriday = useMemo(() => isFridayTarih(parseISO(planTarih)), [planTarih]);

    const motionInitial = { opacity: 0, y: 16 };
    const motionAnimate = { opacity: 1, y: 0 };
    const motionTransition = { duration: shouldAnimate ? 0.4 : 0, ease: 'easeOut' as const };

    return (
      <motion.section
        initial={shouldAnimate ? motionInitial : false}
        animate={motionAnimate}
        transition={motionTransition}
        className="w-full"
      >
        {/* ── Başlık ── */}
        <div className="flex items-center gap-4 sm:gap-8 mb-8 sm:mb-12">
          <div
            className={`w-14 h-14 sm:w-20 sm:h-20 rounded-icon bg-[var(--text-primary)]/[0.03] flex items-center justify-center border border-[var(--text-primary)]/5 shadow-[var(--spatial-shadow)] relative group ${
              isFriday ? 'text-emerald-400' : 'text-[var(--dynamic-aura,var(--aura-indigo))]'
            }`}
          >
            <Users size={28} className="sm:size-10 transition-transform duration-700" strokeWidth={1} />
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity scale-150 pointer-events-none"
              style={{
                background: `radial-gradient(circle, ${isFriday ? 'rgba(16,185,129,1)' : 'color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 20%, transparent)'} 0%, transparent 70%)`,
              }}
            />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-2 sm:mb-3">
              <div
                className={`w-1.5 h-1.5 rounded-full shadow-[0_0_10px_currentColor] ${
                  isFriday
                    ? 'bg-emerald-400 text-emerald-400'
                    : 'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--dynamic-aura,var(--aura-indigo))]'
                }`}
              />
              <p className="authority-title text-2xs opacity-40 tracking-wide font-bold uppercase">
                {isFriday ? 'CUMA NAMAZI GÖREV DAĞILIMI' : 'VAKİT HİZMET GÖREVLİLERİ'}
              </p>
            </div>
            <h2 className="text-3xl sm:text-4xl font-light text-[var(--text-primary)] tracking-tight leading-none">
              {isFriday ? 'Cuma' : 'Vakit'}{' '}
              <span className={`${isFriday ? 'text-emerald-400' : 'text-[var(--dynamic-aura,var(--aura-indigo))]'} italic`}>
                {isFriday ? 'Görevlileri' : 'Görevlileri'}
              </span>
            </h2>
          </div>
        </div>

        {/* ── İçerik ── */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 lg:gap-10">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="skeleton-shimmer h-[9.5rem] flex items-center px-8 gap-6 !rounded-card border border-[var(--text-primary)]/[0.04]"
              >
                <div className="w-16 h-16 rounded-3xl bg-[var(--text-primary)]/5 shrink-0" />
                <div className="flex-1 space-y-4">
                  <div className="w-1/3 h-2 bg-[var(--text-primary)]/5 rounded-full" />
                  <div className="w-2/3 h-5 bg-[var(--text-primary)]/5 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : planVarMi ? (
          <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 gap-8 lg:gap-10">
            <GorevliKarti tip="asil" isim={asilIsim} durum={asilDurum} isUser={isAsilSizMisiniz} izinde={asilIzinde} isFriday={isFriday} />
            <GorevliKarti
              tip="yedek"
              isim={yedekIsim}
              durum={yedekDurum}
              isUser={isYedekSizMisiniz}
              izinde={yedekIzinde}
              isFriday={isFriday}
            />
          </motion.div>
        ) : (
          <div className="p-10 sm:p-16 spatial-glass text-center flex flex-col items-center justify-center gap-6 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/[0.02] via-transparent to-transparent pointer-events-none" />
            <div className="w-20 h-20 rounded-[32px] bg-[var(--text-primary)]/[0.03] border border-[var(--text-primary)]/[0.06] flex items-center justify-center shadow-inner animate-float">
              <AlertCircle size={36} className="text-subtle" strokeWidth={1} />
            </div>
            <div className="max-w-md relative z-10">
              <p className="authority-title !text-2xs opacity-20 tracking-wide mb-3 uppercase">Veri Akışı Kesildi</p>
              <p className="text-lg font-extralight text-[var(--text-secondary)]/75 italic leading-relaxed">
                Bu periyot için henüz bir operasyonel görevlendirme yapılmamıştır.
              </p>
            </div>
          </div>
        )}
      </motion.section>
    );
  }
);
