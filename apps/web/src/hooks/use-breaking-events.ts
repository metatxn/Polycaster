import { useInfiniteQuery } from "@tanstack/react-query";
import type { EventFilterParams } from "./use-paginated-events";

interface BreakingEvent {
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
    question: string;
    slug?: string;
  }>;
  tags?: Array<string | { id?: string; slug?: string; label?: string }>;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
}

interface BreakingEventsResponse {
  success: boolean;
  data?: BreakingEvent[];
  pagination?: {
    hasMore: boolean;
    totalResults: number;
  };
  error?: string;
}

export function useBreakingEvents(
  limit = 15,
  filters?: EventFilterParams,
  enabled = true
) {
  return useInfiniteQuery({
    queryKey: ["breaking-events", limit, filters],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: pageParam.toString(),
      });

      if (filters) {
        if (filters.volume24hrMin)
          params.set("volume24hr_min", filters.volume24hrMin.toString());
        if (filters.volumeWeeklyMin)
          params.set("volume1wk_min", filters.volumeWeeklyMin.toString());
        if (filters.liquidityMin)
          params.set("liquidity_min", filters.liquidityMin.toString());
        if (
          filters.competitiveMin !== undefined &&
          filters.competitiveMin !== null
        )
          params.set("competitive_min", filters.competitiveMin.toString());
        if (
          filters.competitiveMax !== undefined &&
          filters.competitiveMax !== null
        )
          params.set("competitive_max", filters.competitiveMax.toString());
        if (filters.live) params.set("live", "true");
        if (filters.ended) params.set("ended", "true");
        if (filters.startDateFrom)
          params.set("start_date_min", filters.startDateFrom);
        if (filters.startDateTo)
          params.set("start_date_max", filters.startDateTo);
        if (filters.endDateFrom)
          params.set("end_date_min", filters.endDateFrom);
        if (filters.endDateTo) params.set("end_date_max", filters.endDateTo);
      }

      const response = await fetch(`/api/events/breaking?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to fetch breaking events");
      }

      const result = (await response.json()) as BreakingEventsResponse;

      if (!result.success) {
        throw new Error(result.error || "Failed to fetch breaking events");
      }

      const hasMore =
        result.pagination?.hasMore ??
        (result.data ? result.data.length === limit : false);

      return {
        events: result.data || [],
        nextOffset: hasMore ? pageParam + limit : undefined,
        totalResults: result.pagination?.totalResults || 0,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
    enabled,
  });
}
