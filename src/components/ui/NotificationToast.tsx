/**
 * NotificationToast.tsx — SACRED PRECISION UPGRADE
 *
 * Değişiklikler:
 * - Konum: merkez → sağ üst (editorial)
 * - Giriş: translateY(-8px), opacity 0 → 0, sonra normal
 * - Çıkış: translateX(110%) → sağa süzülür
 * - Sol kenar chromatic status (2px): success=emerald, error=rose, info=indigo, warning=amber
 * - True Black zemin, backdrop blur
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Info, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

interface NotificationToastProps {
  id: string;
  title: string;
  message: string;
  type?: NotificationType;
  action?: { label: string; onClick: () => void };
  durationMs?: number;
  onClose: (id: string) => void;
}

// export: NotificationHistoryPanel.tsx aynı tip→renk/ikon eşlemesini
// bağımsız olarak yeniden tanımlıyordu (bkz. premium standart denetimi,
// CLAUDE.md "aynı algoritmayı yeniden yazma" uyarısı) — tek kaynağa taşındı.
export const TYPE_CONFIG = {
  info: { borderColor: 'var(--status-info)', icon: <Info size={16} className="text-[var(--status-info)]" />, dot: 'var(--status-info)' },
  success: {
    borderColor: 'var(--status-success)',
    icon: <CheckCircle2 size={16} className="text-[var(--status-success)]" />,
    dot: 'var(--status-success)',
  },
  warning: {
    borderColor: 'var(--status-warning)',
    icon: <AlertCircle size={16} className="text-[var(--status-warning)]" />,
    dot: 'var(--status-warning)',
  },
  error: {
    borderColor: 'var(--status-danger)',
    icon: <AlertCircle size={16} className="text-[var(--status-danger)]" />,
    dot: 'var(--status-danger)',
  },
};

export const NotificationToast: React.FC<NotificationToastProps> = ({
  id,
  title,
  message,
  type = 'info',
  action,
  durationMs = 5500,
  onClose,
}) => {
  // Fare üzerideyken otomatik kapanma duraklar — aksi halde kullanıcı mesajı
  // okurken ya da bir action butonuna (varsa) tıklamaya çalışırken toast
  // altından kayıp gidebiliyordu (bkz. kod denetimi — premium standart
  // analizi). Kalan süre elle izlenir; imleç ayrılınca kaldığı yerden devam
  // eder, sıfırdan başlamaz.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(durationMs);
  // Render sırasında Date.now() çağırmak saf-olmayan bir işlem sayılır (bkz.
  // react-hooks/purity) — gerçek başlangıç zamanı yalnızca start() (mount'ta
  // effect içinden) çalıştığında set edilir, burada yalnızca bir yer tutucu.
  const lastStartRef = useRef(0);

  const start = useCallback(() => {
    lastStartRef.current = Date.now();
    timeoutRef.current = setTimeout(() => onClose(id), remainingRef.current);
  }, [id, onClose]);

  const pause = useCallback(() => {
    if (!timeoutRef.current) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    remainingRef.current -= Date.now() - lastStartRef.current;
  }, []);

  useEffect(() => {
    start();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.info;

  return (
    <motion.div
      layout
      role={type === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      onMouseEnter={pause}
      onMouseLeave={start}
      initial={{ opacity: 0, y: -8, x: 0 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      exit={{ opacity: 0, x: '110%', transition: { duration: 0.28, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-auto w-full sm:w-auto sm:min-w-[320px] max-w-full sm:max-w-[400px] spatial-glass !rounded-3xl shadow-[var(--spatial-shadow)]"
      style={{
        borderLeftWidth: '3px',
        borderLeftColor: cfg.borderColor,
      }}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5 flex items-center justify-center w-7 h-7 rounded-xl bg-[var(--text-primary)]/[0.03] border border-[var(--text-primary)]/5">
          {cfg.icon}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-medium text-[var(--text-primary)] mb-1 leading-none">{title}</h4>
          <p className="text-2xs font-light text-[var(--text-secondary)]/60 leading-relaxed">{message}</p>
          {action && (
            <button
              onClick={() => {
                action.onClick();
                onClose(id);
              }}
              className="mt-2 text-2xs font-bold uppercase tracking-wide text-[var(--status-info)] hover:opacity-70 transition-opacity"
            >
              {action.label}
            </button>
          )}
        </div>

        {/* Close */}
        <button
          onClick={() => onClose(id)}
          aria-label="Kapat"
          className="flex-shrink-0 p-1 rounded-lg transition-colors text-muted hover:text-[var(--text-secondary)]/60"
        >
          <X size={14} />
        </button>
      </div>
    </motion.div>
  );
};

export const NotificationContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // OfflineBanner de mobilde aynı üst bölgede (top-4) merkezde render oluyor —
  // çevrimdışıyken ikisi üst üste binmesin diye burada aşağı kaydırılıyor
  // (bkz. premium denetim, bölüm 5).
  const { isOnline } = useNetworkStatus();
  return (
    <div
      role="region"
      aria-live="polite"
      aria-atomic="false"
      aria-label="Bildirimler"
      className={`fixed ${isOnline ? 'top-4' : 'top-16'} left-4 right-4 sm:top-6 sm:right-6 sm:left-auto z-[9999] flex flex-col gap-3 pointer-events-none items-center sm:items-end transition-[top] duration-300`}
    >
      <AnimatePresence mode="popLayout">{children}</AnimatePresence>
    </div>
  );
};
