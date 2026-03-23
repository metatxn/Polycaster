import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";

// Validation schema
const teamsSchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
  league: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  abbreviation: z.string().nullable().optional(),
});

/**
 * GET /api/sports/teams
 * Get list of sports teams with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limit: 60 requests per minute
    const rateLimitResponse = checkRateLimit(request, {
      uniqueTokenPerInterval: 60,
    });
    if (rateLimitResponse) return rateLimitResponse;

    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit") || "100";
    const offset = searchParams.get("offset") || "0";
    const league = searchParams.get("league");
    const name = searchParams.get("name");
    const abbreviation = searchParams.get("abbreviation");

    const parsed = teamsSchema.safeParse({
      limit,
      offset,
      league,
      name,
      abbreviation,
    });

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

    // Build query string
    const queryParams = new URLSearchParams();
    queryParams.set("limit", limit);
    queryParams.set("offset", offset);

    if (league) {
      queryParams.set("league", league);
    }
    if (name) {
      queryParams.set("name", name);
    }
    if (abbreviation) {
      queryParams.set("abbreviation", abbreviation);
    }

    const response = await fetch(
      `${POLYMARKET_API.GAMMA.TEAMS}?${queryParams.toString()}`,
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
      count: Array.isArray(data) ? data.length : 0,
      teams: Array.isArray(data) ? data : [],
    });
  } catch (error) {
    console.error("Error fetching teams:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
