import { type NextRequest, NextResponse } from "next/server";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";

// Fallback tags if API doesn't have a tags endpoint
const FALLBACK_TAGS = [
  {
    tag: "sports",
    label: "Sports",
    description: "Sports prediction markets including NFL, NBA, MLB, and more",
  },
  {
    tag: "politics",
    label: "Politics",
    description: "Political events, elections, and government decisions",
  },
  {
    tag: "crypto",
    label: "Crypto",
    description: "Cryptocurrency prices, blockchain events, and DeFi",
  },
  {
    tag: "world",
    label: "World",
    description: "Global events, international relations, and world affairs",
  },
  {
    tag: "finance",
    label: "Finance",
    description: "Financial markets, economy, and business outcomes",
  },
  {
    tag: "technology",
    label: "Technology",
    description: "Tech innovations, product launches, and industry trends",
  },
  {
    tag: "entertainment",
    label: "Entertainment",
    description: "Movies, TV shows, awards, and pop culture",
  },
  {
    tag: "trending",
    label: "Trending",
    description: "Most popular and trending prediction markets",
  },
];

/**
 * GET /api/tags
 * Get all available tags/categories
 *
 * Query params:
 * - limit: Number of results (optional)
 */
export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit");

    const queryParams = new URLSearchParams();
    if (limit) {
      queryParams.set("limit", limit);
    }

    const url = queryParams.toString()
      ? `${POLYMARKET_API.GAMMA.BASE}/tags?${queryParams.toString()}`
      : `${POLYMARKET_API.GAMMA.BASE}/tags?order=updatedAt`;

    // console.log("Fetching tags from:", url);

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
      next: { revalidate: CACHE_DURATION.SPORTS_LIST }, // Cache for 1 hour
    });

    if (!response.ok) {
      console.warn(
        `Gamma API /tags endpoint not available (${response.status}), using fallback tags`
      );
      // Use fallback tags if endpoint doesn't exist
      return NextResponse.json(
        {
          success: true,
          count: FALLBACK_TAGS.length,
          tags: FALLBACK_TAGS,
          fallback: true,
        },
        { headers: getCacheHeaders("static") }
      );
    }

    const data = (await response.json()) as unknown[];

    // If data is empty or invalid, use fallback
    if (!data || !Array.isArray(data) || data.length === 0) {
      console.warn("Gamma API /tags returned empty data, using fallback tags");
      return NextResponse.json(
        {
          success: true,
          count: FALLBACK_TAGS.length,
          tags: FALLBACK_TAGS,
          fallback: true,
        },
        { headers: getCacheHeaders("static") }
      );
    }

    // Tags are static data - cache for longer at edge
    return NextResponse.json(
      {
        success: true,
        count: data.length,
        tags: data,
        fallback: false,
      },
      { headers: getCacheHeaders("static") }
    );
  } catch (error) {
    console.error("Error fetching tags:", error);
    // Return fallback tags instead of error
    return NextResponse.json(
      {
        success: true,
        count: FALLBACK_TAGS.length,
        tags: FALLBACK_TAGS,
        fallback: true,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { headers: getCacheHeaders("static") }
    );
  }
}
