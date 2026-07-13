export interface PolymarketSubMarketIdentity {
  id?: string;
  conditionId?: string;
  slug?: string;
  question?: string;
  groupItemTitle?: string;
}

interface SelectableSubMarketIdentity extends PolymarketSubMarketIdentity {
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
}

function normalizeIdentity(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function matchesOutcomeName(
  market: SelectableSubMarketIdentity | undefined,
  normalizedOutcomeName: string
): boolean {
  if (!market || !normalizedOutcomeName) return false;
  const groupItemTitle = normalizeIdentity(market.groupItemTitle);
  if (groupItemTitle) return groupItemTitle === normalizedOutcomeName;

  const question = normalizeIdentity(market.question);
  return (
    question === normalizedOutcomeName ||
    question.includes(normalizedOutcomeName)
  );
}

function isSelectableMarket(market: SelectableSubMarketIdentity): boolean {
  return (
    market.active !== false &&
    market.closed !== true &&
    market.acceptingOrders !== false
  );
}

export function resolveSelectedMarketIndex(
  markets: readonly SelectableSubMarketIdentity[],
  outcomeName: string,
  preferredIndex: number
): number {
  const normalizedOutcomeName = normalizeIdentity(outcomeName);
  const preferredMarket = markets[preferredIndex];
  if (
    preferredMarket &&
    isSelectableMarket(preferredMarket) &&
    matchesOutcomeName(preferredMarket, normalizedOutcomeName)
  ) {
    return preferredIndex;
  }

  const matchedIndex = markets.findIndex(
    (market) =>
      isSelectableMarket(market) &&
      matchesOutcomeName(market, normalizedOutcomeName)
  );
  return matchedIndex >= 0 ? matchedIndex : preferredIndex;
}

/**
 * Find the current Gamma sub-market corresponding to a locally selected one.
 * Gamma/search result arrays are not a stable identity boundary, so positional
 * lookup is only a last-resort fallback.
 */
export function findMatchingLiveMarket<T extends PolymarketSubMarketIdentity>(
  selectedMarket: PolymarketSubMarketIdentity | undefined,
  liveMarkets: readonly T[],
  fallbackIndex: number
): T | undefined {
  if (selectedMarket) {
    for (const key of ["conditionId", "id", "slug"] as const) {
      const selectedValue = normalizeIdentity(selectedMarket[key]);
      if (!selectedValue) continue;
      const match = liveMarkets.find(
        (market) => normalizeIdentity(market[key]) === selectedValue
      );
      if (match) return match;
    }

    for (const key of ["question", "groupItemTitle"] as const) {
      const selectedValue = normalizeIdentity(selectedMarket[key]);
      if (!selectedValue) continue;
      const match = liveMarkets.find(
        (market) => normalizeIdentity(market[key]) === selectedValue
      );
      if (match) return match;
    }
  }

  return liveMarkets[fallbackIndex];
}
