import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/fetch-json";
import { qk } from "@/lib/query-keys";

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
  /** Shared bucket key for negRisk groups (one per outcome) */
  negRiskMarketID?: string;
  /** 24h price change as a fraction (Gamma `oneDayPriceChange`, e.g. 0.05 = +5%). */
  oneDayPriceChange?: number;
  /** Kickoff time for sports markets, ISO string */
  gameStartTime?: string;
  /** Polymarket sports type tag, e.g. "moneyline", "cricket_toss_winner" */
  sportsMarketType?: string;
  /** ID of the parent event when this market belongs to a linked child event. */
  parentEventId?: string | number;
  /** Title of the linked child event (filled when fanned-out from parent). */
  parentEventTitle?: string;
  /** Resolution deadline (ISO) for the per-market About panel. */
  endDate?: string;
  /** Public canonical URL of the resolution source (e.g. ESPN cricinfo). */
  resolutionSource?: string;
  /** Resolver wallet address — rendered as a Polygonscan link. */
  resolvedBy?: string;
}

/** Sports team data from Polymarket gamma `event.teams` */
export interface EventTeam {
  id?: number | string;
  name: string;
  abbreviation?: string;
  alias?: string;
  logo?: string;
  color?: string;
  league?: string;
  record?: string;
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
  live?: boolean;
  score?: string;
  elapsed?: string | number;
  period?: string;
  tags?: string[];
  markets?: Market[];
  marketCount?: number;
  volume?: string;
  liquidity?: string;
  updatedAt?: string;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
  /** Sports event teams (length 2 for team-vs-team games) */
  teams?: EventTeam[];
  /** Kickoff time for the event (sports), ISO string */
  startTime?: string;
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

  const data = await fetchJson<EventDetailResponse>(
    `/api/events/${encodeURIComponent(slugOrId)}?fresh=1`,
    { cache: "no-store" }
  );
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
    queryKey: qk.events.detail(slugOrId ?? ""),
    queryFn: () => fetchEventDetail(slugOrId),
    enabled: !!slugOrId,
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
    // Use server-fetched data as initial data to eliminate loading state
    initialData: initialData ?? undefined,
    // Server initial data is useful for instant paint, but event market fields
    // like oneDayPriceChange move quickly. Mark it stale so the client refreshes
    // volatile 24H/pricing fields immediately after hydration.
    initialDataUpdatedAt: initialData ? 0 : undefined,
  });
}
