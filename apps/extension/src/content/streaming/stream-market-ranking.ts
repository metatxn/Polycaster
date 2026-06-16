import type { Market } from "../../types/market";
import type { StreamContext } from "../../types/platform";

const DEFAULT_MAX_STREAM_MARKETS = 12;
const SIDE_STOP_WORDS = new Set([
  "bo1",
  "bo3",
  "bo5",
  "broadcast",
  "english",
  "live",
  "main",
  "official",
  "stream",
  "team",
  "vs",
  "v",
]);

type RankedMarket = {
  market: Market;
  score: number;
};

export type StreamMarketRankingInput = {
  ctx: StreamContext;
  matchFound: Market[];
  gameFound: Market[];
  maxMarkets?: number;
};

/** Build the query for the unified market search from the stream context. */
export function buildQuery(ctx: StreamContext): string {
  return (ctx.game || ctx.title || "").trim();
}

/**
 * Extract the watched "Team A vs Team B" match-up from a stream title.
 * Twitch esports titles often prefix the match with broadcast labels, e.g.
 * "Main Broadcast: LIVE: Team Vitality vs MOUZ - IEM Cologne Major 2026".
 */
export function buildMatchQuery(title: string): string {
  if (!title) return "";

  const candidates: string[] = [];
  for (const segment of title.split(/\s[-–—|•]\s/)) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    candidates.push(trimmed);

    const colonParts = trimmed
      .split(/\s*:\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    candidates.push(...colonParts);
    for (let i = 1; i < colonParts.length; i += 1) {
      candidates.push(colonParts.slice(i).join(": "));
    }
  }

  return (
    candidates
      .filter((candidate) => /\bvs?\.?\b/i.test(candidate))
      .sort((a, b) => a.length - b.length)[0] || ""
  );
}

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Significant game tokens (>=4 chars, no pure numbers) from the game name + slug.
 * e.g. "Dota 2" -> ["dota"], "Counter-Strike 2" -> ["counter","strike"].
 */
function gameTokens(ctx: StreamContext): string[] {
  const base = `${ctx.game || ""} ${(ctx.gameSlug || "").replace(/-/g, " ")}`;
  return Array.from(
    new Set(
      normalizeTokens(base).filter(
        (token) => token.length >= 4 && !/^\d+$/.test(token)
      )
    )
  );
}

function marketSearchText(market: Market): string {
  return [
    market.title || "",
    market.slug || "",
    ...(market.tags || []).map((tag) => `${tag.label || ""} ${tag.slug || ""}`),
    ...(market.markets || []).flatMap((nested) => [
      nested.question || "",
      nested.groupItemTitle || "",
      nested.slug || "",
      ...(nested.outcomes || []),
    ]),
  ].join(" ");
}

/**
 * Is this market genuinely about the streamed game? Broad game search can return
 * fuzzy matches for unrelated markets, and stream surfaces bypass the normal
 * feed relevance pipeline.
 */
export function isRelevantToGame(market: Market, ctx: StreamContext): boolean {
  const name = (ctx.game || "").trim().toLowerCase();
  const hay = marketSearchText(market).toLowerCase();
  if (name && hay.includes(name)) return true;
  const words = new Set(normalizeTokens(hay));
  return gameTokens(ctx).some((token) => words.has(token));
}

function splitMatchSides(matchQuery: string): [string, string] | null {
  const sides = matchQuery
    .split(/\bvs?\.?\b/i)
    .map((side) => side.trim())
    .filter(Boolean);
  if (sides.length !== 2) return null;
  return [sides[0], sides[1]];
}

function sideTokens(side: string): string[] {
  return normalizeTokens(side).filter(
    (token) => !SIDE_STOP_WORDS.has(token) && token.length >= 2
  );
}

function sideMatches(side: string, marketWords: Set<string>): boolean {
  const tokens = sideTokens(side);
  if (tokens.length === 0) return false;
  return tokens.every((token) => marketWords.has(token));
}

function scoreMarketForMatch(market: Market, matchQuery: string): number {
  const sides = splitMatchSides(matchQuery);
  if (!sides) return 0;

  const marketWords = new Set(normalizeTokens(marketSearchText(market)));
  const left = sideMatches(sides[0], marketWords);
  const right = sideMatches(sides[1], marketWords);
  if (left && right) return 100;
  if (left || right) return 10;
  return 0;
}

function marketVolume(market: Market): number {
  return (
    (typeof market.volume24hr === "number" ? market.volume24hr : 0) ||
    (typeof market.volume === "number" ? market.volume : 0)
  );
}

function marketKey(market: Market): string {
  return market.id || market.slug || market.title;
}

function pushUnique(target: Market[], seen: Set<string>, market: Market): void {
  const key = marketKey(market);
  if (!key || seen.has(key)) return;
  seen.add(key);
  target.push(market);
}

export function rankStreamMarkets({
  ctx,
  matchFound,
  gameFound,
  maxMarkets = DEFAULT_MAX_STREAM_MARKETS,
}: StreamMarketRankingInput): Market[] {
  const keep = (list: Market[]): Market[] =>
    ctx.game ? list.filter((market) => isRelevantToGame(market, ctx)) : list;
  const matchQuery = buildMatchQuery(ctx.title || "");
  const candidates = [...keep(matchFound), ...keep(gameFound)];
  const rankedByMatch: RankedMarket[] = candidates
    .map((market) => ({
      market,
      score: scoreMarketForMatch(market, matchQuery),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || marketVolume(b.market) - marketVolume(a.market)
    );

  const ordered: Market[] = [];
  const seen = new Set<string>();

  for (const candidate of rankedByMatch) {
    if (candidate.score < 100) continue;
    pushUnique(ordered, seen, candidate.market);
  }

  for (const market of [...keep(gameFound), ...keep(matchFound)].sort(
    (a, b) => marketVolume(b) - marketVolume(a)
  )) {
    pushUnique(ordered, seen, market);
  }

  return ordered.slice(0, maxMarkets);
}
