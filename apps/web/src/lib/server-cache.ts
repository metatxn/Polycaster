import { cache } from "react";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import type { Event } from "@/hooks/use-event-detail";
import type { LeaderboardTrader } from "@/hooks/use-leaderboard";
import { fetchGammaKeysetPage, toSlimGammaEvent } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";
import {
  formatTagLabel,
  getKnownTagDefinition,
  normalizeTagRecord,
  normalizeTagSlug,
} from "@/lib/tag-slugs";
import type { GammaEvent } from "@/types/gamma-api";

/**
 * Server-side Cache Utilities using React.cache()
 *
 * React.cache() provides per-request memoization on the server.
 * This is critical for Cloudflare Workers to avoid duplicate fetches
 * within a single request (e.g., same data needed for metadata + page).
 *
 * Benefits:
 * 1. Deduplicates identical requests within the same render
 * 2. Works with React Server Components streaming
 * 3. Zero configuration, automatic cleanup per request
 */

// Types for initial home data
export interface InitialMarket {
  id: string;
  question?: string;
  outcomes?: string;
  outcomePrices?: string;
  groupItemTitle?: string;
  image?: string;
  icon?: string;
  clobTokenIds?: string[];
  conditionId?: string;
  gameStartTime?: string;
  sportsMarketType?: string;
  umaResolutionStatus?: string;
  umaResolutionStatuses?: string;
  parentEventId?: number | string;
  parentEventTitle?: string;
}

export interface InitialEvent {
  id: string;
  slug: string;
  title: string;
  description?: string;
  image?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  volume?: string;
  volume24hr?: number | string;
  volume1wk?: number | string;
  volume1mo?: number | string;
  volume1yr?: number | string;
  liquidity?: number | string;
  liquidityClob?: number | string;
  competitive?: number;
  live?: boolean;
  ended?: boolean;
  markets?: InitialMarket[];
  tags?: Array<string | { id?: string; slug?: string; label?: string }>;
  negRisk?: boolean;
}

export interface InitialHomeData {
  events: InitialEvent[];
  totalResults: number;
  hasMore: boolean;
}

export interface InitialLeaderboardData {
  traders: LeaderboardTrader[];
  category: string;
  timePeriod: string;
  orderBy: string;
  total: number;
}

export interface InitialTagData {
  slug: string;
  label: string;
  description?: string;
}

// Full event type for server-side fetching
export interface GammaEventFull extends Event {
  title: string;
  description?: string;
  image?: string;
}

const INITIAL_HOME_EVENT_LIMIT = 6;
const RELATED_EVENT_LIMIT = 6;

async function fetchInitialEventPage(
  tagSlug?: string,
  seriesId?: number,
  limit = 20
): Promise<InitialHomeData> {
  const params = new URLSearchParams({
    limit: String(limit),
    closed: "false",
    order: "volume24hr",
    ascending: "false",
  });

  if (seriesId) {
    params.set("series_id", String(seriesId));
    params.set("active", "true");
  } else if (tagSlug) {
    params.set("tag_slug", normalizeTagSlug(tagSlug));
  }

  const page = await fetchGammaKeysetPage<GammaEvent>(
    {
      endpoint: POLYMARKET_API.GAMMA.EVENTS_KEYSET,
      params,
      revalidate: CACHE_DURATION.EVENTS,
    },
    ["events", "data"]
  );

  const initialEvents = page.items.map((event) =>
    toSlimGammaEvent(event, true)
  );

  return {
    events: initialEvents,
    totalResults: page.totalResults ?? initialEvents.length,
    hasMore: Boolean(page.nextCursor),
  };
}

/**
 * Cached fetch for initial events data
 * Uses React.cache() for per-request deduplication
 */
export const getInitialEvents = cache(
  async (): Promise<InitialHomeData | null> => {
    try {
      return await fetchInitialEventPage(
        undefined,
        undefined,
        INITIAL_HOME_EVENT_LIMIT
      );
    } catch (error) {
      logger.error("server_cache.events.fetch_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
);

export const getInitialEventsByTag = cache(
  async (
    tagSlug: string,
    seriesId?: number
  ): Promise<InitialHomeData | null> => {
    try {
      return await fetchInitialEventPage(tagSlug, seriesId);
    } catch (error) {
      logger.error("server_cache.events_by_tag.fetch_failed", {
        tagSlug: normalizeTagSlug(tagSlug),
        seriesId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
);

/**
 * Authoritative category inventory for indexable route rendering. Unlike the
 * best-effort helper above, upstream failures are rethrown so Next serves a
 * retryable 5xx instead of a misleading 200/noindex empty page.
 */
export const getInitialEventsByTagStrict = cache(
  async (tagSlug: string, seriesId?: number): Promise<InitialHomeData> => {
    try {
      return await fetchInitialEventPage(tagSlug, seriesId);
    } catch (error) {
      logger.error("server_cache.events_by_tag.strict_fetch_failed", {
        tagSlug: normalizeTagSlug(tagSlug),
        seriesId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
);

/** Small best-effort payload for the event detail page's related links. */
export const getRelatedEventsByTag = cache(
  async (tagSlug: string): Promise<InitialHomeData | null> => {
    try {
      return await fetchInitialEventPage(
        tagSlug,
        undefined,
        RELATED_EVENT_LIMIT
      );
    } catch (error) {
      logger.warn("server_cache.related_events.fetch_failed", {
        tagSlug: normalizeTagSlug(tagSlug),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
);

export const getTagDetails = cache(
  async (tagSlug: string): Promise<InitialTagData | null> => {
    const canonicalSlug = normalizeTagSlug(tagSlug);
    const fallback = getKnownTagDefinition(canonicalSlug);

    try {
      const response = await fetch(
        `${POLYMARKET_API.GAMMA.BASE}/tags/slug/${encodeURIComponent(canonicalSlug)}`,
        {
          headers: {
            Accept: "application/json",
          },
          next: { revalidate: CACHE_DURATION.SPORTS_LIST },
        }
      );

      if (!response.ok) {
        if (fallback) {
          return fallback;
        }

        logger.warn("server_cache.tag.fetch_failed", {
          tagSlug: canonicalSlug,
          status: response.status,
          statusText: response.statusText,
        });
        return null;
      }

      const normalizedTag = normalizeTagRecord(
        (await response.json()) as Record<string, unknown>
      );

      if (normalizedTag) {
        return {
          slug: normalizedTag.slug,
          label: normalizedTag.label,
          description: normalizedTag.description,
        };
      }
    } catch (error) {
      logger.error("server_cache.tag.fetch_failed", {
        tagSlug: canonicalSlug,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (fallback) {
      return fallback;
    }

    return {
      slug: canonicalSlug,
      label: formatTagLabel(canonicalSlug),
    };
  }
);

/**
 * Cached fetch for leaderboard data
 * Uses React.cache() for per-request deduplication
 */
export const getInitialLeaderboard = cache(
  async (): Promise<InitialLeaderboardData | null> => {
    try {
      const params = new URLSearchParams({
        category: "OVERALL",
        timePeriod: "DAY",
        orderBy: "PNL",
        limit: "25",
        offset: "0",
      });

      const response = await fetch(
        `${POLYMARKET_API.DATA.BASE}/v1/leaderboard?${params.toString()}`,
        {
          headers: {
            Accept: "application/json",
          },
          next: {
            revalidate: CACHE_DURATION.EVENTS,
          },
        }
      );

      if (!response.ok) {
        logger.warn("server_cache.leaderboard.fetch_failed", {
          status: response.status,
          statusText: response.statusText,
        });
        return null;
      }

      // Safely parse response - handle both array and wrapper object formats
      const rawData: unknown = await response.json();
      const traders: LeaderboardTrader[] = Array.isArray(rawData)
        ? rawData
        : ((
            rawData as {
              data?: LeaderboardTrader[];
              traders?: LeaderboardTrader[];
            }
          )?.data ??
          (
            rawData as {
              data?: LeaderboardTrader[];
              traders?: LeaderboardTrader[];
            }
          )?.traders ??
          []);

      return {
        traders,
        category: "OVERALL",
        timePeriod: "DAY",
        orderBy: "PNL",
        total: traders.length,
      };
    } catch (error) {
      logger.error("server_cache.leaderboard.fetch_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
);

/**
 * Cached fetch for event detail data
 * Uses React.cache() for per-request deduplication
 *
 * This is critical for event detail pages where the same data
 * is needed for both generateMetadata() and the page component
 */
export const getEvent = cache(
  async (slugOrId: string): Promise<GammaEventFull | null> => {
    try {
      const isNumericId = /^\d+$/.test(slugOrId);
      const url = isNumericId
        ? `${POLYMARKET_API.GAMMA.EVENTS}/${slugOrId}`
        : `${POLYMARKET_API.GAMMA.EVENTS}/slug/${encodeURIComponent(slugOrId)}`;

      const res = await fetch(url, {
        next: { revalidate: CACHE_DURATION.EVENTS },
      });
      // Only a 404 means "this event does not exist" — that maps to
      // notFound()/noindex downstream. Any other failure (5xx, rate limit,
      // network) must throw so the page renders a 5xx instead of a 404;
      // Googlebot drops 404s from the index but retries 5xx.
      if (res.status === 404) {
        logger.warn("server_cache.event.not_found", { slugOrId });
        return null;
      }
      if (!res.ok) {
        logger.warn("server_cache.event.fetch_failed", {
          slugOrId,
          status: res.status,
          statusText: res.statusText,
        });
        throw new Error(
          `Event fetch failed: ${res.status} ${res.statusText} (${slugOrId})`
        );
      }
      const event = (await res.json()) as GammaEventFull;

      // Fan out negRisk child events linked via `parentEventId` so the SSR
      // payload matches what `/api/events/[id]` returns. Without this the
      // first paint is missing rows like "Most Sixes" until the client
      // refetch lands.
      if (event?.id) {
        try {
          const childrenUrl = `${POLYMARKET_API.GAMMA.EVENTS}?parent_event_id=${event.id}&limit=50&closed=false`;
          const childrenRes = await fetch(childrenUrl, {
            next: { revalidate: CACHE_DURATION.EVENTS },
          });
          if (childrenRes.ok) {
            type EventMarket = NonNullable<GammaEventFull["markets"]>[number];
            const childEvents = (await childrenRes.json()) as Array<{
              id?: string | number;
              title?: string;
              markets?: EventMarket[];
            }>;
            if (Array.isArray(childEvents) && childEvents.length > 0) {
              const seen = new Set(
                (event.markets ?? [])
                  .map((m) => m.id)
                  .filter((v): v is string => typeof v === "string")
              );
              const merged: EventMarket[] = [...(event.markets ?? [])];
              for (const child of childEvents) {
                const childEventId = child.id;
                for (const market of child.markets ?? []) {
                  const mid =
                    typeof market.id === "string" ? market.id : undefined;
                  if (mid && seen.has(mid)) continue;
                  if (mid) seen.add(mid);
                  merged.push({
                    ...market,
                    // Use the IMMEDIATE child event id (one per negRisk
                    // group), not the grandparent — the UI groups by this.
                    parentEventId: childEventId,
                    parentEventTitle: child.title,
                  });
                }
              }
              event.markets = merged;
            }
          }
        } catch (childErr) {
          // Best-effort: missing children must not break the parent fetch.
          logger.warn("server_cache.event.children_fetch_failed", {
            slugOrId,
            error:
              childErr instanceof Error ? childErr.message : String(childErr),
          });
        }
      }

      return event;
    } catch (error) {
      logger.error("server_cache.event.fetch_failed", {
        slugOrId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Transient failures (network, parse, non-404 upstream) propagate so the
      // route errors with a 5xx rather than serving a not-found page.
      throw error;
    }
  }
);
