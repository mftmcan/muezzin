import React from 'react';
import { motion } from 'motion/react';
import { AlertCircle } from 'lucide-react';

interface AuthErrorScreenProps {
  error: string;
  // Opsiyonel: yalnızca gerçekten geçici/dismiss edilebilir hatalarda
  // (ağ, popup vb.) geçilir. Sunucu tarafından belirlenen kalıcı durumlar
  // (örn. devre dışı hesap) için verilmez — bu durumda "TEKRAR DENE"
  // düğmesi hiç gösterilmez, çünkü onu dismiss etmek durumu değiştirmez
  // ve yalnızca canlı Firestore dinleyicisi hesabı yeniden aktif görünce
  // kendiliğinden temizlenir (bkz. useAuthStore, AuthGuard).
  setError?: (err: string | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export function AuthErrorScreen({ error, setError, setLoading, logout }: AuthErrorScreenProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)] p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full spatial-glass rounded-card shadow-[var(--spatial-shadow)] p-10 text-center border border-[var(--glass-border)]"
      >
        <div className="w-20 h-20 bg-[var(--status-danger)]/10 rounded-full flex items-center justify-center mx-auto mb-8">
          <AlertCircle className="w-10 h-10 text-[var(--status-danger)]" />
        </div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4 tracking-tight">Giriş Yapılamadı</h2>
        <div className="bg-[var(--status-danger)]/5 p-4 rounded-2xl mb-8 text-left border border-[var(--status-danger)]/10">
          <p className="text-sm text-[var(--status-danger)] leading-relaxed font-medium">{error}</p>
        </div>
        <div className="space-y-3">
          {setError && (
            <button
              onClick={() => {
                setError(null);
                setLoading(false);
              }}
              className="w-full h-14 bg-[var(--dynamic-aura,var(--aura-indigo))] hover:opacity-90 text-[var(--app-bg)] rounded-2xl font-medium shadow-lg shadow-[color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_20%,transparent)] transition-all "
            >
              TEKRAR DENE
            </button>
          )}
          <button
            onClick={logout}
            className="w-full h-14 bg-[var(--text-primary)]/5 text-[var(--text-primary)] rounded-2xl font-medium hover:bg-[var(--text-primary)]/10 transition-all "
          >
            BAŞKA HESAP KULLAN
          </button>
        </div>
      </motion.div>
    </div>
  );
}
