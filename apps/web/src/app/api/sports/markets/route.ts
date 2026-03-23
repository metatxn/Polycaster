import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";

// Validation schema - nullable to handle null from searchParams.get()
const marketsSchema = z.object({
  sport: z.string().nullable().optional(),
  league: z.string().nullable().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

/**
 * GET /api/sports/markets
 * Get sports markets, optionally filtered by sport/league
 *
 * Flow:
 * 1. If no sport specified, fetch all sports and get markets for all
 * 2. If sport specified, use it as a tag to filter markets
 *
 * Sports tags: nfl, nba, mlb, nhl, soccer, mma, etc.
 */
export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;
    const sport = searchParams.get("sport");
    const league = searchParams.get("league");
    const limit = searchParams.get("limit") || "20";
    const offset = searchParams.get("offset") || "0";

    const parsed = marketsSchema.safeParse({ sport, league, limit, offset });

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid query parameters",
          details: parsed.error.message,
        },
        { status: 400 }
      );
    }

    // Use parsed data
    const { sport: parsedSport, league: parsedLeague } = parsed.data;

    // Build query string for markets API
    // The markets endpoint accepts 'tag' parameter to filter by sport
    const queryParams = new URLSearchParams();
    queryParams.set("limit", limit);
    queryParams.set("offset", offset);
    queryParams.set("closed", "false"); // Only open markets
    queryParams.set("archived", "false"); // Not archived

    // Add tag filter if sport or league is specified
    // Common tags: nfl, nba, mlb, nhl, soccer, mma, esports, etc.
    const tag = parsedLeague || parsedSport;
    if (tag) {
      queryParams.set("_tag", tag); // Use _tag for filtering
    }

    // console.log("Fetching markets with params:", queryParams.toString());

    const response = await fetch(
      `${POLYMARKET_API.GAMMA.MARKETS}?${queryParams.toString()}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: 60 }, // Cache for 1 minute
      }
    );

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    return NextResponse.json({
      success: true,
      count: Array.isArray(data) ? data.length : 0,
      markets: Array.isArray(data) ? data : [],
      filters: {
        sport: parsedSport || "all",
        league: parsedLeague || "all",
        tag: tag || "all",
      },
    });
  } catch (error) {
    console.error("Error fetching sports markets:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
