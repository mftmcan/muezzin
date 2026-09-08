/**
 * haptic.ts — Premium Apple-Style Taptic Engine Haptic Feedback Simulator
 * Uses the native client-side Web Vibration API (100% free, zero external dependencies).
 */

/**
 * Very short, crisp tap (e.g. key press, dock icon tap, toggle switch)
 */
export const hapticLight = (): void => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(8);
  }
};

/**
 * Slightly more pronounced tap (e.g. opening modal, drawer selection)
 */
export const hapticMedium = (): void => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(18);
  }
};

/**
 * Double-pulse signature tap for successful tasks/syncs
 */
export const hapticSuccess = (): void => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([12, 30, 15]);
  }
};

/**
 * Rapid triple-pulse warning tap for errors, blocks, or deletions
 */
export const hapticWarning = (): void => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([20, 40, 20, 40, 20]);
  }
};

/**
 * Stronger double-pulse tap specifically for Qibla alignment locking (Android/Chrome)
 */
export const hapticQiblaLock = (): void => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([100, 50, 100]);
  }
};
