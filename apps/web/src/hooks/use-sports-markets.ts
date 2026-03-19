import { useQuery } from "@tanstack/react-query";

interface Market {
  id: string;
  question: string;
  description?: string;
  endDate?: string;
  end_date_iso?: string;
  volume?: string;
  active?: boolean;
  created_at?: string;
  slug?: string;
  events?: Array<{
    slug?: string | null;
    title?: string | null;
  }>;
  outcomes?:
    | string[]
    | Array<{
        name: string;
        price: string;
      }>;
  tokens?: Array<{
    token_id: string;
    outcome: string;
    price?: string;
  }>;
}

interface SportsMarketsResponse {
  success: boolean;
  count: number;
  markets: Market[];
  filters?: {
    sport: string;
    league: string;
    tag?: string;
  };
  error?: string;
}

export function useSportsMarkets(sportTag?: string) {
  return useQuery({
    queryKey: ["sports-markets", sportTag],
    queryFn: async () => {
      const url = sportTag
        ? `/api/sports/markets?limit=20&sport=${sportTag}`
        : "/api/sports/markets?limit=20";

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Failed to fetch markets");
      }

      const data: SportsMarketsResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to fetch markets");
      }

      // Sort markets by creation date (latest first)
      const sortedMarkets = (data.markets || []).sort((a, b) => {
        const dateA = new Date(a.created_at || a.end_date_iso || 0).getTime();
        const dateB = new Date(b.created_at || b.end_date_iso || 0).getTime();
        return dateB - dateA;
      });

      return { ...data, markets: sortedMarkets };
    },
    staleTime: 60 * 1000, // 1 minute
  });
}
