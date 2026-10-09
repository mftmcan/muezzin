import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Megaphone } from 'lucide-react';
import { EASE } from '../../lib/motion';
import type { Duyuru } from '../../hooks/useDuyurular';

interface DuyuruSliderProps {
  duyurular: Duyuru[];
  /** Kullanıcının "okundu" olarak işaretlediği duyuru id'leri (localStorage). */
  readDuyurular: string[];
  /** Kart tıklanınca detay modalini açan geri çağırım. */
  onSelectDuyuru: (duyuru: Duyuru) => void;
}

/**
 * "RESMİ GÖREVLENDİRME DUYURULARI" kaydırmalı duyuru kartı — kendi karusel
 * konumunu (`activeDuyuruIdx`) kendi içinde taşır; okundu işareti ve modal
 * açma kararı ebeveynde kalır (localStorage sahipliği ve modal state'i
 * MuezzinAnaEkran'a aittir).
 *
 * MuezzinAnaEkran.tsx'ten FE-001 bileşenleme çalışmasında çıkarıldı; JSX ve
 * animasyon değerleri birebir korundu (görsel regresyon sıfır fark hedefi).
 */
export function DuyuruSlider({ duyurular, readDuyurular, onSelectDuyuru }: DuyuruSliderProps) {
  const [activeDuyuruIdx, setActiveDuyuruIdx] = useState(0);

  if (duyurular.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.15, ease: EASE.out }}
      className="spatial-glass !bg-[var(--status-info)]/[0.03] !border-[var(--status-info)]/15 p-5 sm:p-6 relative overflow-hidden group"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--status-info)]/[0.015] blur-2xl rounded-full pointer-events-none" />

      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-info)] animate-pulse" />
          <p className="text-2xs text-[var(--status-info)]/85 font-bold tracking-wide uppercase">RESMİ GÖREVLENDİRME DUYURULARI</p>
        </div>
        {duyurular.length > 1 && (
          <div className="flex items-center gap-1.5 bg-[var(--text-primary)]/[0.03] border border-[var(--glass-border)] p-1 rounded-xl backdrop-blur-md relative z-20">
            <button
              disabled={activeDuyuruIdx === 0}
              onClick={(e) => {
                e.stopPropagation();
                setActiveDuyuruIdx((prev) => Math.max(0, prev - 1));
              }}
              aria-label="Önceki duyuru"
              className={`min-w-[32px] min-h-[32px] p-2 rounded-lg hover:bg-[var(--text-primary)]/5 transition-all flex items-center justify-center ${activeDuyuruIdx === 0 ? 'opacity-20 cursor-not-allowed' : 'opacity-80 hover:opacity-100'}`}
            >
              <ChevronLeft size={12} strokeWidth={2.5} />
            </button>
            <span className="text-2xs font-bold text-[var(--text-secondary)]/65 px-1.5 tabular-nums">
              {activeDuyuruIdx + 1} / {duyurular.length}
            </span>
            <button
              disabled={activeDuyuruIdx === duyurular.length - 1}
              onClick={(e) => {
                e.stopPropagation();
                setActiveDuyuruIdx((prev) => Math.min(duyurular.length - 1, prev + 1));
              }}
              aria-label="Sonraki duyuru"
              className={`min-w-[32px] min-h-[32px] p-2 rounded-lg hover:bg-[var(--text-primary)]/5 transition-all flex items-center justify-center ${activeDuyuruIdx === duyurular.length - 1 ? 'opacity-20 cursor-not-allowed' : 'opacity-80 hover:opacity-100'}`}
            >
              <ChevronRight size={12} strokeWidth={2.5} />
            </button>
          </div>
        )}
      </div>

      {(() => {
        const isCurrentDuyuruRead = readDuyurular.includes(duyurular[activeDuyuruIdx]?.id || '');

        return (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeDuyuruIdx}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.25 }}
              onClick={() => onSelectDuyuru(duyurular[activeDuyuruIdx])}
              className="flex items-center gap-4 sm:gap-5 cursor-pointer relative overflow-hidden group/item shimmer-trigger"
            >
              <div className="kinetic-sheen" />
              <div
                className={`w-12 h-12 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center shrink-0 border group-hover/item:scale-105 group-hover/item:shadow-[0_0_15px_color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 20%, transparent)] transition-all duration-500 relative ${
                  isCurrentDuyuruRead
                    ? 'bg-[var(--text-primary)]/[0.01] border-[var(--glass-border)] opacity-60'
                    : 'bg-gradient-to-br from-[var(--status-info)]/15 via-[var(--status-info)]/5 to-transparent border-[var(--status-info)]/25'
                }`}
              >
                <Megaphone
                  size={16}
                  className={`${isCurrentDuyuruRead ? 'text-muted' : 'text-[var(--status-info)]'} group-hover/item:rotate-12 transition-transform duration-500`}
                  strokeWidth={1.75}
                />
                {/* Nokta bg-[var(--status-info)] (sabit mavi) ama parıltısı yanlışlıkla
      dynamic-aura'ya (günün vaktine göre amber/ruby/emerald olabilir)
      bağlıydı — nokta ile parıltısı aynı renk olmalı (bkz. GPS aktif
      noktasındaki established desen: bg-emerald-400 + shadow rgba(52,211,153),
      premium standart denetimi). */}
                {!isCurrentDuyuruRead && (
                  <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[var(--status-info)] shadow-[0_0_8px_color-mix(in_srgb,var(--status-info)_80%,transparent)] animate-pulse" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className={`text-base sm:text-lg font-light text-[var(--text-primary)] group-hover/item:font-normal transition-all duration-300 truncate ${isCurrentDuyuruRead ? 'opacity-50' : ''}`}
                >
                  {duyurular[activeDuyuruIdx].baslik}
                </h3>
                <p className="text-2xs text-muted mt-0.5 line-clamp-1">{duyurular[activeDuyuruIdx].icerik}</p>
              </div>
              <ChevronRight
                size={16}
                className="text-muted group-hover/item:text-[var(--text-secondary)]/60 group-hover/item:translate-x-0.5 transition-all duration-300 shrink-0"
              />
            </motion.div>
          </AnimatePresence>
        );
      })()}
    </motion.div>
  );
}
