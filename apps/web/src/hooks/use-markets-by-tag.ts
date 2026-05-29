import { useQuery } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";

export interface Market {
  id: string;
  question: string;
  slug?: string;
  description?: string;
  image?: string;
  outcomes?: string;
  outcomePrices?: string;
  volume?: string;
  liquidity?: string;
  active?: boolean;
  closed?: boolean;
  created_at?: string;
  endDate?: string;
  end_date_iso?: string;
  tokens?: Array<{
    token_id: string;
    outcome: string;
    price?: string;
  }>;
  events?: Array<{
    slug?: string | null;
    title?: string | null;
  }>;
}

interface MarketsByTagResponse {
  success: boolean;
  count: number;
  markets: Market[];
  tag_id: string;
  error?: string;
}

interface UseMarketsByTagParams {
  tag_id?: string;
  closed?: boolean;
  limit?: number;
  afterCursor?: string;
}

/**
 * Fetch markets by tag_id
 */
async function fetchMarketsByTag(
  params: UseMarketsByTagParams
): Promise<Market[]> {
  if (!params.tag_id) return [];

  const queryParams = new URLSearchParams();
  queryParams.set("tag_id", params.tag_id);

  if (params.closed !== undefined) {
    queryParams.set("closed", params.closed.toString());
  }
  if (params.limit) {
    queryParams.set("limit", params.limit.toString());
  }
  if (params.afterCursor) {
    queryParams.set("after_cursor", params.afterCursor);
  }

  const response = await fetch(`/api/markets/by-tag?${queryParams.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to fetch markets");
  }

  const data: MarketsByTagResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to fetch markets");
  }

  return data.markets || [];
}

/**
 * Hook to fetch markets by tag_id
 *
 * @param params - Filtering parameters including tag_id
 * @returns TanStack Query result with markets data
 */
export function useMarketsByTag(params: UseMarketsByTagParams) {
  return useQuery({
    queryKey: qk.tags.markets("", params),
    queryFn: () => fetchMarketsByTag(params),
    enabled: !!params.tag_id,
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
  });
}
