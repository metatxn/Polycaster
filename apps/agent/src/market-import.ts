import type { AgentWatchlistItem } from "./types.ts";

const GAMMA_EVENT_BASE = "https://gamma-api.polymarket.com/events/slug";
const EVENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,180}$/;

export type ImportedWatchlistItem = Omit<
  AgentWatchlistItem,
  "id" | "createdAt" | "updatedAt"
>;

interface GammaMarketLike {
  question?: unknown;
  conditionId?: unknown;
  slug?: unknown;
  outcomes?: unknown;
  clobTokenIds?: unknown;
  resolutionSource?: unknown;
  eventStartTime?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  archived?: unknown;
}

interface GammaEventLike {
  slug?: unknown;
  title?: unknown;
  resolutionSource?: unknown;
  startTime?: unknown;
  endDate?: unknown;
  archived?: unknown;
  markets?: unknown;
}

interface ImportOptions {
  outcomeLabel?: string;
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (url: string) => Promise<FetchLikeResponse>;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function eventMarkets(event: GammaEventLike): GammaMarketLike[] {
  return Array.isArray(event.markets)
    ? event.markets.filter(
        (market): market is GammaMarketLike =>
          Boolean(market) && typeof market === "object"
      )
    : [];
}

export function parsePolymarketEventSlug(input: string): string {
  const trimmed = input.trim();
  let slug = trimmed;
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const eventIndex = parts.indexOf("event");
    slug =
      eventIndex >= 0 && parts[eventIndex + 1]
        ? parts[eventIndex + 1]
        : (parts.at(-1) ?? "");
  } catch {
    slug = trimmed;
  }
  slug = decodeURIComponent(slug).trim().toLowerCase();
  if (!EVENT_SLUG_PATTERN.test(slug)) {
    throw new Error("Invalid Polymarket event slug.");
  }
  return slug;
}

export function normalizeGammaEventToWatchlistItem(
  rawEvent: unknown,
  options: ImportOptions = {}
): ImportedWatchlistItem {
  if (!rawEvent || typeof rawEvent !== "object") {
    throw new Error("Invalid Gamma event payload.");
  }
  const event = rawEvent as GammaEventLike;
  const market = eventMarkets(event)[0];
  if (!market) {
    throw new Error("Gamma event has no markets.");
  }

  const outcomes = parseStringArray(market.outcomes);
  const tokenIds = parseStringArray(market.clobTokenIds);
  if (outcomes.length === 0 || tokenIds.length === 0) {
    throw new Error("Gamma event market is missing outcomes or token ids.");
  }

  const requestedOutcome = options.outcomeLabel?.trim().toLowerCase();
  const outcomeIndex =
    requestedOutcome && outcomes.length > 0
      ? outcomes.findIndex(
          (outcome) => outcome.trim().toLowerCase() === requestedOutcome
        )
      : 0;
  const selectedIndex = outcomeIndex >= 0 ? outcomeIndex : 0;
  const tokenId = tokenIds[selectedIndex];
  if (!tokenId) {
    throw new Error("Gamma event market is missing the selected token id.");
  }

  const marketSlug = stringValue(event.slug) ?? stringValue(market.slug);
  if (!marketSlug) {
    throw new Error("Gamma event is missing a market slug.");
  }

  return {
    question:
      stringValue(market.question) ??
      stringValue(event.title) ??
      `Polymarket event ${marketSlug}`,
    tokenId,
    conditionId: stringValue(market.conditionId),
    marketSlug,
    side: "YES",
    outcomeLabel: outcomes[selectedIndex],
    eventStartTime:
      stringValue(market.eventStartTime) ??
      stringValue(event.startTime) ??
      stringValue(market.startDate),
    eventEndTime: stringValue(market.endDate) ?? stringValue(event.endDate),
    resolutionSource:
      stringValue(market.resolutionSource) ??
      stringValue(event.resolutionSource),
    newsUrls: [],
    socialNotes: [],
    active: event.archived !== true && market.archived !== true,
  };
}

export async function resolvePolymarketEventWatchlistItem(
  input: string,
  options: ImportOptions = {},
  fetcher: FetchLike = fetch as FetchLike
): Promise<ImportedWatchlistItem> {
  const slug = parsePolymarketEventSlug(input);
  const response = await fetcher(
    `${GAMMA_EVENT_BASE}/${encodeURIComponent(slug)}`
  );
  if (!response.ok) {
    throw new Error(
      `Gamma event lookup failed with status ${response.status}.`
    );
  }
  return normalizeGammaEventToWatchlistItem(await response.json(), options);
}
