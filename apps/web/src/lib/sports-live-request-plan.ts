type SportsEventLike = {
  slug?: string;
  title?: string;
  markets?: Array<{
    groupItemTitle?: string;
    question?: string;
    sportsMarketType?: string;
  }>;
};

export function shouldFetchScheduledSportsFallback({
  liveQueryLoading,
}: {
  liveQueryLoading: boolean;
  liveEventCount: number;
}): boolean {
  return !liveQueryLoading;
}

function needsCompanionMarkets(event: SportsEventLike): boolean {
  if (
    !event.slug ||
    event.title?.toLowerCase().includes("more markets") ||
    !event.slug.match(/-\d{4}-\d{2}-\d{2}$/)
  ) {
    return false;
  }

  const markets = event.markets ?? [];
  if (markets.length === 0) return false;

  const hasSpreadOrTotal = markets.some((market) => {
    const text =
      `${market.sportsMarketType ?? ""} ${market.groupItemTitle ?? ""} ${market.question ?? ""}`.toLowerCase();
    return (
      text.includes("spread") ||
      text.includes("total") ||
      text.includes("o/u") ||
      text.includes("over/under")
    );
  });

  return !hasSpreadOrTotal;
}

export function getInitialCompanionMarketSlugs(
  events: SportsEventLike[],
  maxFetches: number
): string[] {
  if (maxFetches <= 0) return [];

  return events
    .filter(needsCompanionMarkets)
    .slice(0, maxFetches)
    .map((event) => `${event.slug}-more-markets`);
}
