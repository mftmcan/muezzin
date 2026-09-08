import { useState, useEffect } from 'react';
import { getTurkeyNow } from '../lib/dateUtils';

// Global Observer variables to share a single saniyelik interval across all subscribers
let globalNow = getTurkeyNow();
const listeners = new Set<(date: Date) => void>();
let globalTimeout: NodeJS.Timeout | null = null;
let globalInterval: NodeJS.Timeout | null = null;

function updateTime() {
  globalNow = getTurkeyNow();
  listeners.forEach((listener) => listener(globalNow));
}

function startGlobalClock() {
  if (globalTimeout || globalInterval) return;

  const msToNextSecond = 1000 - new Date().getMilliseconds();
  globalTimeout = setTimeout(() => {
    updateTime();
    globalInterval = setInterval(updateTime, 1000);
  }, msToNextSecond);
}

function stopGlobalClock() {
  if (globalTimeout) {
    clearTimeout(globalTimeout);
    globalTimeout = null;
  }
  if (globalInterval) {
    clearInterval(globalInterval);
    globalInterval = null;
  }
}

/**
 * useTime — Global synchronized clock hook.
 * Shares a single global interval across all subscribers to conserve CPU & battery.
 */
export function useTime() {
  // `globalNow` son abone ayrılınca donuyor (saat durduruluyor) — yeni bir
  // abone dakikalar sonra mount olursa `useState(globalNow)` bayat bir
  // zamanla ilk render'ı yapardı (düzelme ancak bir sonraki saniye tick'ine
  // kadar gecikirdi). Taze bir başlangıç değeri için lazy initializer
  // kullanılır (düşük öncelikli bulgu).
  const [now, setNow] = useState(() => getTurkeyNow());

  useEffect(() => {
    listeners.add(setNow);
    startGlobalClock();

    return () => {
      listeners.delete(setNow);
      if (listeners.size === 0) {
        stopGlobalClock();
      }
    };
  }, []);

  return now;
}

/**
 * useMinuteTick — Synchronized minute watcher.
 */
export function useMinuteTick() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const now = new Date();
    const delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    let interval: NodeJS.Timeout;
    const timeout = setTimeout(() => {
      setTick((t) => t + 1);
      interval = setInterval(() => setTick((t) => t + 1), 60000);
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  return tick;
}
