import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_MESSAGES } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { isValidAddress } from "@/lib/validation";

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
  mergeable: boolean;
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
          details: parsed.error.message,
        },
        { status: 400 }
      );
    }

    const { user, limit, offset, sizeThreshold, market } = parsed.data;

    // Build query URL using exact Polymarket format
    // Polymarket uses: ?user=...&sizeThreshold=.1&limit=50&offset=0&sortBy=CURRENT&sortDirection=DESC
    const queryParams = new URLSearchParams({
      user: user.toLowerCase(),
      sizeThreshold: sizeThreshold.toString(),
      limit: limit.toString(),
      offset: offset.toString(),
      sortBy: "CURRENT",
      sortDirection: "DESC",
    });

    if (market) {
      queryParams.set("market", market);
    }

    // Fetch pages from upstream until we have `limit` active positions
    // or exhaust all upstream records. This avoids returning fewer active
    // positions than requested when some rows are lost/redeemable.
    const positions: PolymarketPosition[] = [];
    const lostPositions: PolymarketPosition[] = [];
    let upstreamOffset = offset;
    const maxUpstreamPages = 5;

    for (let page = 0; page < maxUpstreamPages; page++) {
      queryParams.set("offset", upstreamOffset.toString());
      const fullUrl = `${DATA_API_BASE}/positions?${queryParams.toString()}`;

      const response = await fetch(fullUrl, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[positions] API error:", errorText);
        return NextResponse.json(
          {
            success: false,
            error: "Failed to fetch positions from Polymarket",
            details: response.status,
          },
          { status: response.status }
        );
      }

      const batch: PolymarketPosition[] = await response.json();

      for (const p of batch) {
        if (p.redeemable && p.curPrice === 0) {
          lostPositions.push(p);
        } else {
          positions.push(p);
        }
      }

      // Stop if upstream returned fewer rows than limit (last page) or we have enough
      if (batch.length < limit || positions.length >= limit) break;
      upstreamOffset += batch.length;
    }

    const hasMore = positions.length > limit;
    const trimmedPositions = positions.slice(0, limit);

    // Calculate totals using actual field names from API
    const totalValue = trimmedPositions.reduce(
      (sum, p) => sum + (p.currentValue || 0),
      0
    );

    const totalUnrealizedPnl = trimmedPositions.reduce(
      (sum, p) => sum + (p.cashPnl || 0),
      0
    );

    const totalRealizedPnl = trimmedPositions.reduce(
      (sum, p) => sum + (p.realizedPnl || 0),
      0
    );

    // Transform positions for frontend
    const transformedPositions = trimmedPositions.map((p) => ({
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
      mergeable: p.mergeable,
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
      summary: {
        totalValue,
        totalUnrealizedPnl,
        totalRealizedPnl,
        totalPnl: totalUnrealizedPnl + totalRealizedPnl,
        positionCount: trimmedPositions.length,
      },
      pagination: {
        limit,
        offset,
        hasMore,
      },
    });
  } catch (error) {
    console.error("Error fetching positions:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : ERROR_MESSAGES.UNKNOWN_ERROR,
      },
      { status: 500 }
    );
  }
}
