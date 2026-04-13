import { resolveNegRisk } from "@knoww/shared-types/polymarket";
import { POLYMARKET_API } from "@/constants/polymarket";
import type { GammaEvent, GammaMarket, GammaTag } from "@/types/gamma-api";

type KeysetItemKey = "data" | "events" | "markets";

interface GammaKeysetPayload<T> {
  data?: T[];
  events?: T[];
  markets?: T[];
  next_cursor?: string;
}

interface FetchGammaKeysetPageParams {
  endpoint: string;
  params: URLSearchParams;
  revalidate: number;
}

export interface GammaKeysetPage<T> {
  items: T[];
  nextCursor?: string;
}

export function toSlimGammaEvent(event: GammaEvent, fullMarkets = false) {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    image: event.image,
    volume: event.volume,
    volume24hr: event.volume24hr,
    volume1wk: event.volume1wk,
    volume1mo: event.volume1mo,
    volume1yr: event.volume1yr,
    liquidity: event.liquidity,
    liquidityClob: event.liquidityClob,
    active: event.active,
    closed: event.closed,
    live: event.live,
    ended: event.ended,
    competitive: event.competitive,
    negRisk: resolveNegRisk(event),
    score: event.score,
    startDate: event.startDate,
    endDate: event.endDate,
    markets: event.markets?.map((market: GammaMarket) =>
      fullMarkets
        ? {
            id: market.id,
            question: market.question,
            outcomes: market.outcomes,
            outcomePrices: market.outcomePrices,
            groupItemTitle: market.groupItemTitle,
            image: market.image,
            icon: market.icon,
            clobTokenIds: (() => {
              try {
                return JSON.parse(market.clobTokenIds || "[]");
              } catch {
                return [];
              }
            })(),
            conditionId: market.conditionId,
            gameStartTime: market.gameStartTime,
          }
        : { id: market.id }
    ),
    tags: event.tags?.map((tag: GammaTag | string) =>
      typeof tag === "string"
        ? tag
        : { id: tag.id, slug: tag.slug, label: tag.label }
    ),
  };
}

function extractItems<T>(
  payload: GammaKeysetPayload<T>,
  preferredKeys: KeysetItemKey[]
): T[] {
  for (const key of preferredKeys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

export async function fetchGammaKeysetPage<T>(
  { endpoint, params, revalidate }: FetchGammaKeysetPageParams,
  preferredKeys: KeysetItemKey[]
): Promise<GammaKeysetPage<T>> {
  const response = await fetch(`${endpoint}?${params.toString()}`, {
    headers: {
      "Content-Type": "application/json",
    },
    next: { revalidate },
  });

  if (!response.ok) {
    throw new Error(`Gamma API error: ${response.statusText}`);
  }

  const payload = (await response.json()) as GammaKeysetPayload<T>;

  return {
    items: extractItems(payload, preferredKeys),
    nextCursor: payload.next_cursor,
  };
}

interface GammaTagResponse {
  id?: number | string;
}

export async function resolveGammaTagId(
  slug: string,
  revalidate = 3600
): Promise<string | null> {
  const response = await fetch(
    `${POLYMARKET_API.GAMMA.BASE}/tags/slug/${encodeURIComponent(slug)}`,
    {
      headers: {
        "Content-Type": "application/json",
      },
      next: { revalidate },
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as GammaTagResponse;
  if (data.id === undefined || data.id === null) {
    return null;
  }

  return String(data.id);
}
