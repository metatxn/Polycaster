// ============================================
// STREAM BET LOGIC — pure helpers for the compact stream betting widget
// ============================================
// No DOM, no globals: stake stepping, holding selection, sell readiness, and
// label/price formatting. Unit-testable in the node test env. The DOM builder
// (buildStreamBetting in ui.ts) imports these and renders around them.
// ============================================

/** Dollar increment for the stream stake stepper. */
export const STREAM_STAKE_STEP = 1;

/** Floor for a stream stake (USD). Min order size (in shares) is enforced at
 *  placement; the stepper just keeps the amount at or above $1. */
export const STREAM_STAKE_MIN = 1;

/**
 * Clamp a USD stake to whole dollars within [min, ceiling]. A `max` of 0 (or any
 * non-positive value) means "no ceiling" — balance unknown / not funded, so the
 * user can dial in the amount they intend to deposit. When `max > 0` the ceiling
 * is the floored balance, but never below `min`.
 */
export function clampStake(
  stake: number,
  min = STREAM_STAKE_MIN,
  max = 0
): number {
  let next = Number.isFinite(stake) ? Math.round(stake) : min;
  if (max > 0) {
    const ceiling = Math.max(min, Math.floor(max));
    if (next > ceiling) next = ceiling;
  }
  if (next < min) next = min;
  return next;
}

/** Step a stake up (+1) or down (-1) by STREAM_STAKE_STEP, then clamp. */
export function stepStake(
  current: number,
  dir: 1 | -1,
  min = STREAM_STAKE_MIN,
  max = 0
): number {
  return clampStake(current + dir * STREAM_STAKE_STEP, min, max);
}
