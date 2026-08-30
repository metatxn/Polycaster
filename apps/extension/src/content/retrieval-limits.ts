// Keep the audited production limits until the multi-tab proxy capacity check
// completes successfully. The evaluation contract can still exercise wider
// 20-100 candidate snapshots without increasing live search traffic.
export const POLYMARKET_SEARCH_RESULT_LIMIT = 8;
export const COMBINED_SEARCH_RESULT_LIMIT = 10;

export function capPolymarketSearchResults<T>(candidates: T[]): T[] {
  return candidates.slice(0, POLYMARKET_SEARCH_RESULT_LIMIT);
}

export function capCombinedSearchResults<T>(candidates: T[]): T[] {
  return candidates.slice(0, COMBINED_SEARCH_RESULT_LIMIT);
}
