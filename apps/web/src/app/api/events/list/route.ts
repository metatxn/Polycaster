import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { fetchGammaKeysetPage } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";
import type { GammaEvent } from "@/types/gamma-api";

const eventsSchema = z.object({
  tag: z.string().nullable().optional(),
  limit: z.string().optional(),
  after_cursor: z.string().optional(),
  closed: z.string().optional(),
});

/**
 * GET /api/events/list
 * Get list of events, optionally filtered by tag.
 */
/**
 * @openapi
 * /api/events/list:
 *   get:
 *     summary: Fetch /api/events/list.
 *     tags: [Events]
 *     responses:
 *       200:
 *         description: Successful response.
 *       400:
 *         description: Invalid request.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Request forbidden.
 *       404:
 *         description: Resource not found.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Request failed.
 */
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;
    const tag = searchParams.get("tag");
    const limit = searchParams.get("limit") || "50";
    const afterCursor = searchParams.get("after_cursor") || undefined;
    const closed = searchParams.get("closed") || "false";

    if (searchParams.has("offset")) {
      return NextResponse.json(
        {
          success: false,
          error: "offset is no longer supported; use after_cursor",
        },
        { status: 400 }
      );
    }

    const parsed = eventsSchema.safeParse({
      tag,
      limit,
      after_cursor: afterCursor,
      closed,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid query parameters",
        },
        { status: 400 }
      );
    }

    const queryParams = new URLSearchParams();
    queryParams.set("limit", limit);
    queryParams.set("closed", closed);

    if (afterCursor) {
      queryParams.set("after_cursor", afterCursor);
    }
    if (parsed.data.tag) {
      queryParams.set("tag_slug", parsed.data.tag);
    }

    const page = await fetchGammaKeysetPage<GammaEvent>(
      {
        endpoint: POLYMARKET_API.GAMMA.EVENTS_KEYSET,
        params: queryParams,
        revalidate: CACHE_DURATION.EVENTS,
      },
      ["events", "data"]
    );

    return NextResponse.json({
      success: true,
      count: page.items.length,
      events: page.items,
      pagination: {
        hasMore: Boolean(page.nextCursor),
        nextCursor: page.nextCursor,
      },
    });
  } catch (error) {
    logger.error("events.list.fetch_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
