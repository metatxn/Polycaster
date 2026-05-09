export const RECENTLY_STARTED_SPORTS_EVENT_WINDOW_MS = 8 * 60 * 60 * 1000;

export type SportsEventActivityCandidate = {
  active?: boolean;
  closed?: boolean;
  ended?: boolean;
  live?: boolean;
  startDate?: string | null;
  startTime?: string | null;
  endDate?: string | null;
  markets?: Array<{
    gameStartTime?: string | null;
  }>;
};

function parseGammaDate(value?: string | null): number | null {
  if (!value) return null;

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const timestamp = Date.parse(normalized);

  return Number.isNaN(timestamp) ? null : timestamp;
}

function getEarliestMarketStartMs(
  markets: SportsEventActivityCandidate["markets"]
): number | null {
  if (!markets?.length) return null;

  let earliest: number | null = null;

  for (const market of markets) {
    const marketStartMs = parseGammaDate(market.gameStartTime);

    if (
      marketStartMs !== null &&
      (earliest === null || marketStartMs < earliest)
    ) {
      earliest = marketStartMs;
    }
  }

  return earliest;
}

function getEventStartMs(event: SportsEventActivityCandidate): number | null {
  return (
    parseGammaDate(event.startTime) ??
    getEarliestMarketStartMs(event.markets) ??
    parseGammaDate(event.startDate)
  );
}

export function isCurrentSportsEvent(
  event: SportsEventActivityCandidate,
  nowMs = Date.now()
): boolean {
  if (event.closed === true || event.active === false || event.ended === true) {
    return false;
  }

  if (event.live === true) {
    return true;
  }

  const eventStartMs = getEventStartMs(event);
  const eventEndMs = parseGammaDate(event.endDate);

  if (eventStartMs !== null) {
    if (eventStartMs >= nowMs) {
      return true;
    }

    return nowMs - eventStartMs <= RECENTLY_STARTED_SPORTS_EVENT_WINDOW_MS;
  }

  if (eventEndMs !== null) {
    return eventEndMs >= nowMs;
  }

  return true;
}

export function isUpcomingSportsEvent(
  event: SportsEventActivityCandidate,
  nowMs = Date.now()
): boolean {
  if (event.closed === true || event.active === false || event.ended === true) {
    return false;
  }

  const eventStartMs = getEventStartMs(event);
  if (eventStartMs !== null) {
    return eventStartMs >= nowMs;
  }

  const eventEndMs = parseGammaDate(event.endDate);
  if (eventEndMs !== null) {
    return eventEndMs >= nowMs;
  }

  return true;
}
