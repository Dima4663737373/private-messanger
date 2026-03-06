// Transaction fee: same as tipzo Profile / QuickDonate (50000 — works in tipzo)
export const TRANSACTION_FEE = 50000;

// For balance check / "Need X ALEO" display (0.01 ALEO = 10^10 microcredits)
export const MIN_FEE_MICROCREDITS = 10_000_000_000;

/** Safely convert a value to a numeric timestamp. Returns 0 if NaN/invalid. */
export function safeTimestamp(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
