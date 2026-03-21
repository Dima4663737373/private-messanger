// Re-export from centralized constants to avoid duplicates
export { TRANSACTION_FEE, MIN_FEE_MICROCREDITS } from '../constants';

/** Safely convert a value to a numeric timestamp. Returns 0 if NaN/invalid. */
export function safeTimestamp(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
