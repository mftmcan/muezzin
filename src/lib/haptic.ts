/**
 * haptic.ts — Premium Apple-Style Taptic Engine Haptic Feedback Simulator
 * Uses the native client-side Web Vibration API (100% free, zero external dependencies).
 */

/**
 * Very short, crisp tap (e.g. key press, dock icon tap, toggle switch)
 */
export const kullaniciEtkilesimiVarMi = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean; hasBeenActive: boolean } }).userActivation;
  // Eski tarayıcılarda API yoksa önceki davranışı koru. API varsa autoplay/
  // vibration politikasını ihlal edecek programatik çağrıları hiç deneme.
  return !activation || activation.isActive || activation.hasBeenActive;
};

const titre = (pattern: VibratePattern): void => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && kullaniciEtkilesimiVarMi()) {
    navigator.vibrate(pattern);
  }
};

export const hapticLight = (): void => {
  titre(8);
};

/**
 * Slightly more pronounced tap (e.g. opening modal, drawer selection)
 */
export const hapticMedium = (): void => {
  titre(18);
};

/**
 * Double-pulse signature tap for successful tasks/syncs
 */
export const hapticSuccess = (): void => {
  titre([12, 30, 15]);
};

/**
 * Rapid triple-pulse warning tap for errors, blocks, or deletions
 */
export const hapticWarning = (): void => {
  titre([20, 40, 20, 40, 20]);
};

/**
 * Stronger double-pulse tap specifically for Qibla alignment locking (Android/Chrome)
 */
export const hapticQiblaLock = (): void => {
  titre([100, 50, 100]);
};
