import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/fetch-json";
import { qk } from "@/lib/query-keys";

interface PaginatedEvent {
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
  score?: string;
  live?: boolean;
  ended?: boolean;
  markets?: Array<{
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
  }>;
  tags?: Array<string | { id?: string; slug?: string; label?: string }>;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
}

interface PaginatedEventsResponse {
  success: boolean;
  data?: PaginatedEvent[];
  pagination?: {
    hasMore: boolean;
    nextCursor?: string;
    totalResults?: number;
  };
  error?: string;
}

export interface EventFilterParams {
  volume24hrMin?: number | null;
  volumeWeeklyMin?: number | null;
  liquidityMin?: number | null;
  live?: boolean;
  startDateFrom?: string | null;
  startDateTo?: string | null;
  endDateFrom?: string | null;
  endDateTo?: string | null;
}

interface UsePaginatedEventsParams {
  tagSlug?: string;
  /** Polymarket series ID — when set, takes precedence over tagSlug. */
  seriesId?: number;
  limit?: number;
  closed?: boolean;
  order?: string;
  ascending?: boolean;
  filters?: EventFilterParams;
  enabled?: boolean;
  refetchInterval?: number;
  fullMarkets?: boolean;
}

export function usePaginatedEvents({
  tagSlug,
  seriesId,
  limit = 20,
  closed = false,
  order = "volume24hr",
  ascending = false,
  filters,
  enabled = true,
  refetchInterval = 0,
  fullMarkets = false,
}: UsePaginatedEventsParams = {}) {
  return useInfiniteQuery({
    queryKey: qk.events.paginated({
      scope: seriesId ? `series:${seriesId}` : tagSlug || "all",
      limit,
      closed,
      order,
      ascending,
      fullMarkets,
      volume24hrMin: filters?.volume24hrMin ?? null,
      volumeWeeklyMin: filters?.volumeWeeklyMin ?? null,
      liquidityMin: filters?.liquidityMin ?? null,
      live: filters?.live ?? null,
      startDateFrom: filters?.startDateFrom ?? null,
      startDateTo: filters?.startDateTo ?? null,
      endDateFrom: filters?.endDateFrom ?? null,
      endDateTo: filters?.endDateTo ?? null,
    }),
    queryFn: async ({ pageParam = "" }) => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        closed: closed.toString(),
        order,
        ascending: ascending.toString(),
      });

      if (pageParam) {
        params.set("after_cursor", pageParam);
      }

      if (seriesId) {
        params.set("series_id", String(seriesId));
      } else if (tagSlug) {
        params.set("tag_slug", tagSlug);
      }

      if (fullMarkets) {
        params.set("markets", "full");
      }

      if (filters?.volume24hrMin) {
        params.set("volume24hr_min", filters.volume24hrMin.toString());
      }
      if (filters?.volumeWeeklyMin) {
        params.set("volume1wk_min", filters.volumeWeeklyMin.toString());
      }
      if (filters?.liquidityMin) {
        params.set("liquidity_min", filters.liquidityMin.toString());
      }
      if (filters?.live) {
        params.set("live", "true");
      }

      if (filters?.startDateFrom) {
        params.set("start_date_min", filters.startDateFrom);
      }
      if (filters?.startDateTo) {
        params.set("start_date_max", filters.startDateTo);
      }
      if (filters?.endDateFrom) {
        params.set("end_date_min", filters.endDateFrom);
      }
      if (filters?.endDateTo) {
        params.set("end_date_max", filters.endDateTo);
      }

      const result = await fetchJson<PaginatedEventsResponse>(
        `/api/events/paginated?${params.toString()}`
      );

      return {
        events: result.data || [],
        nextCursor: result.pagination?.nextCursor,
        totalResults: result.pagination?.totalResults,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: "",
    // Deduplicate across page boundaries as a defence-in-depth guard against
    // Gamma's inclusive-cursor behaviour (which is compensated server-side in
    // /api/events/paginated but may still surface in edge cases such as live-
    // data rank shifts between the two fetches).
    select: (data) => {
      const seen = new Set<string>();
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          events: page.events.filter((e) => {
            if (seen.has(e.id)) return false;
            seen.add(e.id);
            return true;
          }),
        })),
      };
    },
    staleTime: refetchInterval > 0 ? refetchInterval : undefined,
    refetchInterval: refetchInterval > 0 ? refetchInterval : false,
    refetchOnWindowFocus: false,
    enabled,
  });
}
