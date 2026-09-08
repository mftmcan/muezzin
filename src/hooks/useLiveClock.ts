import { useTime } from './useTime';

/**
 * useLiveClock — Optimized version using global useTime tick.
 */
export function useLiveClock() {
  return useTime();
}
