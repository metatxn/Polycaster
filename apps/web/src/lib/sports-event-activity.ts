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
    sportsMarketType?: string | null;
    umaResolutionStatus?: string | null;
    umaResolutionStatuses?: string | null;
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

function hasResolutionStatus(value?: string | null): boolean {
  if (!value) return false;

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "[]" || normalized === "null") {
    return false;
  }

  return normalized.includes("proposed") || normalized.includes("resolved");
}

function hasResolvedPrimaryMarket(
  event: SportsEventActivityCandidate
): boolean {
  return (event.markets ?? []).some(
    (market) =>
      market.sportsMarketType === "moneyline" &&
      (hasResolutionStatus(market.umaResolutionStatus) ||
        hasResolutionStatus(market.umaResolutionStatuses))
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

export function isLiveOrRecentlyStartedSportsEvent(
  event: SportsEventActivityCandidate,
  nowMs = Date.now()
): boolean {
  if (event.closed === true || event.active === false || event.ended === true) {
    return false;
  }

  if (hasResolvedPrimaryMarket(event)) {
    return false;
  }

  if (event.live === true) {
    return true;
  }

  const eventStartMs = getEventStartMs(event);
  if (eventStartMs === null || eventStartMs >= nowMs) {
    return false;
  }

  return nowMs - eventStartMs <= RECENTLY_STARTED_SPORTS_EVENT_WINDOW_MS;
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
