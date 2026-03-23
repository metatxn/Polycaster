import { useQuery } from "@tanstack/react-query";

/** Token data for a market outcome */
interface MarketToken {
  token_id: string;
  outcome: string; // "Yes" or "No"
  price?: string;
  winner?: boolean;
}

interface Market {
  id: string;
  question: string;
  groupItemTitle?: string;
  slug?: string;
  description?: string;
  image?: string;
  outcomes?: string;
  outcomePrices?: string;
  /** CLOB token IDs - JSON string array of token IDs for each outcome */
  clobTokenIds?: string;
  /** Tokens array with token_id for YES and NO outcomes */
  tokens?: MarketToken[];
  /** Condition ID for the market */
  conditionId?: string;
  /**
   * Minimum order size (in shares) for this specific market.
   *
   * NOTE: Gamma market payloads may expose this as `orderMinSize` (camelCase)
   * or `order_min_size` (snake_case) depending on the endpoint/version.
   */
  orderMinSize?: number | string;
  order_min_size?: number | string;
  volume?: string;
  liquidity?: string;
  active?: boolean;
  closed?: boolean;
  createdAt?: string;
  /** Whether this is a negative risk market */
  negRisk?: boolean;
}

export type Event = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  image?: string;
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  tags?: string[];
  markets?: Market[];
  marketCount?: number;
  volume?: string;
  liquidity?: string;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
};

interface EventDetailResponse {
  success: boolean;
  event: Event;
  error?: string;
}

/**
 * Fetch event details by slug or ID including all associated markets
 * The API automatically handles both formats (slug preferred, ID as fallback)
 */
async function fetchEventDetail(
  slugOrId: string | undefined
): Promise<Event | null> {
  if (!slugOrId) return null;

  const response = await fetch(`/api/events/${slugOrId}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Event not found");
    }
    throw new Error("Failed to fetch event details");
  }

  const data: EventDetailResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to fetch event details");
  }

  return data.event;
}

/**
 * Hook to fetch event details by slug or ID
 *
 * @param slugOrId - Event slug (preferred) or numeric ID (fallback)
 * @param initialData - Optional initial data from server-side fetch (React 19 SSR optimization)
 * @returns TanStack Query result with event data including markets
 */
export function useEventDetail(
  slugOrId: string | undefined,
  initialData?: Event | null
) {
  return useQuery({
    queryKey: ["events", "detail", slugOrId],
    queryFn: () => fetchEventDetail(slugOrId),
    enabled: !!slugOrId,
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
    // Use server-fetched data as initial data to eliminate loading state
    initialData: initialData ?? undefined,
    // Tell TanStack Query when the initial data was fetched so staleTime is computed correctly
    // Without this, initialData is treated as fetched at epoch (time 0), causing immediate refetch
    initialDataUpdatedAt: initialData ? Date.now() : undefined,
  });
}
