/**
 * sounds.ts — Web Audio API Premium Sound Synthesizer Engine
 * Generates beautiful, lightweight, and responsive sound effects locally.
 * 100% offline-friendly, 0KB asset footprint, and Spark/Free Tier compatible.
 */

import { hapticLight, hapticSuccess, hapticWarning } from './haptic';

// Lazily initialized global AudioContext
let audioCtx: AudioContext | null = null;

export const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  // 'closed' bir kez ulaşılınca geri dönüşü olmayan bir durumdur — önbelleklenen
  // context'i atıp yeniden oluşturuyoruz, aksi halde tüm sonraki çağrılar sessizce
  // ölü bir context üzerinde çalışıp hiçbir şey çalmaz.
  if (audioCtx && audioCtx.state === 'closed') {
    audioCtx = null;
  }
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  // Try to resume if it was suspended by browser autoplay policy
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

/**
 * Synthesizes a premium crisp key click / glass tick sound (duration: ~15ms)
 */
export const playClick = (): void => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Trigger haptic vibration in parallel
    hapticLight();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Fast frequency decay from 1600Hz down to 80Hz
    osc.frequency.setValueAtTime(1600, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.015);

    // Ultra fast gain decay to prevent popping
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.02);
  } catch (err) {
    console.warn('Web Audio Click Sound Playback failed:', err);
  }
};

/**
 * Synthesizes a warm, double-note royal chime for successful tasks/syncs
 */
export const playSuccess = (): void => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Trigger success haptic vibration
    hapticSuccess();

    const now = ctx.currentTime;

    // Note 1: C5 (523.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle'; // Warm woodwind tone
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.4);

    // Note 2: G5 (783.99 Hz) played 90ms later
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine'; // Pure bell tone
    osc2.frequency.setValueAtTime(783.99, now + 0.09);
    gain2.gain.setValueAtTime(0.0, now);
    gain2.gain.setValueAtTime(0.08, now + 0.09);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.5);
  } catch (err) {
    console.warn('Web Audio Success Sound Playback failed:', err);
  }
};

/**
 * Synthesizes a precise mechanical watch-crystal click chime for Qibla compass alignment lock
 */
export const playQiblaLock = (): void => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    // Precise mechanical lock click chime frequency sweep
    osc.frequency.setValueAtTime(1000, now);
    osc.frequency.exponentialRampToValueAtTime(1800, now + 0.03);

    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.start(now);
    osc.stop(now + 0.13);
  } catch (err) {
    console.warn('Web Audio Qibla Lock Sound Playback failed:', err);
  }
};

/**
 * Synthesizes a soft dual-tone warning chime for alerts or errors
 */
export const playWarning = (): void => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Trigger warning haptic vibration
    hapticWarning();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth'; // Slight buzz for warning feel
    // Lowpass filter to make sawtooth smooth and not harsh
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);

    osc.frequency.setValueAtTime(330, now); // E4
    osc.frequency.setValueAtTime(293.66, now + 0.12); // D4

    gain.gain.setValueAtTime(0.04, now);
    gain.gain.setValueAtTime(0.04, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  } catch (err) {
    console.warn('Web Audio Warning Sound Playback failed:', err);
  }
};
