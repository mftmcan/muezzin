/**
 * SplashLoader.tsx — VELVET JEWEL-TONED THEME-AWARE UPGRADE
 *
 * Değişiklikler:
 * - Arka plan: sabit siyah yerine var(--app-bg) → Light Mode'da Fildişi, Dark Mode'da Obsidyen
 * - Radial aura: var(--dynamic-aura) sirkadiyen renk referansına bağlandı
 * - Conic halo: var(--aura-indigo) ve var(--aura-rose) CSS değişkenleri kullanıldı
 * - Kart glass: var(--spatial-glass-bg), var(--glass-border) ile senkronize edildi
 * - Başlık harfleri: var(--text-primary) ile tema uyumlu
 * - Alt etiket ve çizgiler: var(--text-secondary) ile adaptive
 * - Progress bar: var(--status-info) ile premium tasarım dili
 */

import React from 'react';
import { motion } from 'motion/react';
import { Logo } from './ui/Logo';
import { useThemeStore } from '../store/useThemeStore';

const MUEZZIN_CHARS = ['M', 'ü', 'e', 'z', 'z', 'i', 'n'];

export const SplashLoader: React.FC = () => {
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden transition-all duration-700"
      style={{
        background: isDark ? 'rgba(5, 5, 5, 0.45)' : 'rgba(250, 250, 250, 0.45)',
        backdropFilter: 'blur(50px) saturate(180%)',
        WebkitBackdropFilter: 'blur(50px) saturate(180%)',
      }}
    >
      {/* Dynamic Circadian Ambient Glow — Sirkadiyen Aurayı referanslar */}
      <motion.div
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1.4 }}
        transition={{ duration: 3.5, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <div
          className="w-[600px] h-[600px] rounded-full transition-all duration-1000"
          style={{
            background: isDark
              ? 'radial-gradient(circle, color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 14%, transparent) 0%, transparent 70%)'
              : 'radial-gradient(circle, color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 7%, transparent) 0%, transparent 70%)',
            filter: 'blur(50px)',
          }}
        />
      </motion.div>

      {/* Secondary counter-glow */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: isDark ? 0.6 : 0.25 }}
        transition={{ duration: 2.5, ease: [0.16, 1, 0.3, 1], delay: 0.5 }}
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <div
          className="w-[400px] h-[400px] rounded-full"
          style={{
            background: 'radial-gradient(circle, color-mix(in srgb, var(--aura-rose) 8%, transparent) 0%, transparent 70%)',
            filter: 'blur(80px)',
            transform: 'translate(120px, 80px)',
          }}
        />
      </motion.div>

      {/* Subtle noise texture overlay for depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: isDark ? 0.025 : 0.015,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative flex flex-col items-center gap-12">
        {/* Logo Kartı + Dönen Halo */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          {/* Dönen conic-gradient halo — tema uyumlu */}
          <motion.div
            className="absolute inset-[-12px] rounded-[52px] pointer-events-none"
            animate={{ rotate: 360 }}
            transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
            style={{
              background: isDark
                ? 'conic-gradient(from 0deg, transparent 0%, color-mix(in srgb, var(--aura-indigo) 40%, transparent) 25%, transparent 50%, color-mix(in srgb, var(--aura-rose) 25%, transparent) 75%, transparent 100%)'
                : 'conic-gradient(from 0deg, transparent 0%, color-mix(in srgb, var(--aura-indigo) 20%, transparent) 25%, transparent 50%, color-mix(in srgb, var(--aura-amber) 15%, transparent) 75%, transparent 100%)',
              opacity: isDark ? 0.35 : 0.5,
            }}
          />

          {/* Glass Logo Kartı — tema uyumlu */}
          <div
            className="w-32 h-32 md:w-40 md:h-40 flex items-center justify-center relative overflow-hidden transition-all duration-700"
            style={{
              background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.72)',
              backdropFilter: 'blur(32px) saturate(180%)',
              // --radius-card TAM OLARAK bu 40px'in tekrar tekrar elle
              // yazılmasını ortadan kaldırmak için eklenmişti (bkz.
              // index.css @theme yorumu) — token'ın değeri sonradan 15px'e
              // ayarlandığında bu ekran göçe dahil edilmemişti (bkz. premium
              // denetim B21, Y3).
              borderRadius: 'var(--radius-card)',
              border: isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(0,0,0,0.06)',
              boxShadow: isDark
                ? '0 0 0 0.5px rgba(255,255,255,0.06) inset, 0 40px 80px -20px rgba(0,0,0,0.8)'
                : '0 0 0 0.5px rgba(255,255,255,0.9) inset, 0 20px 60px -15px rgba(0,0,0,0.1)',
            }}
          >
            {/* Specular highlight çizgisi */}
            <div
              className="absolute top-0 left-0 right-0 pointer-events-none"
              style={{
                height: '1px',
                background: isDark
                  ? 'linear-gradient(to right, transparent, rgba(255,255,255,0.18) 40%, rgba(255,255,255,0.22) 60%, transparent)'
                  : 'linear-gradient(to right, transparent, rgba(255,255,255,0.95) 40%, rgba(255,255,255,1) 60%, transparent)',
              }}
            />

            <Logo size={80} variant={isDark ? 'gold' : 'navy'} />

            {/* Shine sweep animasyonu */}
            <motion.div
              animate={{ x: ['-150%', '250%'] }}
              transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 3.5, ease: 'easeInOut' }}
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.12) 50%, transparent 70%)',
              }}
            />
          </div>
        </motion.div>

        {/* Başlık — Stagger harfler + tema uyumlu renkler */}
        <div className="flex flex-col items-center gap-4">
          <motion.div
            className="flex items-baseline gap-0 overflow-hidden"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.05, delayChildren: 0.5 } },
              hidden: {},
            }}
          >
            {MUEZZIN_CHARS.map((char, i) => (
              <motion.span
                key={i}
                variants={{
                  hidden: { opacity: 0, y: 20, filter: 'blur(6px)' },
                  visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
                }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontStyle: 'italic',
                  fontSize: 'clamp(36px, 8vw, 52px)',
                  fontWeight: 400,
                  letterSpacing: '-0.02em',
                  color: 'var(--text-primary)',
                  lineHeight: 1,
                  opacity: isDark ? 0.92 : 0.88,
                }}
              >
                {char}
              </motion.span>
            ))}
          </motion.div>

          {/* Alt etiket — tema uyumlu */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.8 }}
            className="flex items-center gap-3"
          >
            <div
              style={{
                height: '1px',
                width: '20px',
                background: 'color-mix(in srgb, var(--text-primary) 15%, transparent)',
              }}
            />
            <span
              style={{
                fontSize: '8px',
                fontWeight: 300,
                letterSpacing: '0.55em',
                textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--text-secondary) 55%, transparent)',
              }}
            >
              HİZMET KOORDİNASYONU
            </span>
            <div
              style={{
                height: '1px',
                width: '20px',
                background: 'color-mix(in srgb, var(--text-primary) 15%, transparent)',
              }}
            />
          </motion.div>
        </div>

        {/* Progress bar — var(--status-info) rengi ile premium tasarım */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.5 }}
          className="w-40 overflow-hidden"
          style={{
            height: '1px',
            background: 'color-mix(in srgb, var(--text-primary) 8%, transparent)',
            borderRadius: '1px',
          }}
        >
          <motion.div
            initial={{ scaleX: 0, transformOrigin: 'left' }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.6, duration: 1.0, ease: [0.25, 1, 0.5, 1] }}
            style={{
              height: '100%',
              width: '100%',
              background: 'var(--status-info)',
              transformOrigin: 'left',
              opacity: isDark ? 0.8 : 0.6,
            }}
          />
        </motion.div>
      </div>
    </div>
  );
};
