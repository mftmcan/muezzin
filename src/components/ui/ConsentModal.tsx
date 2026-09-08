import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { motion, type TargetAndTransition } from 'motion/react';
import { hapticMedium, hapticLight } from '../../lib/haptic';

interface ConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
  title: string;
  /** İkon (ör. `<Compass size={40} strokeWidth={1.5} />`) — renk/boyut çağıran tarafta verilir. */
  icon: ReactNode;
  /** Boştayken oynatılan ikon animasyonu (ör. hafif sallanma / nabız). */
  iconIdleAnimate: TargetAndTransition;
  /** `isLoading` sırasında oynatılan ikon animasyonu (ör. dönme). */
  iconLoadingAnimate: TargetAndTransition;
  description: string;
  noteIcon: ReactNode;
  note: string;
  confirmLabel: string;
  loadingLabel: string;
  cancelLabel: string;
}

/**
 * Tarayıcının native izin promptu öncesindeki açıklayıcı ara adım — GPS ve
 * bildirim izinleri için ~%90 aynı görsel/etkileşim dilini taşıyan iki ayrı
 * dosya (GpsConsentModal, NotificationPrimingModal) tek bileşene çıkarıldı
 * (bkz. premium denetim O4). İkon ve animasyonları çağıran taraf verir, geri
 * kalan iskelet (halka, gizlilik notu kutusu, iki buton) paylaşılır.
 */
export function ConsentModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  title,
  icon,
  iconIdleAnimate,
  iconLoadingAnimate,
  description,
  noteIcon,
  note,
  confirmLabel,
  loadingLabel,
  cancelLabel,
}: ConsentModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="flex flex-col items-center text-center py-4 relative">
        {/* Animated Icon */}
        <div className="relative w-28 h-28 flex items-center justify-center mb-8 shrink-0">
          {/* Pulsing Aura — ayrı, mutlak konumlu halka (bkz. GorevliKarti'ndeki
              doğru desen); ikonun kendisi animate-ping ALMAZ (bkz. B25). */}
          <div className="absolute inset-0 rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))]/10 animate-ping-slow opacity-40" />
          <div className="w-20 h-20 rounded-icon bg-gradient-to-br from-[var(--dynamic-aura,var(--aura-indigo))]/20 to-transparent border border-[var(--dynamic-aura,var(--aura-indigo))]/30 flex items-center justify-center relative shadow-[0_8px_32px_rgba(0,0,0,0.05)]">
            <motion.div
              animate={isLoading ? iconLoadingAnimate : iconIdleAnimate}
              transition={
                isLoading ? { repeat: Infinity, duration: 2, ease: 'linear' } : { repeat: Infinity, duration: 6, ease: 'easeInOut' }
              }
              className="text-[var(--dynamic-aura,var(--aura-indigo))]"
            >
              {icon}
            </motion.div>
          </div>
        </div>

        {/* Text */}
        <p className="text-base sm:text-lg font-light text-[var(--text-secondary)] leading-relaxed max-w-md mb-8">{description}</p>

        {/* Privacy / Info Note */}
        <div className="w-full max-w-md p-4 rounded-2xl bg-[var(--text-primary)]/[0.02] border border-[var(--glass-border)] mb-8 flex items-center gap-3 text-left">
          <span className="text-[var(--dynamic-aura,var(--aura-indigo))] shrink-0">{noteIcon}</span>
          <span className="text-2xs text-[var(--text-secondary)]/75 leading-tight">{note}</span>
        </div>

        {/* Actions */}
        <div className="w-full flex flex-col gap-3">
          <motion.button
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              hapticMedium();
              onConfirm();
            }}
            disabled={isLoading}
            className="w-full py-5 rounded-avatar border-none text-[var(--app-bg)] font-bold tracking-wider cursor-pointer shadow-lg shadow-[var(--dynamic-aura,var(--aura-indigo))]/20 flex items-center justify-center gap-2"
            style={{
              // Gradyanın bitişi sabit indigo-600'e kilitliydi — günün vaktine
              // göre değişen dynamic-aura ruby/amber/emerald olduğunda
              // butonun kendi içinde tutarsız iki renk karışıyordu (bkz.
              // Kıble Pusulası mimari denetimi). Bitiş tonu artık aynı
              // aura'dan koyulaştırılarak türetiliyor.
              background:
                'linear-gradient(to right, var(--dynamic-aura, var(--aura-indigo)), color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 70%, black))',
            }}
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 rounded-full border-2 border-[var(--text-primary)]/20 border-t-white animate-spin" />
                <span>{loadingLabel}</span>
              </>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              hapticLight();
              onClose();
            }}
            disabled={isLoading}
            className="w-full py-4 rounded-avatar border border-[var(--glass-border)] bg-transparent hover:bg-[var(--text-primary)]/[0.02] text-[var(--text-secondary)] font-semibold cursor-pointer"
          >
            {cancelLabel}
          </motion.button>
        </div>
      </div>
    </Modal>
  );
}
