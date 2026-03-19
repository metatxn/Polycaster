import { useQuery } from "@tanstack/react-query";

interface Event {
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
  tags?: string[];
  marketCount?: number;
  volume?: string;
  liquidity?: string;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
}

interface EventsResponse {
  success: boolean;
  count: number;
  events: Event[];
  error?: string;
}

interface UseEventsListParams {
  tag?: string;
  limit?: number;
  offset?: number;
  closed?: boolean;
  archived?: boolean;
}

/**
 * Fetch events list with optional filtering
 */
async function fetchEventsList(
  params: UseEventsListParams = {}
): Promise<Event[]> {
  const queryParams = new URLSearchParams();

  if (params.tag) queryParams.set("tag", params.tag);
  if (params.limit) queryParams.set("limit", params.limit.toString());
  if (params.offset) queryParams.set("offset", params.offset.toString());
  if (params.closed !== undefined)
    queryParams.set("closed", params.closed.toString());
  if (params.archived !== undefined)
    queryParams.set("archived", params.archived.toString());

  const response = await fetch(`/api/events/list?${queryParams.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to fetch events");
  }

  const data: EventsResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to fetch events");
  }

  return data.events || [];
}

/**
 * Hook to fetch events list
 *
 * @param params - Filtering parameters
 * @returns TanStack Query result with events data
 */
export function useEventsList(params: UseEventsListParams = {}) {
  return useQuery({
    queryKey: ["events", "list", params],
    queryFn: () => fetchEventsList(params),
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
  });
}
