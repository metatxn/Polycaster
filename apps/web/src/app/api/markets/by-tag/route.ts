import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { fetchGammaKeysetPage } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";

const marketsByTagSchema = z.object({
  tag_id: z.string(),
  closed: z.string().optional(),
  limit: z.string().optional(),
  after_cursor: z.string().optional(),
});

/**
 * GET /api/markets/by-tag
 * Get markets filtered by tag_id (closed defaults to false).
 */
export async function GET(request: NextRequest) {
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
    const closed = searchParams.get("closed") || "false";
    const limit = searchParams.get("limit") || "50";
    const afterCursor = searchParams.get("after_cursor") || undefined;

    if (searchParams.has("offset")) {
      return NextResponse.json(
        {
          success: false,
          error: "offset is no longer supported; use after_cursor",
        },
        { status: 400 }
      );
    }

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
      limit,
      after_cursor: afterCursor,
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
    queryParams.set("limit", limit);
    queryParams.set("closed", closed);
    queryParams.set("order", "createdAt");
    queryParams.set("ascending", "false");
    if (afterCursor) {
      queryParams.set("after_cursor", afterCursor);
    }

    const page = await fetchGammaKeysetPage<Record<string, unknown>>(
      {
        endpoint: POLYMARKET_API.GAMMA.MARKETS_KEYSET,
        params: queryParams,
        revalidate: CACHE_DURATION.MARKETS,
      },
      ["markets", "data"]
    );

    return NextResponse.json({
      success: true,
      count: page.items.length,
      markets: page.items,
      tag_id,
      pagination: {
        hasMore: Boolean(page.nextCursor),
        nextCursor: page.nextCursor,
      },
    });
  } catch (error) {
    logger.error("markets.by_tag.fetch_failed", {
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
