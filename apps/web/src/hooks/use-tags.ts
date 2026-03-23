import { useQuery } from "@tanstack/react-query";

export interface Tag {
  id?: string;
  tag?: string; // For fallback tags
  slug: string; // API uses slug
  label: string;
  description?: string;
  icon?: string;
  eventCount?: number;
  marketCount?: number;
  forceShow?: boolean;
  forceHide?: boolean;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface TagsResponse {
  success: boolean;
  count: number;
  tags: Tag[];
  error?: string;
}

/**
 * Fetch all available tags/categories
 */
async function fetchTags(): Promise<Tag[]> {
  const response = await fetch("/api/tags");

  if (!response.ok) {
    throw new Error("Failed to fetch tags");
  }

  const data: TagsResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to fetch tags");
  }

  return data.tags || [];
}

/**
 * Hook to fetch all tags/categories
 *
 * @returns TanStack Query result with tags data
 */
export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: fetchTags,
    staleTime: 60 * 60 * 1000, // 1 hour (tags rarely change)
    refetchOnWindowFocus: false,
  });
}
