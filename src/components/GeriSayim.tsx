import React, { useMemo } from 'react';
import {
  VAKIT_GORA_ISIMLERI,
  toTurkishUpperCase,
  calculateLastThirdOfNight,
  calculateVakitProgress,
  calculateKerahatTimes,
  isFriday as isFridayTarih,
} from '../lib/dateUtils';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'motion/react';
import { Vakit } from '../types';
import { KerahatIcon } from './ui/KerahatIcon';
import { useTime } from '../hooks/useTime';

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

// ─────────────────────────────────────────
// Digit display sub-components (Google Neural Expressive Slide Transition)
// ─────────────────────────────────────────
const Digit = ({ char, dim }: { char: string; dim?: boolean }) => {
  return (
    <span className="relative overflow-hidden inline-flex h-[1.1em] justify-center items-center select-none font-sans">
      <AnimatePresence mode="popLayout">
        <motion.span
          key={char}
          initial={{ y: 24, opacity: 0, filter: 'blur(2px)' }}
          animate={{ y: 0, opacity: dim ? 0.7 : 1, filter: 'blur(0px)' }}
          exit={{ y: -24, opacity: 0, filter: 'blur(2px)' }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="inline-block tabular-nums font-extralight tracking-tight"
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

const DigitPair = ({ value, dim }: { value: number; dim?: boolean }) => {
  const str = String(value).padStart(2, '0');
  return (
    <span className="flex items-center gap-[1px]">
      <Digit char={str[0]} dim={dim} />
      <Digit char={str[1]} dim={dim} />
    </span>
  );
};

const VAKIT_DISPLAY_NAMES: Record<Vakit | 'gunes', string> = {
  sabah: 'Sabah',
  gunes: 'Güneş',
  ogle: 'Öğle',
  ikindi: 'İkindi',
  aksam: 'Akşam',
  yatsi: 'Yatsı',
};

// ─────────────────────────────────────────
// Props
// ─────────────────────────────────────────
interface GeriSayimProps {
  /** The next prayer's scheduled time (countdown target for most periods) */
  ezanSaati: Date;
  /** When the current period started */
  baslangicZamani: Date;
  /** Which prayer period we are currently in */
  mevcutVakit: Vakit | 'gunes';
  /** Which prayer is coming next */
  sonrakiVakit: Vakit;
  /** Sabah (imsak) prayer time today */
  imsakSaati?: Date;
  /** Sabah ezan time today (adjusted) */
  sabahEzanSaati?: Date;
  /** Sunrise time today */
  gunesSaati?: Date;
  /** Öğle prayer time today */
  ogleSaati?: Date;
  /** Akşam prayer time today (used for teheccüd calculation) */
  aksamSaati?: Date;
}

// ─────────────────────────────────────────
// Component
// ─────────────────────────────────────────
export function GeriSayim({
  ezanSaati,
  baslangicZamani,
  mevcutVakit,
  sonrakiVakit,
  imsakSaati,
  sabahEzanSaati,
  gunesSaati,
  ogleSaati,
  aksamSaati,
}: GeriSayimProps) {
  const now = useTime();

  // ── Google Neural Expressive: Tactile 3D Parallax Tilt ──
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springConfig = { damping: 28, stiffness: 140 };
  const rotateX = useSpring(useTransform(y, [-200, 200], [10, -10]), springConfig);
  const rotateY = useSpring(useTransform(x, [-200, 200], [-10, 10]), springConfig);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left - width / 2;
    const mouseY = e.clientY - rect.top - height / 2;
    x.set(mouseX);
    y.set(mouseY);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  // ── Decision: what are we counting down to? ──────────────────────────────
  // During the sabah period the card progresses through two sub-targets:
  // 1. While now < güneş → count to "Güneş (Namaz Sonu)"
  // 2. While güneş ≤ now < öğle → count to "Öğle Namazı" (mevcutVakit === 'gunes')
  // All other periods → count to ezanSaati (next prayer).
  const decision = useMemo(() => {
    if (mevcutVakit === 'sabah' && imsakSaati && gunesSaati) {
      const startOfSabah = sabahEzanSaati || imsakSaati;
      // After sabah ezan and before sunrise → show "Güneş (Namaz Sonu)"
      if (now >= startOfSabah && now < gunesSaati) {
        return {
          hedefVakitAdi: 'Güneş (Namaz Sonu)',
          hedefSaati: gunesSaati,
          baslangicSaati: startOfSabah,
        };
      }
    }

    if (mevcutVakit === 'gunes' && gunesSaati && ogleSaati) {
      // After sunrise, before öğle → show "Öğle Namazı"
      return {
        hedefVakitAdi: 'Öğle Namazı',
        hedefSaati: ogleSaati,
        baslangicSaati: gunesSaati,
      };
    }

    // Default: count to next prayer
    return {
      hedefVakitAdi: VAKIT_GORA_ISIMLERI[sonrakiVakit],
      hedefSaati: ezanSaati,
      baslangicSaati: baslangicZamani,
    };
  }, [now, mevcutVakit, imsakSaati, sabahEzanSaati, gunesSaati, ogleSaati, ezanSaati, sonrakiVakit, baslangicZamani]);

  const targetTime = decision.hedefSaati;
  const targetName = decision.hedefVakitAdi;
  const activeBaslangic = decision.baslangicSaati;

  // ── Time remaining ────────────────────────────────────────────────────────
  const farkMs = Math.max(0, targetTime.getTime() - now.getTime());
  const h = Math.floor(farkMs / MS_PER_HOUR);
  const m = Math.floor((farkMs % MS_PER_HOUR) / MS_PER_MINUTE);
  const s = Math.floor((farkMs % MS_PER_MINUTE) / MS_PER_SECOND);

  // ── Teheccüd: last third of the night ────────────────────────────────────
  const teheccudBaslangic = useMemo(() => {
    if (aksamSaati && imsakSaati) {
      // imsakSaati ve aksamSaati o günün ezan vakitleridir. Bu imsakla biten teheccüd dönemi
      // her zaman bir önceki günün akşam vaktine göre hesaplandığı için aksamReferansi sabittir.
      const aksamReferansi = new Date(aksamSaati.getTime() - 24 * MS_PER_HOUR);
      return calculateLastThirdOfNight(aksamReferansi, imsakSaati);
    }
    return null;
  }, [aksamSaati, imsakSaati]);

  const isTeheccud = !!(teheccudBaslangic && imsakSaati && now >= teheccudBaslangic && now < imsakSaati);

  // ── Kerahat times ─────────────────────────────────────────────────────────
  const kerahatTimes = useMemo(() => {
    if (gunesSaati && ogleSaati && aksamSaati) {
      return calculateKerahatTimes(gunesSaati, ogleSaati, aksamSaati);
    }
    return null;
  }, [gunesSaati, ogleSaati, aksamSaati]);

  const isKerahat = useMemo(() => {
    if (!kerahatTimes) return false;
    const { sabah, ogle, aksam } = kerahatTimes;
    return (
      (now >= sabah.baslangic && now < sabah.bitis) ||
      (now >= ogle.baslangic && now < ogle.bitis) ||
      (now >= aksam.baslangic && now < aksam.bitis)
    );
  }, [kerahatTimes, now]);

  // ── Progress ring ─────────────────────────────────────────────────────────
  const progress = calculateVakitProgress(activeBaslangic, targetTime, now);
  const radius = 170;
  const circumference = 2 * Math.PI * radius;

  // ── Contextual flags ──────────────────────────────────────────────────────
  const isFriday = isFridayTarih(now);
  const isCumaVakti = isFriday && sonrakiVakit === 'ogle';

  // ── Aura color ────────────────────────────────────────────────────────────
  // Kerahat/cuma/teheccüd örtüşmesi bilinçli olarak auraTheme.ts'teki temel
  // eşlemeden AYRI tutuluyor (bkz. auraTheme.ts dosya başı yorumu — canlı/
  // global durum için daha zengin bir katman). Ama temel "hangi vakit" dalı
  // (sabah) auraTheme.ts'teki `getActiveAuraColor` ile hizalanmalı — önceden
  // burada amber'e düşüyordu, orada emerald'dı; hero kartının halesi ile bu
  // geri sayım halkası sabah vakti iki farklı renk konuşuyordu (bkz. premium
  // denetim B8, O9).
  const auraColor = isKerahat
    ? 'var(--aura-ruby)'
    : isCumaVakti
      ? 'var(--aura-emerald)'
      : isTeheccud
        ? 'var(--aura-indigo)'
        : mevcutVakit === 'aksam' || mevcutVakit === 'yatsi'
          ? 'var(--aura-ruby)'
          : mevcutVakit === 'sabah'
            ? 'var(--aura-emerald)'
            : 'var(--aura-amber)';

  // ── Ezan is now ───────────────────────────────────────────────────────────
  if (farkMs <= 0) {
    return (
      // w-full max-w-[...] aspect-square: sabit w-[360px]/h-[360px] piksel bu
      // dosyanın geri kalanındaki akışkan boyutlandırma deseninden (bkz.
      // aşağıdaki svg'nin w-full max-w-[...] kullanımı) sapıyordu — dar mobil
      // genişlikte (≤392px) taşan kısım ebeveyn kartın overflow-hidden'ıyla
      // kırpılıyordu (bkz. mobil yerleşim denetimi).
      <div className="relative flex items-center justify-center w-full max-w-[360px] sm:max-w-[400px] aspect-square mx-auto px-6">
        <div
          className="absolute inset-0 rounded-full animate-pulse"
          style={{ background: 'radial-gradient(circle, rgba(16, 185, 129, 0.1) 0%, transparent 70%)' }}
        />
        <span className="authority-title text-emerald-400 text-xs tracking-[0.6em] font-semibold text-center">EZAN OKUNUYOR</span>
      </div>
    );
  }

  // ── Render (Google Neural Expressive UI) ──────────────────────────────────
  return (
    <div className="relative flex flex-col items-center group w-full max-w-[420px] mx-auto select-none" style={{ perspective: 1200 }}>
      <motion.div
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          rotateX,
          rotateY,
          transformStyle: 'preserve-3d',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
        className="w-full flex flex-col items-center"
      >
        {/* ── Header: contextual badge + period title ── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center mb-6 sm:mb-8 text-center relative z-20"
          style={{ transform: 'translateZ(30px)' }}
        >
          <div className="h-10 flex items-center justify-center mb-2 sm:mb-3">
            <AnimatePresence mode="wait">
              {isKerahat ? (
                <motion.div
                  key="kerahat"
                  initial={{ scale: 0.9, opacity: 0, y: 5 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.9, opacity: 0, y: -5 }}
                  className="px-5 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center gap-2.5 shadow-lg shadow-rose-500/5"
                >
                  <KerahatIcon size={14} className="text-rose-500 animate-pulse" />
                  <span className="authority-title !text-2xs text-rose-500 font-bold tracking-wide">KRİTİK: KERAHAT VAKTİ</span>
                </motion.div>
              ) : isTeheccud ? (
                <motion.div
                  key="teheccud"
                  initial={{ scale: 0.9, opacity: 0, y: 5 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.9, opacity: 0, y: -5 }}
                  className="px-5 py-1.5 rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))]/10 border border-[var(--dynamic-aura,var(--aura-indigo))]/20 flex items-center gap-2.5 shadow-lg "
                >
                  <span className="authority-title !text-2xs text-[var(--dynamic-aura,var(--aura-indigo))] font-bold tracking-wide">
                    TEHECCÜD VAKTİ
                  </span>
                </motion.div>
              ) : (
                <motion.div
                  key="periyot"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="flex items-center gap-3"
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full bg-current animate-pulse shadow-[0_0_12px_currentColor]"
                    style={{ color: auraColor }}
                  />
                  <span className="authority-title text-2xs sm:text-2xs opacity-90 tracking-wide font-semibold uppercase">
                    {toTurkishUpperCase(VAKIT_DISPLAY_NAMES[mevcutVakit])} SÜRÜYOR
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <h2
            className="font-extralight tracking-tighter text-4xl sm:text-6xl text-[var(--text-primary)] leading-none transition-all duration-700 vibrant-text"
            style={{
              textShadow: `0 0 40px ${auraColor}18`,
              backgroundImage: `linear-gradient(135deg, var(--text-primary) 0%, ${auraColor} 50%, var(--text-secondary) 100%)`,
            }}
          >
            {toTurkishUpperCase(VAKIT_DISPLAY_NAMES[mevcutVakit])}
          </h2>
        </motion.div>

        {/* ── Central ring ── */}
        <div
          className="relative flex items-center justify-center isolate"
          style={{ transform: 'translateZ(50px)', transformStyle: 'preserve-3d' }}
        >
          {/* Ambient glows (Breathing dynamic chromatic halos) */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none scale-105"
            style={{ background: 'radial-gradient(circle, var(--text-primary) 0%, transparent 70%)', opacity: 0.02 }}
          />
          <motion.div
            className="absolute inset-0 rounded-full scale-95 pointer-events-none"
            animate={{
              scale: [0.93, 1.02, 0.93],
              opacity: [0.1, 0.18, 0.1],
            }}
            transition={{
              duration: 6,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            style={{ background: `radial-gradient(circle, ${auraColor} 0%, transparent 70%)` }}
          />

          {/* Single efficient circadian blob — avoids duplicating global aura */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 overflow-hidden">
            <motion.div
              animate={{
                scale: [0.92, 1.06, 0.92],
                opacity: [0.06, 0.14, 0.06],
              }}
              transition={{
                duration: 10,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              style={{
                width: '340px',
                height: '340px',
                borderRadius: '50%',
                background: `radial-gradient(circle, ${auraColor}20 0%, transparent 70%)`,
                position: 'absolute',
              }}
            />
          </div>

          <svg viewBox="0 0 440 440" className="w-full h-auto max-w-[260px] sm:max-w-[420px] relative z-10 overflow-visible">
            {/* Track */}
            <circle
              cx="220"
              cy="220"
              r={radius}
              fill="none"
              stroke="currentColor"
              className="text-[var(--text-primary)]"
              strokeOpacity="0.09"
              strokeWidth="1"
            />
            {/* Glow ring (Breathing dynamic pulse stroke) */}
            <motion.circle
              cx="220"
              cy="220"
              r={radius}
              fill="none"
              stroke={auraColor}
              animate={{
                strokeWidth: [4, 7, 4],
                strokeOpacity: [0.15, 0.28, 0.15],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              strokeLinecap="round"
              transform="rotate(-90 220 220)"
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
            {/* Progress ring */}
            <circle
              cx="220"
              cy="220"
              r={radius}
              fill="none"
              stroke={auraColor}
              strokeOpacity="0.95"
              strokeWidth="2"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              strokeLinecap="round"
              transform="rotate(-90 220 220)"
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
            {/* Orbit dot glow */}
            <motion.circle
              cx="220"
              cy={220 - radius}
              r="8"
              fill="white"
              fillOpacity="0.2"
              transform={`rotate(${360 * progress} 220 220)`}
              style={{
                transition: 'transform 1s linear',
                filter: `drop-shadow(0 0 8px ${auraColor})`,
              }}
            />
            {/* Orbit dot core (Elastic Pulsing Physics) */}
            <motion.circle
              cx="220"
              cy={220 - radius}
              fill="white"
              animate={{
                r: [3, 4.5, 3],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              transform={`rotate(${360 * progress} 220 220)`}
              style={{
                transition: 'transform 1s linear',
                filter: `drop-shadow(0 0 4px white)`,
              }}
            />
          </svg>

          {/* ── Centerpiece: digital countdown ── */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center text-center z-10"
            style={{ transform: 'translateZ(40px)' }}
          >
            <div className="flex flex-col items-center gap-1 px-6 py-5 sm:px-8 sm:py-7">
              <div className="flex items-center gap-2 sm:gap-3">
                {/* Hours */}
                <div className="flex flex-col items-center">
                  <div
                    className="flex items-center text-[var(--text-primary)] font-light tracking-tighter"
                    style={{ fontSize: 'clamp(34px, 8.5vw, 68px)', lineHeight: 1 }}
                  >
                    <DigitPair value={h} />
                  </div>
                  <span className="authority-title !text-2xs opacity-60 tracking-wide font-bold mt-1">SAAT</span>
                </div>

                <motion.span
                  animate={{ opacity: [0.15, 0.95, 0.15] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="text-xl sm:text-2xl -translate-y-2 font-light text-[var(--text-primary)]/45"
                >
                  :
                </motion.span>

                {/* Minutes */}
                <div className="flex flex-col items-center">
                  <div
                    className="flex items-center text-[var(--text-primary)] font-light tracking-tighter"
                    style={{ fontSize: 'clamp(34px, 8.5vw, 68px)', lineHeight: 1 }}
                  >
                    <DigitPair value={m} />
                  </div>
                  <span className="authority-title !text-2xs opacity-60 tracking-wide font-bold mt-1">DAKİKA</span>
                </div>

                <motion.span
                  animate={{ opacity: [0.15, 0.95, 0.15] }}
                  transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                  className="text-xl sm:text-2xl -translate-y-2 font-light text-[var(--text-primary)]/45"
                >
                  :
                </motion.span>

                {/* Seconds */}
                <div className="flex flex-col items-center">
                  <div
                    className="flex items-center text-[var(--text-primary)] font-light tracking-tighter"
                    style={{ fontSize: 'clamp(34px, 8.5vw, 68px)', lineHeight: 1 }}
                  >
                    <DigitPair value={s} dim />
                  </div>
                  <span className="authority-title !text-2xs opacity-60 tracking-wide font-bold mt-1">SANİYE</span>
                </div>
              </div>

              {/* Target label */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="mt-4 sm:mt-5 flex flex-col items-center"
              >
                <div
                  className={`px-4 py-1.5 rounded-full border transition-all duration-700 ${
                    isCumaVakti
                      ? 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(52,211,153,0.08)]'
                      : 'bg-[var(--surface-medium)] border-[var(--glass-border)]'
                  }`}
                >
                  <span
                    className={`authority-title !text-2xs tracking-wide font-semibold ${
                      isCumaVakti ? 'text-emerald-400 opacity-100' : 'text-[var(--text-secondary)] opacity-80'
                    }`}
                  >
                    BEKLENEN: {isCumaVakti ? 'CUMA NAMAZI' : toTurkishUpperCase(targetName)}
                  </span>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
