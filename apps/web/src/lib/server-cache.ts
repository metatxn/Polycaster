import { cache } from "react";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import type { Event } from "@/hooks/use-event-detail";
import type { LeaderboardTrader } from "@/hooks/use-leaderboard";

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
  markets?: Array<{ id: string }>;
  tags?: Array<string | { id?: string; slug?: string; label?: string }>;
  negRisk?: boolean;
}

export interface InitialHomeData {
  events: InitialEvent[];
  totalResults: number;
}

export interface InitialLeaderboardData {
  traders: LeaderboardTrader[];
  category: string;
  timePeriod: string;
  orderBy: string;
  total: number;
}

// Full event type for server-side fetching
export interface GammaEventFull extends Event {
  title: string;
  description?: string;
  image?: string;
}

/**
 * Cached fetch for initial events data
 * Uses React.cache() for per-request deduplication
 */
export const getInitialEvents = cache(
  async (): Promise<InitialHomeData | null> => {
    try {
      const params = new URLSearchParams({
        limit: "20",
        offset: "0",
        active: "true",
        archived: "false",
        closed: "false",
        order: "volume24hr",
        ascending: "false",
      });

      const response = await fetch(
        `${POLYMARKET_API.GAMMA.EVENTS_PAGINATION}?${params.toString()}`,
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
        console.error("Failed to fetch initial events:", response.statusText);
        return null;
      }

      const rawData = (await response.json()) as {
        data?: Array<{
          id: string;
          slug: string;
          title: string;
          description?: string;
          image?: string;
          volume?: string;
          volume24hr?: number | string;
          volume1wk?: number | string;
          volume1mo?: number | string;
          volume1yr?: number | string;
          liquidity?: number | string;
          liquidityClob?: number | string;
          active?: boolean;
          closed?: boolean;
          live?: boolean;
          ended?: boolean;
          competitive?: number;
          enableNegRisk?: boolean;
          negRiskAugmented?: boolean;
          startDate?: string;
          endDate?: string;
          markets?: Array<{ id: string }>;
          tags?: Array<string | { id?: string; slug?: string; label?: string }>;
        }>;
        pagination?: {
          totalResults?: number;
        };
      };

      // Performance: Strip down to only needed fields
      const slimEvents =
        rawData.data?.map((event) => ({
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
          negRisk: event.enableNegRisk || event.negRiskAugmented,
          startDate: event.startDate,
          endDate: event.endDate,
          markets: event.markets?.map((m) => ({ id: m.id })),
          tags: event.tags?.map((t) =>
            typeof t === "string"
              ? t
              : { id: t.id, slug: t.slug, label: t.label }
          ),
        })) || [];

      return {
        events: slimEvents,
        totalResults: rawData.pagination?.totalResults ?? slimEvents.length,
      };
    } catch (error) {
      console.error("Error fetching initial events:", error);
      return null;
    }
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
        console.error("Failed to fetch leaderboard:", response.statusText);
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
      console.error("Error fetching leaderboard:", error);
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
  async (slug: string): Promise<GammaEventFull | null> => {
    try {
      const res = await fetch(
        `${POLYMARKET_API.GAMMA.EVENTS}/slug/${encodeURIComponent(slug)}`,
        {
          next: { revalidate: CACHE_DURATION.EVENTS },
        }
      );
      if (!res.ok) {
        console.error("Failed to fetch event:", res.status, res.statusText);
        return null;
      }
      return (await res.json()) as GammaEventFull;
    } catch (error) {
      console.error("Error fetching event:", error);
      return null;
    }
  }
);
