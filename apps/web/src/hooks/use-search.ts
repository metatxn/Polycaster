import { useQuery } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";

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
  limit = 10,
  tagSlug?: string
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
  // Server-side tag scoping. Upstream's /public-search doesn't accept a
  // tag filter, but our API route fans out to /events/keyset?tag_slug=…
  // in parallel and merges results — exactly what we want for in-page
  // scoped searches like /events/politics.
  if (tagSlug) {
    params.set("tag_slugs", tagSlug);
  }

  const response = await fetch(`/api/search?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Failed to search");
  }

  return response.json();
}

export function useSearch(query: string, limit = 10, tagSlug?: string) {
  return useQuery({
    queryKey: qk.search(query, limit, tagSlug ?? null),
    queryFn: () => fetchSearchResults(query, limit, tagSlug),
    enabled: query.trim().length >= 2, // Only search with 2+ characters
    staleTime: 30 * 1000, // 30 seconds
    placeholderData: (previousData) => previousData,
  });
}
