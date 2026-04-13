import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { fetchGammaKeysetPage, toSlimGammaEvent } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";
import type { GammaEvent } from "@/types/gamma-api";

/**
 * GET /api/events/trending
 * Get trending events sorted by total volume (highest first).
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
    const limit = searchParams.get("limit") || "15";
    const afterCursor = searchParams.get("after_cursor");

    const volume24hrMin = searchParams.get("volume24hr_min");
    const volume1wkMin = searchParams.get("volume1wk_min");
    const liquidityMin = searchParams.get("liquidity_min");
    const tagSlug = searchParams.get("tag_slug");
    const closed = searchParams.get("closed");

    if (searchParams.has("offset")) {
      return NextResponse.json(
        {
          success: false,
          error: "offset is no longer supported; use after_cursor",
        },
        { status: 400 }
      );
    }

    const queryParams = new URLSearchParams();
    queryParams.set("limit", limit);
    queryParams.set("closed", closed || "false");
    queryParams.set("order", "volume");
    queryParams.set("ascending", "false");

    if (afterCursor) {
      queryParams.set("after_cursor", afterCursor);
    }

    queryParams.append("exclude_tag_id", "100639");
    queryParams.append("exclude_tag_id", "102169");

    if (volume24hrMin) {
      queryParams.set("volume_min", volume24hrMin);
    }
    if (volume1wkMin) {
      queryParams.set("volume_min", volume1wkMin);
    }
    if (liquidityMin) {
      queryParams.set("liquidity_min", liquidityMin);
    }
    if (tagSlug) {
      queryParams.set("tag_slug", tagSlug);
    }

    const page = await fetchGammaKeysetPage<GammaEvent>(
      {
        endpoint: POLYMARKET_API.GAMMA.EVENTS_KEYSET,
        params: queryParams,
        revalidate: 60,
      },
      ["events", "data"]
    );

    return NextResponse.json(
      {
        success: true,
        data: page.items.map((event) => toSlimGammaEvent(event)),
        pagination: {
          hasMore: Boolean(page.nextCursor),
          nextCursor: page.nextCursor,
          totalResults: page.totalResults ?? 0,
        },
      },
      {
        headers: getCacheHeaders("events"),
      }
    );
  } catch (error) {
    logger.error("events.trending.fetch_failed", {
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
