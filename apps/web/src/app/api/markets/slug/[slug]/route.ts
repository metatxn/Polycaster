import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";

/**
 * GET /api/markets/slug/:slug
 * Get market details by slug (recommended by Polymarket API team)
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
          error: "Market slug is required",
        },
        { status: 400 }
      );
    }

    // Fetch market using slug query (recommended by API team)
    // Always filter closed=false unless specifically requesting historical data
    const slugResponse = await fetch(
      `${POLYMARKET_API.GAMMA.MARKETS}?slug=${encodeURIComponent(
        slug
      )}&closed=false`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: 60 }, // Cache for 1 minute
      }
    );

    if (!slugResponse.ok) {
      throw new Error(`Gamma API error: ${slugResponse.statusText}`);
    }

    const slugData = (await slugResponse.json()) as Array<
      Record<string, unknown>
    >;

    // Gamma returns an array, get first match
    if (!slugData || slugData.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Market not found",
        },
        { status: 404 }
      );
    }

    const market = slugData[0];

    return NextResponse.json({
      success: true,
      market,
    });
  } catch (error) {
    console.error("Error fetching market by slug:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
