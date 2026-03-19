import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";

const eventsSchema = z.object({
  tag: z.string().nullable().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
  closed: z.string().optional(),
  archived: z.string().optional(),
});

/**
 * GET /api/events/list
 * Get list of events, optionally filtered by tag
 *
 * Query params:
 * - tag: Filter by tag (e.g., "nfl", "politics")
 * - limit: Number of results (default: 50)
 * - offset: Pagination offset (default: 0)
 * - closed: Include closed events (default: false)
 * - archived: Include archived events (default: false)
 */
export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;
    const tag = searchParams.get("tag");
    const limit = searchParams.get("limit") || "50";
    const offset = searchParams.get("offset") || "0";
    const closed = searchParams.get("closed") || "false";
    const archived = searchParams.get("archived") || "false";

    const parsed = eventsSchema.safeParse({
      tag,
      limit,
      offset,
      closed,
      archived,
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
    queryParams.set("limit", limit);
    queryParams.set("offset", offset);
    queryParams.set("closed", closed);
    queryParams.set("archived", archived);

    // Use _tag for filtering events by tag
    if (parsed.data.tag) {
      queryParams.set("_tag", parsed.data.tag);
    }

    // console.log(
    //   `hello world: ${POLYMARKET_API.GAMMA.EVENTS}?${queryParams.toString()}`,
    // );
    const response = await fetch(
      `${POLYMARKET_API.GAMMA.EVENTS}?${queryParams.toString()}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: CACHE_DURATION.EVENTS },
      }
    );

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.statusText}`);
    }

    const data = (await response.json()) as unknown[];

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      events: data || [],
    });
  } catch (error) {
    console.error("Error fetching events:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
