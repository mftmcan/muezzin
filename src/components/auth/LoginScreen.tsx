import React from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { Logo } from '../ui/Logo';

interface LoginScreenProps {
  login: () => void;
  isLoginInProgress: boolean;
}

export function LoginScreen({ login, isLoginInProgress }: LoginScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--app-bg)] p-6 relative overflow-hidden transition-colors duration-[3000ms]">
      {/* Animated Ambient Aura */}
      <motion.div
        animate={{
          scale: [1, 1.15, 1],
          opacity: [0.12, 0.2, 0.12],
          x: [0, 30, 0],
          y: [0, -20, 0],
        }}
        className="pointer-events-none fixed top-[-15%] left-[-10%] w-[60vw] h-[60vw] rounded-full"
        style={{ background: 'radial-gradient(circle, var(--aura-indigo) 0%, transparent 60%)' }}
      />
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.08, 0.15, 0.08],
          x: [0, -20, 0],
          y: [0, 30, 0],
        }}
        className="pointer-events-none fixed bottom-[-20%] right-[-10%] w-[50vw] h-[50vw] rounded-full"
        style={{ background: 'radial-gradient(circle, var(--aura-ruby) 0%, transparent 60%)' }}
      />
      <motion.div
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.06, 0.12, 0.06],
        }}
        className="pointer-events-none fixed top-[40%] right-[20%] w-[35vw] h-[35vw] rounded-full"
        style={{ background: 'radial-gradient(circle, var(--aura-amber) 0%, transparent 60%)' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="spatial-glass backdrop-blur-3xl p-8 sm:p-10 lg:p-14 rounded-card max-w-lg w-full text-center border border-[var(--glass-border)] relative overflow-hidden group/login"
        style={{ boxShadow: 'var(--spatial-shadow)' }}
      >
        {/* Card shimmer overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--specular-glow)] via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--specular-glow)] to-transparent pointer-events-none" />

        {/* Top Indicators */}
        <div className="absolute top-8 inset-x-0 flex justify-center gap-2">
          <div className="w-8 h-1 rounded-full bg-[var(--text-primary)]/5" />
          <div className="w-8 h-1 rounded-full bg-[var(--aura-indigo)]/20 animate-pulse" />
          <div className="w-8 h-1 rounded-full bg-[var(--text-primary)]/5" />
        </div>

        {/* Logo Section */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.8, type: 'spring', stiffness: 200 }}
          className="relative mt-4 mb-12"
        >
          <div className="w-28 h-28 bg-[var(--text-primary)]/[0.03] backdrop-blur-2xl rounded-[36px] flex items-center justify-center mx-auto shadow-[var(--spatial-shadow)] ring-1 ring-[var(--glass-border)] relative group/logo">
            <div className="absolute inset-0 rounded-[36px] bg-gradient-to-br from-[var(--aura-indigo)]/15 via-transparent to-[var(--aura-ruby)]/10" />
            <div className="absolute inset-0 rounded-[36px] bg-[var(--text-primary)]/[0.05] opacity-0 group-hover/logo:opacity-100 transition-opacity" />
            <Logo size={72} variant="gold" />
          </div>

          {/* Status Badge */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-12">
            <div className="px-4 py-1.5 rounded-full bg-[var(--app-bg)]/80 backdrop-blur-md border border-[var(--glass-border)] flex items-center gap-2 shadow-[var(--spatial-shadow)]">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] animate-pulse shadow-[0_0_8px_var(--status-success)]" />
              <span className="text-2xs font-bold tracking-wide uppercase text-[var(--text-secondary)]">DİZGE ÇEVRİMİÇİ</span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.6 }}
          className="relative z-10"
        >
          <h1 className="text-4xl lg:text-5xl font-light mb-3 text-[var(--text-primary)] tracking-tighter leading-none apple-thin">
            Müezzin <span className="text-[var(--aura-indigo)] font-light">Hizmet Dizgesi</span>
          </h1>
          <p className="text-[var(--text-secondary)]/75 mb-14 font-bold tracking-wide uppercase text-2xs">
            CAMİ VE DİN GÖREVLİLERİ HİZMET PLANLAMA DİZGESİ
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="flex flex-col gap-5 mb-12 relative z-10"
        >
          <motion.button
            whileHover={{ y: -3, scale: 1.01, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)' }}
            whileTap={{ scale: 0.98 }}
            onClick={login}
            disabled={isLoginInProgress}
            className={`w-full h-16 flex items-center justify-center gap-5 bg-[var(--text-primary)] text-[var(--app-bg)] rounded-icon font-semibold transition-all duration-700 relative overflow-hidden group/btn ${isLoginInProgress ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {/* Hover Sweep Effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--specular-glow)] to-transparent -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000" />

            {isLoginInProgress ? (
              <div className="flex items-center gap-4">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-2xs tracking-wide font-bold uppercase">Kimlik Doğrulanıyor...</span>
              </div>
            ) : (
              <>
                <div className="w-8 h-8 rounded-full bg-[var(--text-primary)]/10 flex items-center justify-center group-hover/btn:rotate-[360deg] transition-transform duration-1000">
                  <img src="/google-logo.svg" className="w-5 h-5 grayscale-0" alt="Google" />
                </div>
                <span className="text-2xs tracking-wide font-bold uppercase">Google ile Giriş Yap</span>
              </>
            )}
          </motion.button>

          <p className="text-2xs text-[var(--text-secondary)]/75 font-medium uppercase tracking-wide px-4">
            KURUMSAL KİMLİK DOĞRULAMA GEREKİR
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="relative z-10 pt-10 border-t border-[var(--glass-border)]"
        >
          <div className="flex items-center justify-center gap-6 mb-4">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-[var(--glass-border)]" />
            <span className="text-2xs font-bold text-muted uppercase tracking-wide">T.C. DİYANET İŞLERİ BAŞKANLIĞI</span>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-[var(--glass-border)]" />
          </div>
          <p className="text-2xs text-muted font-bold uppercase tracking-[0.1em]">Güvenli Giriş • Yetkili Hizmet Erişimi</p>
        </motion.div>
      </motion.div>

      {/* Footer Decoration */}
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-10 opacity-30">
        <span className="text-2xs tracking-wide font-bold uppercase">MÜEZZİN HİZMET TAKİP DİZGESİ v{__APP_VERSION__}</span>
      </div>
    </div>
  );
}
