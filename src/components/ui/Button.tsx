import React from 'react';
import { motion, HTMLMotionProps } from 'motion/react';
import { SPRING } from '../../lib/motion';

export type ButtonVariant = 'primary' | 'aura' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'className' | 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  loadingLabel?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'py-3.5 px-6',
  lg: 'py-4.5 px-8',
};

// Dört varyant, aynı "birincil buton" jestini paylaşan çağrı noktalarında
// ölçülen dört farklı zemin stratejisine karşılık gelir (bkz. görsel tasarım
// denetimi V20 — ConfirmModal, EmptyState, ConsentModal, neural-btn hepsi
// kendi köşe yarıçapını/dolgusunu yazıyordu: 5 farklı padding, 4 farklı
// radius, 3 farklı zemin). Hepsi artık --radius-card ve --shadow-elev2/glow
// token'larını paylaşıyor.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // --shadow-glow-* @theme'de değil düz :root'ta tanımlı (--dynamic-aura
  // içerdiği için, bkz. index.css yorumu) — bu yüzden `shadow-glow-md`
  // GERÇEK bir Tailwind utility'si üretmiyor, `shadow-[var(--shadow-glow-md)]`
  // köşeli parantez çağrısı gerekiyor (aynı --spatial-shadow deseni).
  primary: 'bg-[var(--text-primary)] text-[var(--app-bg)] shadow-elev2 hover:shadow-[var(--shadow-glow-md)]',
  aura: 'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] shadow-elev2 hover:shadow-[var(--shadow-glow-md)]',
  danger:
    'bg-[var(--status-danger)] text-[var(--app-bg)] shadow-elev2 hover:shadow-[0_8px_25px_-5px_color-mix(in_srgb,var(--status-danger)_45%,transparent)]',
  ghost:
    'bg-transparent text-muted hover:text-[var(--text-primary)] border border-[var(--glass-border)] hover:border-[var(--text-primary)]/20',
};

/**
 * Uygulama genelinde "birincil buton" jestinin tek kaynağı (bkz. görsel
 * tasarım denetimi V20). `ui/` altında Button/Badge/Card primitifi hiç
 * yoktu — her çağrı noktası kendi padding/radius/zemin reçetesini elle
 * yazıyordu. Yeni çağrı noktaları bunu kullanır; mevcut noktalar (neural-btn,
 * ConsentModal'ın gradyanlı düğmesi vb.) geriye dönük uyumluluk için
 * değiştirilmeden bırakıldı — aynı `motion.ts` token'ları için CLAUDE.md'de
 * belgelenen kural.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'lg', isLoading = false, loadingLabel, className = '', children, disabled, ...rest }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileHover={disabled || isLoading ? {} : { y: -2, scale: 1.02 }}
        whileTap={disabled || isLoading ? {} : { scale: 0.96 }}
        transition={SPRING.gentle}
        disabled={disabled || isLoading}
        className={`rounded-card text-2xs font-bold uppercase tracking-wide border-none cursor-pointer transition-colors disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
        {...rest}
      >
        {isLoading ? (
          <>
            <div className="w-4 h-4 rounded-full border-2 border-current/25 border-t-current animate-spin" />
            {loadingLabel ?? children}
          </>
        ) : (
          children
        )}
      </motion.button>
    );
  }
);
Button.displayName = 'Button';
