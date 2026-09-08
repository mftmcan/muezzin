import React from 'react';
import { motion } from 'motion/react';
import { toTurkishUpperCase } from '../../lib/dateUtils';

type EmptyStateTone = 'neutral' | 'indigo' | 'emerald' | 'rose' | 'amber';
type EmptyStateSize = 'md' | 'lg';

interface EmptyStateAction {
  label: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone?: EmptyStateTone;
  size?: EmptyStateSize;
  action?: EmptyStateAction;
  className?: string;
}

const TONE_CLASSES: Record<EmptyStateTone, string> = {
  neutral: 'bg-[var(--text-primary)]/[0.03] text-[var(--text-secondary)] border-[var(--glass-border)]',
  indigo:
    'bg-[var(--dynamic-aura,var(--aura-indigo))]/10 text-[var(--dynamic-aura,var(--aura-indigo))] border-[var(--dynamic-aura,var(--aura-indigo))]/20',
  emerald: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  rose: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
  amber: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
};

const SIZE_CLASSES: Record<EmptyStateSize, string> = {
  md: 'p-12 sm:p-16',
  lg: 'p-16 sm:p-20',
};

/**
 * Uygulama genelinde (admin paneli + saha ekranları) tekrarlanan "boş durum
 * kartı" deseni: spatial-glass kart + renkli ikon dairesi + başlık + açıklama
 * + isteğe bağlı aksiyon. Önceden 10+ dosyada elle kopyalanıyordu (bkz. kart
 * tasarım denetimi) — buradaki değişiklik hepsine yayılır.
 */
export function EmptyState({ icon, title, description, tone = 'neutral', size = 'lg', action, className = '' }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`spatial-glass rounded-card text-center flex flex-col items-center max-w-2xl mx-auto border-dashed border-[var(--text-primary)]/10 ${SIZE_CLASSES[size]} ${className}`}
    >
      <div
        className={`w-20 h-20 rounded-icon flex items-center justify-center mb-8 shadow-[var(--spatial-shadow)] border ${TONE_CLASSES[tone]}`}
      >
        {icon}
      </div>
      <h3 className="text-3xl font-light text-[var(--text-primary)] tracking-tight mb-4">{title}</h3>
      {/* CSS `uppercase` yerine `toTurkishUpperCase()` kullanılır — description
          artık bazı çağıranlarda (ör. ExecutiveHeroScreen.tsx, KrizAlarmlari.tsx)
          dinamik Türkçe hata metni taşıyabiliyor, tarayıcının locale'e duyarsız
          CSS uppercase'i küçük noktalı 'i'yi 'İ' yerine 'I'ya çevirirdi (bkz.
          kod denetimi — ExecutiveHeroScreen.tsx'teki AYNI sınıf düzeltme). */}
      <p className="authority-title !text-2xs opacity-40 tracking-wide leading-relaxed mb-12 max-w-sm">{toTurkishUpperCase(description)}</p>
      {action && (
        <motion.button
          whileHover={{ y: -5, scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={action.onClick}
          disabled={action.disabled}
          className="bg-[var(--text-primary)] text-[var(--app-bg)] px-12 py-6 rounded-3xl text-2xs font-bold uppercase tracking-wide shadow-[var(--spatial-shadow)] flex items-center gap-6 disabled:opacity-50"
        >
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
}
