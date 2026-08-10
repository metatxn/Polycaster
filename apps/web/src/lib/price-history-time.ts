const SECONDS_PER_MINUTE = 60;

/**
 * Align moving chart windows to their sampling boundary. Requests made during
 * the same fidelity bucket then share one server/cache key instead of creating
 * a distinct key for every render second.
 */
export function alignPriceHistoryStartTs(
  startTs: number,
  fidelityMinutes: number
): number {
  const safeFidelity =
    Number.isFinite(fidelityMinutes) && fidelityMinutes > 0
      ? Math.floor(fidelityMinutes)
      : 1;
  const bucketSeconds = safeFidelity * SECONDS_PER_MINUTE;
  return Math.floor(startTs / bucketSeconds) * bucketSeconds;
}
