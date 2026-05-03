import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { fetchGammaKeysetPage, toSlimGammaEvent } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";
import { normalizeTagSlug } from "@/lib/tag-slugs";
import type { GammaEvent } from "@/types/gamma-api";

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 2048;
const TAG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-]+Z?)?$/;
const ALLOWED_ORDER_FIELDS = new Set([
  "volume",
  "volume24hr",
  "volume1wk",
  "volume1mo",
  "volume1yr",
  "liquidity",
  "liquidityClob",
  "startDate",
  "endDate",
  "createdAt",
  "updatedAt",
  "competitive",
]);

class QueryValidationError extends Error {}

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

function parseLimit(searchParams: URLSearchParams): number {
  const raw = searchParams.get("limit");
  if (raw === null || raw.trim() === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) {
    throw new QueryValidationError("limit must be a positive integer");
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < MIN_LIMIT) {
    throw new QueryValidationError("limit must be a positive integer");
  }

  return Math.min(value, MAX_LIMIT);
}

function parseBooleanParam(
  searchParams: URLSearchParams,
  name: string,
  defaultValue: boolean
): boolean {
  const raw = searchParams.get(name);
  if (raw === null || raw.trim() === "") return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new QueryValidationError(`${name} must be true or false`);
}

function parseSeriesId(searchParams: URLSearchParams): string | null {
  const raw = searchParams.get("series_id");
  if (raw === null || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw)) {
    throw new QueryValidationError("series_id must be a positive integer");
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new QueryValidationError("series_id must be a positive integer");
  }

  return String(value);
}

function parseTagSlug(searchParams: URLSearchParams): string | null {
  const raw = searchParams.get("tag_slug");
  if (raw === null || raw.trim() === "") return null;

  const tagSlug = normalizeTagSlug(raw);
  if (!TAG_SLUG_PATTERN.test(tagSlug)) {
    throw new QueryValidationError("tag_slug is invalid");
  }

  return tagSlug;
}

function parseOrder(searchParams: URLSearchParams): string {
  const order = searchParams.get("order") || "volume24hr";
  if (!ALLOWED_ORDER_FIELDS.has(order)) {
    throw new QueryValidationError("order is not supported");
  }
  return order;
}

function parseCursor(searchParams: URLSearchParams): string | null {
  const cursor = searchParams.get("after_cursor");
  if (!cursor) return null;
  if (cursor.length > MAX_CURSOR_LENGTH) {
    throw new QueryValidationError("after_cursor is too long");
  }
  return cursor;
}

function parseNonNegativeNumberParam(
  searchParams: URLSearchParams,
  name: string
): string | null {
  const raw = searchParams.get(name);
  if (raw === null || raw.trim() === "") return null;
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new QueryValidationError(`${name} must be a non-negative number`);
  }
  if (!Number.isFinite(Number(trimmed))) {
    throw new QueryValidationError(`${name} must be a finite number`);
  }
  return trimmed;
}

function parseDateParam(
  searchParams: URLSearchParams,
  name: string
): string | null {
  const raw = searchParams.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = raw.trim();
  if (!ISO_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new QueryValidationError(`${name} must be a valid date`);
  }
  return value;
}

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

    const tagSlug = parseTagSlug(searchParams);
    const seriesId = parseSeriesId(searchParams);
    const limit = parseLimit(searchParams);
    const afterCursor = parseCursor(searchParams);
    const closed = parseBooleanParam(searchParams, "closed", false);
    const order = parseOrder(searchParams);
    const ascending = parseBooleanParam(searchParams, "ascending", false);
    const fullMarkets = searchParams.get("markets") === "full";

    const volume24hrMin = parseNonNegativeNumberParam(
      searchParams,
      "volume24hr_min"
    );
    const volume1wkMin = parseNonNegativeNumberParam(
      searchParams,
      "volume1wk_min"
    );
    const liquidityMin = parseNonNegativeNumberParam(
      searchParams,
      "liquidity_min"
    );
    const live = parseBooleanParam(searchParams, "live", false);
    const startDateMin = parseDateParam(searchParams, "start_date_min");
    const startDateMax = parseDateParam(searchParams, "start_date_max");
    const endDateMin = parseDateParam(searchParams, "end_date_min");
    const endDateMax = parseDateParam(searchParams, "end_date_max");

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
      limit: String(limit),
      closed: String(closed),
      order,
      ascending: String(ascending),
    });

    if (afterCursor) {
      params.set("after_cursor", afterCursor);
    }
    if (seriesId) {
      // series_id is the precise filter Polymarket's UI uses; prefer it
      // over tag_slug when both are supplied.
      params.set("series_id", seriesId);
      params.set("active", "true");
    } else if (tagSlug) {
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
    if (live) {
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
    if (error instanceof QueryValidationError) {
      return badRequest(error.message);
    }

    logger.error("events.paginated.fetch_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch paginated events",
      },
      { status: 500 }
    );
  }
}
