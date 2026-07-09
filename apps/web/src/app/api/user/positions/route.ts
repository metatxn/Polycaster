import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_MESSAGES } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { summarizeUserPositions } from "@/lib/user-position-summary";
import { isValidAddress } from "@/lib/validation";

const log = createLogger("api.user.positions");
const UPSTREAM_TIMEOUT_MS = 10_000;
const POSITIONS_UPSTREAM_MAX_PAGES = 5;
const POSITIONS_UPSTREAM_MAX_PAGE_SIZE = 100;
// The merged row space (lost removed, redeemables merged, re-sorted) is only
// constructible by scanning from the top. Deep offsets extend that scan up to
// this many pages; past it pagination ends explicitly — a raw-offset
// passthrough would serve rows from a different row space that duplicate or
// skip entries at the boundary.
const POSITIONS_UPSTREAM_ABSOLUTE_MAX_PAGES = 10;

/**
 * Polymarket Data API base URL
 */
const DATA_API_BASE = "https://data-api.polymarket.com";

/**
 * Position data from Polymarket Data API
 * Based on actual response from: /positions?user={address}&sizeThreshold=.1&redeemable=true
 */
interface PolymarketPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  title: string;
  slug: string;
  icon: string;
  eventId: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string;
  negativeRisk: boolean;
}

interface PolymarketPositionsFetchResult {
  positions: PolymarketPosition[];
  exhausted: boolean;
  scanCapped: boolean;
}

/**
 * Helper to convert null/empty to undefined for optional fields
 */
const optionalString = z
  .string()
  .optional()
  .nullable()
  .transform((val) => (val === null || val === "" ? undefined : val));

const optionalNumber = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((val) => {
    if (val === null || val === "" || val === undefined) return undefined;
    return Number(val);
  });

/**
 * Validation schema for query parameters
 */
const querySchema = z.object({
  user: z.string().min(1, "User address is required").refine(isValidAddress, {
    message: "Invalid Ethereum address format",
  }),
  limit: optionalNumber.pipe(z.number().min(1).max(100).optional().default(50)),
  offset: optionalNumber.pipe(z.number().min(0).optional().default(0)),
  sizeThreshold: optionalNumber.pipe(z.number().optional().default(0.1)),
  market: optionalString,
});

async function fetchPolymarketPositionsPage(
  queryParams: URLSearchParams,
  upstreamOffset: number
): Promise<
  | { success: true; batch: PolymarketPosition[] }
  | { success: false; response: NextResponse }
> {
  const pageQueryParams = new URLSearchParams(queryParams);
  pageQueryParams.set("offset", upstreamOffset.toString());
  const fullUrl = `${DATA_API_BASE}/positions?${pageQueryParams.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(fullUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        success: false,
        response: NextResponse.json(
          {
            success: false,
            error: "Request to Polymarket timed out",
          },
          { status: 504 }
        ),
      };
    }

    log.error("upstream.fetch.failed", { error });
    return {
      success: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Failed to reach Polymarket positions API",
        },
        { status: 502 }
      ),
    };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    log.error("upstream.error", { status: response.status });
    return {
      success: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Failed to fetch positions from Polymarket",
          details: response.status,
        },
        { status: response.status }
      ),
    };
  }

  return {
    success: true,
    batch: (await response.json()) as PolymarketPosition[],
  };
}

async function fetchPolymarketPositions(
  queryParams: URLSearchParams,
  options: {
    limit: number;
    offset: number;
    maxPages: number;
    stopWhen?: (positions: PolymarketPosition[]) => boolean;
  }
): Promise<
  | { success: true; result: PolymarketPositionsFetchResult }
  | { success: false; response: NextResponse }
> {
  const positions: PolymarketPosition[] = [];
  let upstreamOffset = options.offset;
  let exhausted = false;
  let scanCapped = false;

  for (let page = 0; page < options.maxPages; page++) {
    const pageResult = await fetchPolymarketPositionsPage(
      queryParams,
      upstreamOffset
    );
    if (!pageResult.success) return pageResult;

    const batch = pageResult.batch;
    positions.push(...batch);

    if (batch.length < options.limit) {
      exhausted = true;
      break;
    }

    if (options.stopWhen?.(positions)) break;
    upstreamOffset += batch.length;

    if (page === options.maxPages - 1) {
      scanCapped = true;
    }
  }

  if (scanCapped) {
    // A full final page doesn't prove more rows exist (exact-multiple totals
    // end precisely at the cap) — probe once so the flag is truthful. On a
    // probe failure keep the conservative "capped" answer.
    const probe = await fetchPolymarketPositionsPage(
      queryParams,
      upstreamOffset
    );
    if (probe.success && probe.batch.length === 0) {
      scanCapped = false;
      exhausted = true;
    }
  }

  return {
    success: true,
    result: { positions, exhausted, scanCapped },
  };
}

function positionKey(position: PolymarketPosition): string {
  return `${position.conditionId}-${position.outcomeIndex}`;
}

function isLostRedeemablePosition(position: PolymarketPosition): boolean {
  return position.redeemable && position.curPrice === 0;
}

function sortByCurrentValueDesc(
  a: PolymarketPosition,
  b: PolymarketPosition
): number {
  return b.currentValue - a.currentValue;
}

/**
 * GET /api/user/positions
 *
 * Fetch current positions for a user from Polymarket Data API
 * Uses the exact endpoint format Polymarket uses:
 * /positions?user={address}&sizeThreshold=.1&limit=50&offset=0&sortBy=CURRENT&sortDirection=DESC
 *
 * Query Parameters:
 * - user: User's wallet address (required)
 * - limit: Number of positions to return (default: 50, max: 100)
 * - offset: Pagination offset (default: 0)
 * - sizeThreshold: Minimum position size (default: 0.1)
 * - market: Filter by market/condition ID (optional)
 *
 * Response:
 * - positions: Array of OPEN position objects (filters out resolved/lost positions)
 * - totalValue: Total value of all positions
 * - totalPnl: Total unrealized P&L
 * - count: Number of positions returned
 */
/**
 * @openapi
 * /api/user/positions:
 *   get:
 *     summary: Fetch /api/user/positions.
 *     tags: [User]
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
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse and validate query parameters
    const parsed = querySchema.safeParse({
      user: searchParams.get("user"),
      limit: searchParams.get("limit"),
      offset: searchParams.get("offset"),
      sizeThreshold: searchParams.get("sizeThreshold"),
      market: searchParams.get("market"),
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

    const { user, limit, offset, sizeThreshold, market } = parsed.data;
    const mergedPageEnd = offset + limit;
    const fetchTarget = mergedPageEnd + 1;
    const maxScanRows =
      POSITIONS_UPSTREAM_ABSOLUTE_MAX_PAGES * POSITIONS_UPSTREAM_MAX_PAGE_SIZE;
    if (fetchTarget > maxScanRows) {
      return NextResponse.json({
        success: true,
        user,
        positions: [],
        lostPositions: [],
        summary: summarizeUserPositions([]),
        pagination: {
          limit,
          offset,
          hasMore: false,
          scanCapped: true,
        },
      });
    }
    const upstreamPageSize = Math.min(
      POSITIONS_UPSTREAM_MAX_PAGE_SIZE,
      Math.max(limit, fetchTarget)
    );
    const maxScanPages = Math.min(
      POSITIONS_UPSTREAM_ABSOLUTE_MAX_PAGES,
      Math.max(
        POSITIONS_UPSTREAM_MAX_PAGES,
        Math.ceil(fetchTarget / upstreamPageSize)
      )
    );

    // Build query URL using exact Polymarket format
    // Polymarket uses: ?user=...&sizeThreshold=.1&limit=50&offset=0&sortBy=CURRENT&sortDirection=DESC
    const baseQueryParams = new URLSearchParams({
      user: user.toLowerCase(),
      sizeThreshold: sizeThreshold.toString(),
      limit: upstreamPageSize.toString(),
      offset: "0",
      sortBy: "CURRENT",
      sortDirection: "DESC",
    });

    if (market) {
      baseQueryParams.set("market", market);
    }

    // Fetch pages from upstream until we have `limit` active positions
    // or exhaust all upstream records. This avoids returning fewer active
    // positions than requested when some rows are lost/redeemable.
    const openResultPromise = fetchPolymarketPositions(baseQueryParams, {
      limit: upstreamPageSize,
      offset: 0,
      maxPages: maxScanPages,
      stopWhen: (items) =>
        items.filter((item) => !isLostRedeemablePosition(item)).length >=
        fetchTarget,
    });
    const redeemableQueryParams = new URLSearchParams(baseQueryParams);
    redeemableQueryParams.set("redeemable", "true");
    const redeemableResultPromise = fetchPolymarketPositions(
      redeemableQueryParams,
      {
        limit: upstreamPageSize,
        offset: 0,
        maxPages: maxScanPages,
        stopWhen: (items) => items.length >= fetchTarget,
      }
    );
    const [openResult, redeemableResult] = await Promise.all([
      openResultPromise,
      redeemableResultPromise,
    ]);
    if (!openResult.success) return openResult.response;
    if (!redeemableResult.success) return redeemableResult.response;

    const lostPositionsByKey = new Map<string, PolymarketPosition>();
    const winningRedeemablePositions: PolymarketPosition[] = [];

    for (const p of redeemableResult.result.positions) {
      if (isLostRedeemablePosition(p)) {
        lostPositionsByKey.set(positionKey(p), p);
      } else {
        winningRedeemablePositions.push(p);
      }
    }

    const openPositionsByKey = new Map<string, PolymarketPosition>();
    for (const p of openResult.result.positions) {
      const key = positionKey(p);
      if (isLostRedeemablePosition(p)) {
        lostPositionsByKey.set(key, p);
      } else if (!lostPositionsByKey.has(key)) {
        openPositionsByKey.set(key, p);
      }
    }

    for (const p of winningRedeemablePositions) {
      const key = positionKey(p);
      if (!lostPositionsByKey.has(key) && !openPositionsByKey.has(key)) {
        openPositionsByKey.set(key, p);
      }
    }

    const mergedPositions = [...openPositionsByKey.values()].sort(
      sortByCurrentValueDesc
    );
    const positions = mergedPositions.slice(offset, mergedPageEnd);
    const lostPositions = [...lostPositionsByKey.values()];
    const hasMore = mergedPositions.length > mergedPageEnd;
    const scanCapped =
      openResult.result.scanCapped || redeemableResult.result.scanCapped;

    // Calculate totals using actual field names from API.
    const summary = summarizeUserPositions(positions);

    // Transform positions for frontend
    const transformedPositions = positions.map((p) => ({
      id: `${p.conditionId}-${p.outcomeIndex}`,
      asset: p.asset,
      conditionId: p.conditionId,
      outcomeIndex: p.outcomeIndex,
      outcome: p.outcome,
      oppositeOutcome: p.oppositeOutcome,
      size: p.size,
      avgPrice: p.avgPrice,
      currentPrice: p.curPrice,
      currentValue: p.currentValue,
      initialValue: p.initialValue,
      unrealizedPnl: p.cashPnl,
      unrealizedPnlPercent: p.percentPnl,
      realizedPnl: p.realizedPnl,
      realizedPnlPercent: p.percentRealizedPnl,
      totalBought: p.totalBought,
      redeemable: p.redeemable,
      // Surfaced at top level so Quick Sell (see use-sell-position.ts) can
      // sign against the correct exchange contract — multi-outcome
      // negative-risk markets require `{ negRisk: true }` in the order
      // options so the signature is verified against NEG_RISK_CTF_EXCHANGE.
      negRisk: p.negativeRisk,
      market: {
        title: p.title,
        slug: p.slug,
        eventSlug: p.eventSlug,
        eventId: p.eventId,
        icon: p.icon,
        endDate: p.endDate,
        negativeRisk: p.negativeRisk,
      },
    }));

    const transformedLostPositions = lostPositions.map((p) => ({
      id: `${p.conditionId}-${p.outcomeIndex}`,
      asset: p.asset,
      conditionId: p.conditionId,
      outcomeIndex: p.outcomeIndex,
      outcome: p.outcome,
      size: p.size,
      avgPrice: p.avgPrice,
      initialValue: p.initialValue,
      endDate: p.endDate,
      negRisk: p.negativeRisk,
      market: {
        title: p.title,
        slug: p.slug,
        eventSlug: p.eventSlug,
        eventId: p.eventId,
        icon: p.icon,
      },
    }));

    return NextResponse.json({
      success: true,
      user,
      positions: transformedPositions,
      lostPositions: transformedLostPositions,
      summary,
      pagination: {
        limit,
        offset,
        hasMore,
        scanCapped,
      },
    });
  } catch (error) {
    log.error("fetch.failed", { error });
    return NextResponse.json(
      {
        success: false,
        error: ERROR_MESSAGES.UNKNOWN_ERROR,
      },
      { status: 500 }
    );
  }
}
