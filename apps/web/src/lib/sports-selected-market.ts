interface SelectedSportsMarketRef {
  eventId: string;
  marketId: string;
}

interface SportsEventWithMarkets {
  id: string;
  markets?: Array<{ id: string }>;
}

export function selectedSportsMarketExists(
  selectedMarket: SelectedSportsMarketRef | null,
  events: SportsEventWithMarkets[]
): boolean {
  if (!selectedMarket) return false;

  const event = events.find((item) => item.id === selectedMarket.eventId);
  if (!event) return false;

  return (event.markets ?? []).some(
    (market) => market.id === selectedMarket.marketId
  );
}
