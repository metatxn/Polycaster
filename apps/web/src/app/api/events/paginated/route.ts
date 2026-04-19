import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { fetchGammaKeysetPage, toSlimGammaEvent } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";
import { normalizeTagSlug } from "@/lib/tag-slugs";
import type { GammaEvent } from "@/types/gamma-api";

/**
 * GET /api/events/paginated
 * Fetches paginated events from Polymarket Gamma API with server-side filtering.
 *
 * Query params:
 *  - tag_slug: string (optional)
 *  - limit: number (default: 20)
 *  - after_cursor: string (cursor-based pagination)
 *  - closed: boolean (default: false)
 *  - order: string (default: volume24hr)
 *  - ascending: boolean (default: false)
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
    const { searchParams } = new URL(request.url);

    const rawTagSlug = searchParams.get("tag_slug");
    const tagSlug = rawTagSlug ? normalizeTagSlug(rawTagSlug) : null;
    const limit = searchParams.get("limit") || "20";
    const afterCursor = searchParams.get("after_cursor");
    const closed = searchParams.get("closed") || "false";
    const order = searchParams.get("order") || "volume24hr";
    const ascending = searchParams.get("ascending") || "false";
    const fullMarkets = searchParams.get("markets") === "full";

    const volume24hrMin = searchParams.get("volume24hr_min");
    const volume1wkMin = searchParams.get("volume1wk_min");
    const liquidityMin = searchParams.get("liquidity_min");
    const live = searchParams.get("live");
    const startDateMin = searchParams.get("start_date_min");
    const startDateMax = searchParams.get("start_date_max");
    const endDateMin = searchParams.get("end_date_min");
    const endDateMax = searchParams.get("end_date_max");

    if (searchParams.has("offset")) {
      return NextResponse.json(
        {
          success: false,
          error: "offset is no longer supported; use after_cursor",
        },
        { status: 400 }
      );
    }

    const params = new URLSearchParams({
      limit,
      closed,
      order,
      ascending,
    });

    if (afterCursor) {
      params.set("after_cursor", afterCursor);
    }
    if (tagSlug) {
      params.set("tag_slug", tagSlug);
    }
    if (volume24hrMin) {
      params.set("volume_min", volume24hrMin);
    }
    if (volume1wkMin) {
      params.set("volume_min", volume1wkMin);
    }
    if (liquidityMin) {
      params.set("liquidity_min", liquidityMin);
    }
    if (live === "true") {
      params.set("live", "true");
    }
    if (startDateMin) {
      params.set("start_date_min", startDateMin);
    }
    if (startDateMax) {
      params.set("start_date_max", startDateMax);
    }
    if (endDateMin) {
      params.set("end_date_min", endDateMin);
    }
    if (endDateMax) {
      params.set("end_date_max", endDateMax);
    }

    const page = await fetchGammaKeysetPage<GammaEvent>(
      {
        endpoint: POLYMARKET_API.GAMMA.EVENTS_KEYSET,
        params,
        revalidate: CACHE_DURATION.EVENTS,
      },
      ["events", "data"]
    );

    return NextResponse.json(
      {
        success: true,
        data: page.items.map((event) => toSlimGammaEvent(event, fullMarkets)),
        pagination: {
          hasMore: Boolean(page.nextCursor),
          nextCursor: page.nextCursor,
        },
      },
      {
        headers: getCacheHeaders("events"),
      }
    );
  } catch (error) {
    logger.error("events.paginated.fetch_failed", {
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
