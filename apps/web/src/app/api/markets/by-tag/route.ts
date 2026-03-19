import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";

const marketsByTagSchema = z.object({
  tag_id: z.string(),
  closed: z.string().optional(),
  archived: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

/**
 * GET /api/markets/by-tag
 * Get markets filtered by tag_id (closed=false enforced)
 *
 * Query params:
 * - tag_id: Tag ID (required, e.g., "342" for California)
 * - closed: Include closed markets (default: false, always enforced)
 * - archived: Include archived markets (default: false)
 * - limit: Number of results (default: 50)
 * - offset: Pagination offset (default: 0)
 */
export async function GET(request: NextRequest) {
  // Apply rate limiting: 100 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    interval: 60 * 1000,
    uniqueTokenPerInterval: 100,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const tag_id = searchParams.get("tag_id");
    const closed = searchParams.get("closed") || "false"; // Always enforce closed=false
    const archived = searchParams.get("archived") || "false";
    const limit = searchParams.get("limit") || "50";
    const offset = searchParams.get("offset") || "0";

    if (!tag_id) {
      return NextResponse.json(
        {
          success: false,
          error: "tag_id is required",
        },
        { status: 400 }
      );
    }

    const parsed = marketsByTagSchema.safeParse({
      tag_id,
      closed,
      archived,
      limit,
      offset,
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

    const queryParams = new URLSearchParams();
    queryParams.set("tag_id", tag_id);
    queryParams.set("closed", closed);
    queryParams.set("archived", archived);
    queryParams.set("limit", limit);
    queryParams.set("offset", offset);

    // console.log(`Fetching markets for tag_id: ${tag_id}`);

    const response = await fetch(
      `${POLYMARKET_API.GAMMA.MARKETS}?${queryParams.toString()}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: CACHE_DURATION.MARKETS }, // Cache for 1 minute
      }
    );

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.statusText}`);
    }

    const data = (await response.json()) as Array<Record<string, unknown>>;

    // Sort by creation date (newest first)
    const sortedData = Array.isArray(data)
      ? data.sort((a, b) => {
          const dateA = new Date((a.created_at as string) || 0).getTime();
          const dateB = new Date((b.created_at as string) || 0).getTime();
          return dateB - dateA;
        })
      : [];

    return NextResponse.json({
      success: true,
      count: sortedData.length || 0,
      markets: sortedData || [],
      tag_id,
    });
  } catch (error) {
    console.error("Error fetching markets by tag:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
