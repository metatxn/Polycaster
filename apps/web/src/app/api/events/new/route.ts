import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { parseEventsQuery } from "@/lib/events-query";
import { fetchGammaKeysetPage, toSlimGammaEvent } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";
import type { GammaEvent } from "@/types/gamma-api";

/**
 * GET /api/events/new
 * Get newest events sorted by start date.
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
    const parsedQuery = parseEventsQuery(request.nextUrl.searchParams);
    if (!parsedQuery.ok) {
      return NextResponse.json(
        {
          success: false,
          error: parsedQuery.error,
          ...(parsedQuery.details ? { details: parsedQuery.details } : {}),
        },
        { status: parsedQuery.status }
      );
    }
    const {
      limit,
      closed,
      afterCursor,
      volume24hrMin,
      volume1wkMin,
      liquidityMin,
      tagSlug,
      fullMarkets,
    } = parsedQuery.data;

    const queryParams = new URLSearchParams();
    queryParams.set("limit", limit);
    queryParams.set("closed", closed);
    queryParams.set("order", "startDate");
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
    logger.error("events.new.fetch_failed", {
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
