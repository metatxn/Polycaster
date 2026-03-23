import { useQuery } from "@tanstack/react-query";

export interface TagDetails {
  id: string;
  label: string;
  slug: string;
  description?: string;
  forceShow?: boolean;
  forceHide?: boolean;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface TagDetailsResponse {
  success: boolean;
  tag: TagDetails;
  error?: string;
}

/**
 * Fetch tag details by slug
 * This returns the tag ID needed to fetch markets
 */
async function fetchTagDetails(
  slug: string | undefined
): Promise<TagDetails | null> {
  if (!slug) return null;

  const response = await fetch(`/api/tags/${slug}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch tag details for: ${slug}`);
  }

  const data: TagDetailsResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to fetch tag details");
  }

  return data.tag;
}

/**
 * Hook to fetch tag details by slug
 *
 * @param slug - Tag slug (e.g., "sports", "politics", "dating")
 * @returns TanStack Query result with tag data including ID
 */
export function useTagDetails(slug: string | undefined) {
  return useQuery({
    queryKey: ["tag", "details", slug],
    queryFn: () => fetchTagDetails(slug),
    enabled: !!slug,
    staleTime: 60 * 60 * 1000, // 1 hour (tags rarely change)
    refetchOnWindowFocus: false,
  });
}
