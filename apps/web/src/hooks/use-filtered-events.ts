import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
  EventFilters,
  VolumeWindow,
} from "@/context/event-filter-context";
import { useEventFilters } from "@/context/event-filter-context";

// Extended event interface with all filterable fields
export interface FilterableEvent {
  id: string;
  slug?: string;
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
  live?: boolean;
  ended?: boolean;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
  markets?: Array<{
    id: string;
    question: string;
    slug?: string;
  }>;
  tags?: Array<string | { id?: string; slug?: string; label?: string }>;
}

interface FilteredEventsResponse {
  success: boolean;
  data?: FilterableEvent[];
  pagination?: {
    hasMore: boolean;
    totalResults: number;
  };
  error?: string;
}

interface UseFilteredEventsParams {
  limit?: number;
  order?: string;
  ascending?: boolean;
}

// Parse numeric value from string or number
function parseNumeric(value: number | string | undefined): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") return value;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Sort events by volume based on the selected window (highest first)
function sortEventsByVolume(
  events: FilterableEvent[],
  volumeWindow: VolumeWindow
): FilterableEvent[] {
  const sorted = [...events];

  return sorted.sort((a, b) => {
    const volA = resolveVolumeByWindow(a, volumeWindow);
    const volB = resolveVolumeByWindow(b, volumeWindow);
    return volB - volA; // Highest volume first
  });
}

// Helper to resolve volume by window
function resolveVolumeByWindow(
  evt: FilterableEvent,
  window: VolumeWindow
): number {
  switch (window) {
    case "1wk":
      return parseNumeric(evt.volume1wk);
    case "1mo":
      return parseNumeric(evt.volume1mo);
    case "1yr":
      return parseNumeric(evt.volume1yr);
    default:
      return parseNumeric(evt.volume24hr);
  }
}

// Check if event matches the current filters
function matchesFilters(
  event: FilterableEvent,
  filters: EventFilters
): boolean {
  // Volume filters are no longer used as threshold filters
  // (we removed volume24hr threshold - now we just sort by volume)

  // Liquidity filter
  if (filters.liquidity !== null) {
    const liquidity = parseNumeric(event.liquidity || event.liquidityClob);
    if (liquidity < filters.liquidity) return false;
  }

  // Status filters
  if (filters.status.length > 0) {
    const statusMatches = filters.status.some((status) => {
      switch (status) {
        case "active":
          return event.active === true && event.closed !== true;
        case "live":
          return event.live === true;
        case "ended":
          return event.ended === true;
        case "closed":
          return event.closed === true;
        default:
          return true;
      }
    });
    if (!statusMatches) return false;
  }

  // Tags filter
  if (filters.tagSlugs.length > 0) {
    const eventTags = event.tags || [];
    const eventTagSlugs = eventTags.map((tag) =>
      typeof tag === "string" ? tag : tag.slug || ""
    );
    const hasMatchingTag = filters.tagSlugs.some((slug) =>
      eventTagSlugs.includes(slug)
    );
    if (!hasMatchingTag) return false;
  }

  // Competitiveness filter
  if (filters.competitiveness.min > 0 || filters.competitiveness.max < 100) {
    const competitive = (event.competitive || 0) * 100; // Convert 0-1 to 0-100
    if (
      competitive < filters.competitiveness.min ||
      competitive > filters.competitiveness.max
    ) {
      return false;
    }
  }

  // Date range filter
  if (filters.dateRange.start || filters.dateRange.end) {
    const eventStartDate = event.startDate ? new Date(event.startDate) : null;
    const eventEndDate = event.endDate ? new Date(event.endDate) : null;

    // Check if event falls within date range
    if (filters.dateRange.start && eventEndDate) {
      if (eventEndDate < filters.dateRange.start) return false;
    }
    if (filters.dateRange.end && eventStartDate) {
      if (eventStartDate > filters.dateRange.end) return false;
    }
  }

  return true;
}

/**
 * Hook to fetch and filter events with both server-side and client-side filtering
 */
export function useFilteredEvents({
  limit = 50, // Fetch more to allow for client-side filtering
}: UseFilteredEventsParams = {}) {
  const { filters } = useEventFilters();

  // Map volume window to API order field
  const volumeOrderField = useMemo(() => {
    switch (filters.volumeWindow) {
      case "1wk":
        return "volume1wk";
      case "1mo":
        return "volume1mo";
      case "1yr":
        return "volume1yr";
      default:
        return "volume24hr";
    }
  }, [filters.volumeWindow]);

  // Build server-side filter params
  const serverParams = useMemo(() => {
    const params: Record<string, string> = {
      limit: limit.toString(),
      order: volumeOrderField,
      ascending: "false", // Always sort by volume descending (highest first)
    };

    // Server supports active/closed filtering
    // We'll fetch a broader set and filter client-side for more complex status logic
    const hasActiveOnly =
      filters.status.length === 1 && filters.status.includes("active");
    const hasClosedOnly =
      filters.status.length === 1 && filters.status.includes("closed");

    if (hasActiveOnly) {
      params.active = "true";
      params.closed = "false";
    } else if (hasClosedOnly) {
      params.active = "false";
      params.closed = "true";
    } else {
      // Fetch all and filter client-side
      params.active = "true";
      params.closed = "false";
    }

    // Tag filter - server supports single tag
    if (filters.tagSlugs.length === 1) {
      params.tag_slug = filters.tagSlugs[0];
    }

    return params;
  }, [filters.status, filters.tagSlugs, limit, volumeOrderField]);

  // Fetch events from API
  const query = useInfiniteQuery({
    queryKey: ["filtered-events", serverParams, filters.volumeWindow],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams({
        ...serverParams,
        offset: pageParam.toString(),
      });

      const response = await fetch(
        `/api/events/paginated?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch events");
      }

      const result = (await response.json()) as FilteredEventsResponse;

      if (!result.success) {
        throw new Error(result.error || "Failed to fetch events");
      }

      return {
        events: result.data || [],
        nextOffset: result.pagination?.hasMore
          ? pageParam + Number.parseInt(serverParams.limit, 10)
          : undefined,
        totalResults: result.pagination?.totalResults || 0,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Apply client-side filtering and sorting by volume
  const filteredEvents = useMemo(() => {
    if (!query.data?.pages) return [];

    const allEvents = query.data.pages.flatMap((page) => page.events);
    const filtered = allEvents.filter((event) =>
      matchesFilters(event, filters)
    );
    // Sort by the selected volume window (highest first)
    return sortEventsByVolume(filtered, filters.volumeWindow);
  }, [query.data?.pages, filters]);

  // Calculate if there are more events (considering client-side filtering)
  const hasNextPage = query.hasNextPage;
  const totalResults = query.data?.pages[0]?.totalResults || 0;

  return {
    events: filteredEvents,
    isLoading: query.isLoading,
    error: query.error,
    hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    totalResults,
    // Expose raw count vs filtered count
    rawCount: query.data?.pages.flatMap((p) => p.events).length || 0,
    filteredCount: filteredEvents.length,
  };
}

/**
 * Hook that combines useFilteredEvents with existing view modes
 * This wraps the existing hooks and applies filters on top
 */
export function useFilteredEventsWithViewMode(
  viewMode: "categories" | "trending" | "breaking" | "new",
  baseLimit = 20
) {
  const { filters } = useEventFilters();

  // Determine endpoint based on view mode
  const endpoint = useMemo(() => {
    switch (viewMode) {
      case "trending":
        return "/api/events/trending";
      case "breaking":
        return "/api/events/breaking";
      case "new":
        return "/api/events/new";
      default:
        return "/api/events/paginated";
    }
  }, [viewMode]);

  // Fetch events from the appropriate endpoint
  const query = useInfiniteQuery({
    queryKey: ["filtered-events", viewMode, baseLimit, filters.volumeWindow],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams({
        limit: baseLimit.toString(),
        offset: pageParam.toString(),
      });

      const response = await fetch(`${endpoint}?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch ${viewMode} events`);
      }

      const result = (await response.json()) as FilteredEventsResponse;

      if (!result.success) {
        throw new Error(result.error || `Failed to fetch ${viewMode} events`);
      }

      return {
        events: result.data || [],
        nextOffset: result.pagination?.hasMore
          ? pageParam + baseLimit
          : undefined,
        totalResults: result.pagination?.totalResults || 0,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Apply client-side filtering and sorting by volume
  const filteredEvents = useMemo(() => {
    if (!query.data?.pages) return [];

    const allEvents = query.data.pages.flatMap((page) => page.events);
    const filtered = allEvents.filter((event) =>
      matchesFilters(event, filters)
    );
    // Sort by the selected volume window (highest first)
    return sortEventsByVolume(filtered, filters.volumeWindow);
  }, [query.data?.pages, filters]);

  return {
    events: filteredEvents,
    isLoading: query.isLoading,
    error: query.error,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    totalResults: query.data?.pages[0]?.totalResults || 0,
    rawCount: query.data?.pages.flatMap((p) => p.events).length || 0,
    filteredCount: filteredEvents.length,
  };
}
