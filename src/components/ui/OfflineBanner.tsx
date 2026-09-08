import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

export function OfflineBanner() {
  // useNetworkStatus() bir { isOnline } nesnesi döndürüyor — burada
  // destructure edilmeden doğrudan bir değişkene atanmıştı, bu yüzden
  // `isOnline` her zaman (nesneler her zaman truthy olduğundan) doluydu ve
  // `show` her zaman false kalıyordu: bu banner GERÇEKTE HİÇBİR ZAMAN
  // render olmuyordu, ağ durumu ne olursa olsun (bkz. beşinci denetim
  // turu — uygulamadaki TEK genel "çevrimdışısın" göstergesi).
  const { isOnline } = useNetworkStatus();
  const show = !isOnline;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed top-[env(safe-area-inset-top,0px)] left-0 right-0 z-[10000] flex justify-center pointer-events-none px-4 pt-4"
        >
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto bg-[var(--app-bg)]/80 backdrop-blur-[35px] border border-[var(--glass-border)] shadow-[var(--spatial-shadow)] rounded-full px-5 py-2.5 flex items-center gap-3"
          >
            <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
              <WifiOff size={12} className="text-amber-500" />
            </div>
            <div className="flex flex-col">
              <span className="text-2xs font-bold tracking-wide text-[var(--text-primary)]">ÇEVRİMDIŞI MOD</span>
              <span className="text-2xs text-[var(--text-secondary)] opacity-80 leading-tight">
                Değişiklikler bağlantı sağlandığında eşitlenecek.
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
