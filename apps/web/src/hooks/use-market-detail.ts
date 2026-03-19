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
  description?: string;
  slug?: string;
  image?: string;
  icon?: string;
  endDate?: string;
  end_date_iso?: string;
  /**
   * Minimum order size (in shares) for this market.
   *
   * Gamma market payloads may expose this as `orderMinSize` (camelCase)
   * or `order_min_size` (snake_case).
   */
  orderMinSize?: number | string;
  order_min_size?: number | string;
  volume?: string;
  volumeNum?: number;
  liquidity?: string;
  liquidityNum?: number;
  active?: boolean;
  closed?: boolean;
  outcomes?: string;
  outcomePrices?: string;
  /** CLOB token IDs - JSON string array of token IDs for each outcome */
  clobTokenIds?: string;
  /** Tokens array with token_id for YES and NO outcomes */
  tokens?: MarketToken[];
  /** Whether this is a negative risk market */
  negRisk?: boolean;
  volume24hr?: number;
  oneDayPriceChange?: number;
  lastTradePrice?: number;
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  /** Condition ID for CTF operations (split/merge/redeem) */
  conditionId?: string;
}

interface MarketDetailResponse {
  success: boolean;
  market?: Market;
  error?: string;
}

/**
 * Fetch market by slug (user-friendly URLs)
 * Internally uses ID-based API for better performance
 */
export function useMarketDetail(slug: string | undefined) {
  return useQuery({
    queryKey: ["market-detail", slug],
    queryFn: async () => {
      if (!slug) {
        throw new Error("Market slug is required");
      }

      const response = await fetch(`/api/markets/slug/${slug}`);

      if (!response.ok) {
        throw new Error("Failed to fetch market");
      }

      const data: MarketDetailResponse = await response.json();

      if (!data.success || !data.market) {
        throw new Error(data.error || "Market not found");
      }

      return data.market;
    },
    enabled: !!slug, // Only run query if slug is provided
    staleTime: 60 * 1000, // 1 minute
  });
}
