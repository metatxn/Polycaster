import { useInfiniteQuery } from "@tanstack/react-query";

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
  archived?: boolean;
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
    totalResults: number;
  };
  error?: string;
}

// Server-side filter parameters
export interface EventFilterParams {
  volume24hrMin?: number | null;
  volumeWeeklyMin?: number | null;
  liquidityMin?: number | null;
  competitiveMin?: number | null;
  competitiveMax?: number | null;
  live?: boolean;
  ended?: boolean;
  // Date filters (ISO string format)
  startDateFrom?: string | null;
  startDateTo?: string | null;
  endDateFrom?: string | null;
  endDateTo?: string | null;
}

interface UsePaginatedEventsParams {
  tagSlug?: string;
  limit?: number;
  active?: boolean;
  archived?: boolean;
  closed?: boolean;
  order?: string;
  ascending?: boolean;
  // Server-side filters
  filters?: EventFilterParams;
  // Enable/disable the query
  enabled?: boolean;
  // Auto-refetch interval in ms (0 = disabled)
  refetchInterval?: number;
  // Request full market data (outcomes, prices, tokenIds) — only use on pages that need it
  fullMarkets?: boolean;
}

export function usePaginatedEvents({
  tagSlug,
  limit = 20,
  active = true,
  archived = false,
  closed = false,
  order = "volume24hr",
  ascending = false,
  filters,
  enabled = true,
  refetchInterval = 0,
  fullMarkets = false,
}: UsePaginatedEventsParams = {}) {
  return useInfiniteQuery({
    queryKey: [
      "events",
      "paginated",
      tagSlug || "all",
      limit,
      active,
      archived,
      closed,
      order,
      ascending,
      fullMarkets,
      // Include filters in query key for proper cache invalidation
      filters?.volume24hrMin ?? null,
      filters?.volumeWeeklyMin ?? null,
      filters?.liquidityMin ?? null,
      filters?.competitiveMin ?? null,
      filters?.competitiveMax ?? null,
      filters?.live ?? null,
      filters?.ended ?? null,
      filters?.startDateFrom ?? null,
      filters?.startDateTo ?? null,
      filters?.endDateFrom ?? null,
      filters?.endDateTo ?? null,
    ],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: pageParam.toString(),
        active: active.toString(),
        archived: archived.toString(),
        closed: closed.toString(),
        order,
        ascending: ascending.toString(),
      });

      // Add tag filter
      if (tagSlug) {
        params.set("tag_slug", tagSlug);
      }

      if (fullMarkets) {
        params.set("markets", "full");
      }

      // Add server-side filters
      if (filters?.volume24hrMin) {
        params.set("volume24hr_min", filters.volume24hrMin.toString());
      }
      if (filters?.volumeWeeklyMin) {
        params.set("volume1wk_min", filters.volumeWeeklyMin.toString());
      }
      if (filters?.liquidityMin) {
        params.set("liquidity_min", filters.liquidityMin.toString());
      }
      if (
        filters?.competitiveMin !== undefined &&
        filters?.competitiveMin !== null
      ) {
        params.set("competitive_min", filters.competitiveMin.toString());
      }
      if (
        filters?.competitiveMax !== undefined &&
        filters?.competitiveMax !== null
      ) {
        params.set("competitive_max", filters.competitiveMax.toString());
      }
      if (filters?.live) {
        params.set("live", "true");
      }
      if (filters?.ended) {
        params.set("ended", "true");
      }

      // Date filters
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

      const response = await fetch(
        `/api/events/paginated?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch paginated events");
      }

      const result = (await response.json()) as PaginatedEventsResponse;

      if (!result.success) {
        throw new Error(result.error || "Failed to fetch paginated events");
      }

      return {
        events: result.data || [],
        nextOffset: result.pagination?.hasMore ? pageParam + limit : undefined,
        totalResults: result.pagination?.totalResults || 0,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    staleTime: refetchInterval > 0 ? refetchInterval : undefined,
    refetchInterval: refetchInterval > 0 ? refetchInterval : false,
    refetchOnWindowFocus: false,
    enabled,
  });
}
