import { useInfiniteQuery } from "@tanstack/react-query";
import type { EventFilterParams } from "./use-paginated-events";

interface TrendingEvent {
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
  markets?: Array<{
    id: string;
    question?: string;
    slug?: string;
    outcomes?: string;
    outcomePrices?: string;
    groupItemTitle?: string;
  }>;
  tags?: Array<string | { id?: string; slug?: string; label?: string }>;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
}

interface TrendingEventsResponse {
  success: boolean;
  data?: TrendingEvent[];
  pagination?: {
    hasMore: boolean;
    nextCursor?: string;
    totalResults: number;
  };
  error?: string;
}

export function useTrendingEvents(
  limit = 15,
  filters?: EventFilterParams,
  enabled = true,
  fullMarkets = false
) {
  return useInfiniteQuery({
    queryKey: ["trending-events", limit, fullMarkets, filters],
    queryFn: async ({ pageParam = "" }) => {
      const params = new URLSearchParams({
        limit: limit.toString(),
      });

      if (pageParam) {
        params.set("after_cursor", pageParam);
      }

      if (fullMarkets) {
        params.set("markets", "full");
      }

      if (filters) {
        if (filters.volume24hrMin)
          params.set("volume24hr_min", filters.volume24hrMin.toString());
        if (filters.volumeWeeklyMin)
          params.set("volume1wk_min", filters.volumeWeeklyMin.toString());
        if (filters.liquidityMin)
          params.set("liquidity_min", filters.liquidityMin.toString());
        if (filters.live) params.set("live", "true");
        if (filters.startDateFrom)
          params.set("start_date_min", filters.startDateFrom);
        if (filters.startDateTo)
          params.set("start_date_max", filters.startDateTo);
        if (filters.endDateFrom)
          params.set("end_date_min", filters.endDateFrom);
        if (filters.endDateTo) params.set("end_date_max", filters.endDateTo);
      }

      const response = await fetch(`/api/events/trending?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to fetch trending events");
      }

      const result = (await response.json()) as TrendingEventsResponse;

      if (!result.success) {
        throw new Error(result.error || "Failed to fetch trending events");
      }

      const pagination = result.pagination ?? {
        hasMore: false,
        totalResults: 0,
      };

      return {
        events: result.data || [],
        nextCursor: pagination.nextCursor,
        totalResults: pagination.totalResults ?? 0,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: "",
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
    enabled,
  });
}
