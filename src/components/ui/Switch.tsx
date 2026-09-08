import type { MouseEvent } from 'react';
import { motion } from 'motion/react';

interface SwitchProps {
  checked: boolean;
  onChange: (event?: MouseEvent<HTMLButtonElement>) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/**
 * Önceden 4 yerde (NotificationSettings ×3, KrizAlarmlari ×1) neredeyse
 * birebir kopyalanan pill+topuz deseni tek bileşene çıkarıldı — KrizAlarmlari
 * kopyası `role="switch"`/`aria-checked` taşımıyordu ve topuzu sabit
 * `bg-white`'dı (ışık modunda açık gri iz üzerinde kayboluyordu, bkz. premium
 * denetim B6/B39). Görsel pill 28px kalsa da tıklanabilir satırın tamamı
 * (min-h-[44px]) — B37'nin dokunma hedefi kuralını karşılar.
 */
export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => onChange(e)}
      className="w-full flex items-center justify-between gap-6 py-2 min-h-[44px] text-left disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className="space-y-1">
        <span className="block text-xs font-semibold text-[var(--text-primary)]">{label}</span>
        {description && (
          <span className="block text-2xs text-[var(--text-secondary)]/75 leading-normal max-w-[280px] font-light">{description}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`w-12 h-7 shrink-0 rounded-full border border-[var(--glass-border)] flex items-center px-1 transition-all duration-300 ${
          checked
            ? 'bg-[var(--dynamic-aura,var(--aura-indigo))]/20 border-[var(--dynamic-aura,var(--aura-indigo))]/30'
            : 'bg-[var(--text-primary)]/[0.04]'
        }`}
      >
        <motion.span
          layout
          animate={{
            x: checked ? 20 : 0,
            backgroundColor: checked ? 'var(--status-info)' : 'var(--text-secondary)',
          }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="block w-4 h-4 rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.2)]"
        />
      </span>
    </button>
  );
}
