import { useQuery } from "@tanstack/react-query";

export interface TopOutcome {
  name: string;
  price: number; // 0-1 representing percentage
}

export interface SearchEvent {
  id: string;
  slug?: string;
  title: string;
  description?: string;
  image?: string;
  icon?: string;
  volume?: number;
  volume24hr?: number;
  liquidity?: number;
  active?: boolean;
  closed?: boolean;
  live?: boolean;
  ended?: boolean;
  competitive?: number;
  topOutcome?: TopOutcome;
  markets?: Array<{
    id: string;
    question: string;
    slug?: string;
    outcomePrices?: string;
    outcomes?: string;
    groupItemTitle?: string;
  }>;
  tags?: Array<{
    id: string;
    label?: string;
    slug?: string;
  }>;
}

export interface SearchTag {
  id: string;
  label: string;
  slug: string;
  event_count?: number;
}

export interface SearchProfile {
  id: string;
  name?: string;
  pseudonym?: string;
  profileImage?: string;
  bio?: string;
  proxyWallet?: string;
}

export interface SearchResponse {
  events: SearchEvent[];
  tags: SearchTag[] | null;
  profiles: SearchProfile[] | null;
  pagination: {
    hasMore: boolean;
    totalResults: number;
  };
}

async function fetchSearchResults(
  query: string,
  limit = 10
): Promise<SearchResponse> {
  if (!query.trim()) {
    return {
      events: [],
      tags: [],
      profiles: [],
      pagination: { hasMore: false, totalResults: 0 },
    };
  }

  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));

  const response = await fetch(`/api/search?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to search");
  }

  return response.json();
}

export function useSearch(query: string, limit = 10) {
  return useQuery({
    queryKey: ["search", query, limit],
    queryFn: () => fetchSearchResults(query, limit),
    enabled: query.trim().length >= 2, // Only search with 2+ characters
    staleTime: 30 * 1000, // 30 seconds
    placeholderData: (previousData) => previousData,
  });
}
