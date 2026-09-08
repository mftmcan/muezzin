import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, ServerCrash, CalendarX, RefreshCcw, Gauge } from 'lucide-react';
import { AdminUyarisi } from '../types';

interface SistemUyarisiBannerProps {
  uyari: (AdminUyarisi & { id: string }) | null;
}

const BASLIKLAR: Record<AdminUyarisi['tip'], string> = {
  zincirTukendi: 'NÖBET ZİNCİRİ KESİNTİSİ',
  apiHatasi: 'DİZGE BAĞLANTI ARIZASI',
  planOlusturulamadi: 'PLANLAMA UYARISI',
  otomasyonHatasi: 'OTOMASYON HATASI',
  // Normalde saha müezzinine hiç ULAŞMAZ — useAktifSistemUyarisi bu tipi
  // bilerek eler (kota uyarısı saha tarafında aksiyona dönüşmeyen, yalnızca
  // yöneticiyi ilgilendiren bir teknik ihbardır). Record<AdminUyarisi['tip']>
  // eksiksiz olsun ve ileride eleme kaldırılırsa jenerik metne düşmesin diye
  // yine de tanımlı.
  kotaUyarisi: 'DİZGE KAPASİTE UYARISI',
};

function getIcon(tip: AdminUyarisi['tip']) {
  switch (tip) {
    case 'zincirTukendi':
      return <AlertTriangle size={16} strokeWidth={1.5} />;
    case 'apiHatasi':
      return <ServerCrash size={16} strokeWidth={1.5} />;
    case 'planOlusturulamadi':
      return <CalendarX size={16} strokeWidth={1.5} />;
    case 'otomasyonHatasi':
      return <RefreshCcw size={16} strokeWidth={1.5} />;
    case 'kotaUyarisi':
      return <Gauge size={16} strokeWidth={1.5} />;
    default:
      return <AlertTriangle size={16} strokeWidth={1.5} />;
  }
}

/** Yönetici müdahalesi bekleyen bir sistem arızasını saha müezzinine
 * pasif bilgilendirme olarak gösterir — aksiyon alınamaz, yalnızca
 * "yönetim haberdar/müdahale sürüyor" bilgisini iletir. */
export const SistemUyarisiBanner = React.memo<SistemUyarisiBannerProps>(({ uyari }) => (
  <AnimatePresence>
    {uyari && (
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.97 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full mt-4 spatial-glass !rounded-card border overflow-hidden bg-rose-500/[0.04] dark:bg-rose-500/[0.02] border-rose-500/20 dark:border-rose-400/15 shadow-[var(--spatial-shadow)]"
      >
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-rose-500/10 to-transparent" aria-hidden />

        <div className="relative z-10 p-3.5 sm:p-4">
          <div className="flex items-start gap-2.5">
            <div className="relative flex-shrink-0 mt-0.5">
              <span className="absolute inset-0 rounded-full bg-rose-500 animate-ping opacity-35" />
              <span className="relative block w-2 h-2 rounded-full bg-rose-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                {getIcon(uyari.tip)}
                <h3 className="text-2xs sm:text-xs font-black uppercase tracking-wider text-[var(--text-primary)]">
                  {BASLIKLAR[uyari.tip] ?? 'DİZGE UYARISI'}
                </h3>
              </div>
              <p className="text-2xs sm:text-2xs leading-relaxed mt-2 font-medium text-[var(--text-secondary)]">
                Yönetim, nöbet çizelgenizi etkileyebilecek bir aksaklığa müdahale ediyor. Ekstra bir işlem yapmanız gerekmiyor.
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
));

SistemUyarisiBanner.displayName = 'SistemUyarisiBanner';
