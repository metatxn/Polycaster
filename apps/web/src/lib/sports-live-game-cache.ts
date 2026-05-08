export const SPORTS_LIVE_GAME_CACHE_TTL_MS = 5 * 60 * 1000;

export interface CachedSportsLiveGame {
  gameId?: string | number;
  leagueAbbreviation?: string;
  slug?: string;
  homeTeam?: string;
  awayTeam?: string;
  status?: string;
  score?: string;
  period?: string;
  elapsed?: string | number;
  live?: boolean;
  ended?: boolean;
  updatedAt?: string;
  receivedAt: number;
}

export interface SportsLiveEventSnapshot {
  score?: string;
  period?: string;
  elapsed?: string | number;
  live?: boolean;
  ended?: boolean;
  closed?: boolean;
  updatedAt?: string;
}

export function sportsLiveGameCacheKey(eventSlugOrId: string): string {
  return `sports-live-game:${eventSlugOrId}`;
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasScore(game: CachedSportsLiveGame): boolean {
  return Boolean(game.score?.trim());
}

export function isCachedSportsLiveGameFresh(
  game: CachedSportsLiveGame,
  now = Date.now(),
  ttlMs = SPORTS_LIVE_GAME_CACHE_TTL_MS
): boolean {
  return Number.isFinite(game.receivedAt) && now - game.receivedAt <= ttlMs;
}

export function shouldUseCachedSportsLiveGame(
  game: CachedSportsLiveGame | null,
  event: SportsLiveEventSnapshot | null | undefined,
  now = Date.now()
): game is CachedSportsLiveGame {
  if (!game || !hasScore(game)) return false;
  if (!isCachedSportsLiveGameFresh(game, now)) return false;
  if (event?.ended || event?.closed) return false;

  const cachedUpdatedAt = parseTimestamp(game.updatedAt);
  const eventUpdatedAt = parseTimestamp(event?.updatedAt);

  if (cachedUpdatedAt !== null && eventUpdatedAt !== null) {
    return cachedUpdatedAt >= eventUpdatedAt;
  }

  return event?.score ? game.live === true : true;
}

export function readCachedSportsLiveGame(
  storage: Pick<Storage, "getItem" | "removeItem">,
  key: string,
  event: SportsLiveEventSnapshot | null | undefined,
  now = Date.now()
): CachedSportsLiveGame | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSportsLiveGame;
    if (shouldUseCachedSportsLiveGame(parsed, event, now)) return parsed;
    storage.removeItem(key);
    return null;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeCachedSportsLiveGame(
  storage: Pick<Storage, "setItem">,
  key: string,
  game: CachedSportsLiveGame
): void {
  if (!hasScore(game)) return;
  storage.setItem(key, JSON.stringify(game));
}
