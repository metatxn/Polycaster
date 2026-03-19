import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";

/**
 * GET /api/sports/list
 * Get list of all available sports
 */
export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit") || "100";

    const response = await fetch(
      `${POLYMARKET_API.GAMMA.SPORTS}?limit=${limit}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      sports: data,
    });
  } catch (error) {
    console.error("Error fetching sports:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
