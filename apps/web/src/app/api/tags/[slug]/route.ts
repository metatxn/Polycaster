import { type NextRequest, NextResponse } from "next/server";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";

/**
 * GET /api/tags/:slug
 * Get tag details by slug (e.g., "sports", "politics", "dating")
 * This returns the tag ID needed to fetch markets
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  // Apply rate limiting: 100 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    interval: 60 * 1000,
    uniqueTokenPerInterval: 100,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }
  try {
    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        {
          success: false,
          error: "Tag slug is required",
        },
        { status: 400 }
      );
    }

    // console.log(`Fetching tag details for slug: ${slug}`);
    // console.log(
    //   `hello api-tags-slug: ${POLYMARKET_API.GAMMA.BASE}/tags/slug/${slug}`,
    // );

    // Fetch tag details from Gamma API
    const response = await fetch(
      `${POLYMARKET_API.GAMMA.BASE}/tags/slug/${slug}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: CACHE_DURATION.SPORTS_LIST }, // Cache for 1 hour
      }
    );

    if (!response.ok) {
      console.error(`Gamma API error for slug ${slug}: ${response.statusText}`);
      return NextResponse.json(
        {
          success: false,
          error: `Tag not found: ${slug}`,
        },
        { status: response.status }
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (!data || !data.id) {
      return NextResponse.json(
        {
          success: false,
          error: `Tag not found: ${slug}`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      tag: data,
    });
  } catch (error) {
    console.error("Error fetching tag details:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
