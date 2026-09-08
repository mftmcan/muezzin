import React from 'react';
import { motion } from 'motion/react';
import { Shield, Sparkles, CheckCircle2, Hourglass, Compass } from 'lucide-react';
import { toTurkishUpperCase } from '../lib/dateUtils';

interface GorevliKartiProps {
  tip: 'asil' | 'yedek';
  isim?: string;
  durum?: 'bekliyor' | 'onaylandi' | 'reddedildi';
  isUser?: boolean;
  izinde?: boolean;
  isFriday: boolean;
}

const PersonaAvatar = React.memo(({ name, colorClass, isUser }: { name: string; colorClass: string; isUser: boolean }) => {
  // toTurkishUpperCase (bkz. src/lib/dateUtils.ts) — locale'siz .toUpperCase()
  // bir isim baş harfi "i"/"ı" ise yanlış büyütür, ör. "ismail" -> "IK" değil "İK".
  const initials =
    name === 'Sistem'
      ? 'SA'
      : toTurkishUpperCase(
          (name || '')
            .split(' ')
            .filter(Boolean)
            .map((n) => n.charAt(0))
            .join('')
        ).slice(0, 2) || '??';

  return (
    <div
      className={`w-12 h-12 sm:w-16 sm:h-16 rounded-avatar sm:rounded-icon flex items-center justify-center relative overflow-hidden border border-[var(--glass-border)] shadow-lg transition-all duration-500 ${colorClass} ${isUser ? 'animate-heartbeat' : ''}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--specular-glow)] to-transparent opacity-30" />
      <span
        className={`text-lg sm:text-xl font-semibold tracking-tight relative z-10 ${isUser ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]/70'}`}
      >
        {initials}
      </span>
      {isUser && (
        <div className="absolute bottom-1 right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[var(--app-bg)] z-20 shadow-[0_0_8px_rgba(16,185,129,0.7)]">
          <div className="absolute inset-0 bg-emerald-500 rounded-full animate-ping-slow" />
        </div>
      )}
    </div>
  );
});

export const GorevliKarti = React.memo(({ tip, isim, durum, isUser, izinde, isFriday }: GorevliKartiProps) => {
  const isAsil = tip === 'asil';
  const isUnassigned = !isim || isim === 'Bilinmiyor';

  const hoverTextClass = isFriday
    ? 'group-hover:text-emerald-400'
    : isAsil
      ? 'group-hover:text-[var(--dynamic-aura,var(--aura-indigo))]'
      : 'group-hover:text-amber-400';

  const kartClass = isUser
    ? isFriday
      ? 'spatial-glass-elevated !bg-emerald-500/[0.015] border-emerald-500/25 shadow-emerald-500/5'
      : isAsil
        ? 'spatial-glass-elevated !bg-[var(--dynamic-aura,var(--aura-indigo))]/[0.015] border-[var(--dynamic-aura,var(--aura-indigo))]/25 '
        : 'spatial-glass-elevated !bg-amber-500/[0.015] border-amber-500/25 shadow-amber-500/5'
    : isUnassigned
      ? 'bg-transparent border-dashed animate-pulse'
      : 'spatial-glass hover:bg-[var(--text-primary)]/[0.015]';

  // Dynamic border color
  const unassignedBorderStyle = isUnassigned
    ? {
        border: '1.5px dashed var(--dynamic-aura, rgba(255, 255, 255, 0.15))',
        boxShadow: '0 0 15px -3px var(--dynamic-aura, rgba(255, 255, 255, 0.05))',
      }
    : undefined;

  // Dynamic spatial theme under-glow on hover
  const hoverGlowClass = isFriday
    ? 'hover:border-emerald-500/35 hover:shadow-[0_20px_40px_-15px_rgba(16,185,129,0.1)]'
    : isAsil
      ? 'hover:border-[var(--dynamic-aura,var(--aura-indigo))]/35 hover:shadow-[0_20px_40px_-15px_color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 20%, transparent)]'
      : 'hover:border-amber-500/35 hover:shadow-[0_20px_40px_-15px_rgba(245,158,11,0.1)]';

  const gradientColor = isFriday
    ? 'rgba(16,185,129,1)'
    : isAsil
      ? 'color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 20%, transparent)'
      : 'rgba(245,158,11,1)';

  const titleText = isAsil ? (isFriday ? 'CUMA ASİLİ' : 'ASİL GÖREVLİ') : isFriday ? 'CUMA YEDEĞİ' : 'YEDEK GÖREVLİ';

  const titleColorClass = isUser
    ? isFriday
      ? 'text-emerald-400 opacity-100 font-semibold'
      : isAsil
        ? 'text-[var(--dynamic-aura,var(--aura-indigo))] opacity-100 font-semibold'
        : 'text-amber-400 opacity-100 font-semibold'
    : isUnassigned
      ? 'text-faint'
      : 'opacity-35';

  const dotColorClass = isUser
    ? isFriday
      ? 'bg-emerald-400 shadow-[0_0_10px_rgb(52,211,153)]'
      : isAsil
        ? 'bg-[var(--dynamic-aura,var(--aura-indigo))]'
        : 'bg-amber-400'
    : isUnassigned
      ? 'bg-[var(--dynamic-aura,rgba(255,255,255,0.4))]'
      : 'bg-[var(--text-primary)]/20';

  const avatarColorClass = isUser
    ? isFriday
      ? 'bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 text-[var(--app-bg)] shadow-lg border-emerald-400/30'
      : isAsil
        ? 'bg-gradient-to-br from-[var(--dynamic-aura,var(--aura-indigo))] via-[var(--dynamic-aura,var(--aura-indigo))] to-violet-700 text-[var(--app-bg)] shadow-lg border-[var(--dynamic-aura,var(--aura-indigo))]/30'
        : 'bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-600 text-[var(--app-bg)] shadow-lg border-amber-400/30'
    : isUnassigned
      ? 'bg-[var(--text-primary)]/[0.01] text-subtle border-[var(--text-primary)]/[0.03] border-dashed'
      : 'bg-[var(--text-primary)]/[0.03] text-faint border-[var(--text-primary)]/[0.06]';

  const badgeText = isAsil ? 'ASİL KADRO' : 'DESTEK KUVVET';
  const badgeClass = isAsil ? (isFriday ? 'badge-glow-emerald' : 'badge-glow-indigo') : 'badge-glow-amber';

  return (
    <motion.div
      layout
      transition={{
        layout: { type: 'spring', stiffness: 220, damping: 25 },
      }}
      style={unassignedBorderStyle}
      className={`relative p-6 sm:p-8 transition-all duration-500 overflow-hidden group !rounded-card border border-[var(--glass-border)] hover:-translate-y-1 ${kartClass} ${hoverGlowClass}`}
    >
      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-[var(--specular-glow)] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none" />
      <div
        className={`absolute top-0 right-0 w-48 h-48 rounded-full -translate-y-1/2 translate-x-1/2 transition-opacity duration-700 pointer-events-none ${isFriday ? 'opacity-10' : 'opacity-5 group-hover:opacity-8'}`}
        style={{ background: `radial-gradient(circle, ${gradientColor} 0%, transparent 70%)` }}
      />

      <div className="flex flex-col gap-6 relative z-10">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div className="flex items-center gap-4 sm:gap-5">
            <PersonaAvatar name={isim || ''} isUser={!!isUser} colorClass={avatarColorClass} />
            <div>
              <div className="flex items-center gap-2 mb-2 sm:mb-2.5">
                <div className="relative w-1.5 h-1.5 shrink-0">
                  <div className={`absolute inset-0 rounded-full ${dotColorClass}`} />
                  {isUnassigned && (
                    <div className="absolute inset-0 rounded-full bg-[var(--dynamic-aura,rgba(255,255,255,0.4))] animate-ping-slow" />
                  )}
                </div>
                <span className={`authority-title !text-2xs tracking-wide font-semibold ${titleColorClass}`}>{titleText}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <h3
                  className={`text-2xl sm:text-3xl font-light tracking-tight leading-none text-[var(--text-primary)] ${hoverTextClass} transition-all duration-500 group-hover:font-normal group-active:font-semibold`}
                >
                  {isim === 'Sistem' ? 'Otonom Atama' : isim && isim !== 'Bilinmiyor' ? isim : 'BOŞ KADRO'}
                </h3>
                {isim && isim !== 'Bilinmiyor' && isim !== 'Sistem' && (
                  <div className={`mt-0.5 inline-flex items-center gap-1.5 ${badgeClass}`}>
                    {isAsil ? <Sparkles size={9} className="opacity-80" /> : <Shield size={9} className="opacity-80" />}
                    <span>{badgeText}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 min-w-[7rem] justify-end shrink-0">
            {/* NOT (mimari denetim — bütünsel hata analizi): bu üç durum
                rozeti (AKTİF/BEKLEYİŞTE/MEŞRU MAZERET) hardcoded Tailwind
                emerald/amber/rose kullanıyordu; GorevKarti.tsx/HaftalikTakvim.tsx
                gibi aynı anlamdaki durum göstergeleri `--status-success/
                warning/danger` token'larını kullanıyor. */}
            {durum === 'onaylandi' && (
              <div
                className={`flex items-center gap-2 px-4 py-1.5 rounded-[14px] border transition-all duration-500 ${isFriday ? 'bg-[var(--status-success)]/10 border-[var(--status-success)]/30' : 'bg-[var(--status-success)]/10 border-[var(--status-success)]/20'}`}
              >
                <CheckCircle2 size={11} className="text-[var(--status-success)] shadow-sm" />
                <span className="text-2xs font-bold uppercase tracking-wide text-[var(--status-success)]">AKTİF</span>
              </div>
            )}
            {durum === 'bekliyor' && (
              // MuezzinAnaEkran.tsx:217-222'deki aynı "gorev-akisi'ne kaydır"
              // eylemiyle aynı desen — burada bare bir <div onClick> kullanılıyordu,
              // klavye/ekran okuyucu ile erişilemiyordu (bkz. mimari denetim —
              // üçüncü tur).
              <motion.button
                type="button"
                onClick={() => document.getElementById('gorev-akisi')?.scrollIntoView({ behavior: 'smooth' })}
                className="flex items-center gap-2 px-4 py-1.5 rounded-[14px] bg-[var(--status-warning)]/10 border border-[var(--status-warning)]/20 shadow-sm cursor-pointer hover:bg-[var(--status-warning)]/15 transition-all"
              >
                <Hourglass size={11} className="text-[var(--status-warning)] animate-spin" style={{ animationDuration: '4s' }} />
                <span className="text-2xs font-bold uppercase tracking-wide text-[var(--status-warning)]">BEKLEYİŞTE</span>
              </motion.button>
            )}
            {izinde && (
              <div className="flex items-center gap-2 px-4 py-1.5 rounded-[14px] bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/20 shadow-sm">
                <Compass size={11} className="text-[var(--status-danger)]" />
                <span className="text-2xs font-bold uppercase tracking-wide text-[var(--status-danger)]">MEŞRU MAZERET</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
});
