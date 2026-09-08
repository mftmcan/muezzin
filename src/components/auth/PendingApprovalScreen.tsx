import React from 'react';
import { motion } from 'motion/react';
import { Logo } from '../ui/Logo';
import { auth } from '../../lib/firebase';

interface PendingApprovalScreenProps {
  logout: () => void;
}

export function PendingApprovalScreen({ logout }: PendingApprovalScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--app-bg)] p-6 selection:bg-[var(--dynamic-aura,var(--aura-indigo))]/30 selection:text-[var(--text-primary)]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="spatial-glass backdrop-blur-2xl p-10 rounded-card shadow-[var(--spatial-shadow)] max-w-md w-full text-center border border-[var(--glass-border)]"
      >
        <div className="w-20 h-20 bg-[var(--text-primary)]/5 rounded-full flex items-center justify-center mx-auto mb-8 shadow-sm ring-1 ring-[var(--glass-border)]">
          <Logo size={48} variant="gold" />
        </div>
        <h1 className="text-2xl font-semibold mb-3 text-[var(--text-primary)] tracking-tight">Onay Bekleniyor</h1>
        <p className="text-[var(--text-secondary)] mb-8 leading-relaxed">
          Dizgeye kaydınız yapıldı fakat hesabınız henüz yönetici tarafından aktif edilmedi.
        </p>
        <div className="bg-[var(--status-info)]/5 p-5 rounded-2xl text-xs text-[var(--status-info)] mb-10 text-left border border-[var(--status-info)]/10 space-y-1">
          <div className="flex justify-between border-b border-[var(--status-info)]/10 pb-1 mb-1">
            <span className="opacity-50 text-[var(--text-secondary)]">Ad Soyad:</span>
            <span className="font-bold text-[var(--text-primary)]">{auth.currentUser?.displayName}</span>
          </div>
          <div className="flex justify-between">
            <span className="opacity-50 text-[var(--text-secondary)]">E-posta:</span>
            <span className="font-bold text-[var(--text-primary)]">{auth.currentUser?.email}</span>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full h-12 text-[var(--text-secondary)] font-medium hover:text-[var(--status-danger)] transition-colors uppercase text-2xs tracking-wide"
        >
          GİRİŞ YAPILAN HESAPTAN ÇIK
        </button>
      </motion.div>
    </div>
  );
}
