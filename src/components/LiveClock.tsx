import React from 'react';
import { getTurkeyTimeFormatted } from '../lib/dateUtils';
import { useLiveClock } from '../hooks/useLiveClock';

interface LiveClockProps {
  /** Compact mode: sadece saati tek bir span olarak render eder, dış className uygulanır */
  compact?: boolean;
  className?: string;
}

export function LiveClock({ compact, className }: LiveClockProps = {}) {
  const time = useLiveClock();
  const formattedTime = getTurkeyTimeFormatted(time);

  if (compact || className) {
    return <span className={className ?? 'font-mono tabular-nums'}>{formattedTime}</span>;
  }

  return (
    <div className="flex flex-col gap-1 items-end">
      <div className="flex justify-end items-center gap-1.5 opacity-80">
        <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
        <span className="text-[var(--text-primary)] font-medium text-2xs uppercase tracking-wide">SAAT</span>
      </div>
      <span className="text-[var(--text-secondary)]/70 text-2xs uppercase tracking-[0.1em] font-mono tabular-nums">{formattedTime}</span>
    </div>
  );
}
