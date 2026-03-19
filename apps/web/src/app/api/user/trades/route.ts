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
 * Trade/Activity data from Polymarket Data API
 * Based on actual response from: /activity?user={address}&limit=100&offset=0&sortBy=TIMESTAMP&sortDirection=DESC
 */
interface PolymarketActivity {
  proxyWallet: string;
  timestamp: number; // Unix timestamp
  conditionId: string;
  type: "TRADE" | "REDEEM" | "MERGE" | "SPLIT";
  size: number;
  usdcSize: number;
  transactionHash: string;
  price: number;
  asset: string;
  side: "BUY" | "SELL" | "";
  outcomeIndex: number;
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string;
  name: string;
  pseudonym: string;
  bio: string;
  profileImage: string;
  profileImageOptimized: string;
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
  limit: optionalNumber.pipe(
    z.number().min(1).max(100).optional().default(100)
  ),
  offset: optionalNumber.pipe(z.number().min(0).optional().default(0)),
  sortBy: optionalString.pipe(z.string().optional().default("TIMESTAMP")),
  sortDirection: optionalString.pipe(
    z.enum(["ASC", "DESC"]).optional().default("DESC")
  ),
  market: optionalString,
  type: z
    .enum(["TRADE", "REDEEM", "MERGE", "SPLIT", "ALL"])
    .optional()
    .nullable()
    .transform((val) => val ?? "ALL"),
});

/**
 * GET /api/user/trades
 *
 * Fetch trade history for a user from Polymarket Data API
 * Uses the exact endpoint format: /activity?user={address}&limit=100&offset=0&sortBy=TIMESTAMP&sortDirection=DESC
 *
 * Query Parameters:
 * - user: User's wallet address (required)
 * - limit: Number of trades to return (default: 100, max: 100)
 * - offset: Pagination offset (default: 0)
 * - sortBy: Sort field (default: TIMESTAMP)
 * - sortDirection: Sort direction ASC/DESC (default: DESC)
 * - market: Filter by market/condition ID (optional)
 * - type: Filter by activity type (TRADE, REDEEM, MERGE, SPLIT, ALL) (default: ALL)
 *
 * Response:
 * - trades: Array of trade objects with market details
 * - totalVolume: Total trading volume
 * - count: Number of trades returned
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
      sortBy: searchParams.get("sortBy"),
      sortDirection: searchParams.get("sortDirection"),
      market: searchParams.get("market"),
      type: searchParams.get("type"),
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

    const { user, limit, offset, sortBy, sortDirection, market, type } =
      parsed.data;

    // Build query URL using exact Polymarket format
    const queryParams = new URLSearchParams({
      user: user.toLowerCase(),
      limit: limit.toString(),
      offset: offset.toString(),
      sortBy: sortBy,
      sortDirection: sortDirection,
    });

    if (market) {
      queryParams.set("market", market);
    }

    const fullUrl = `${DATA_API_BASE}/activity?${queryParams.toString()}`;

    // Fetch activity from Polymarket Data API (with 10s timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    let response: Response;
    try {
      response = await fetch(fullUrl, {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return NextResponse.json(
          {
            success: false,
            error: "Request to Polymarket timed out",
          },
          { status: 504 }
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[trades] API error:", errorText);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch trades from Polymarket",
          details: response.status,
        },
        { status: response.status }
      );
    }

    let data: PolymarketActivity[] = await response.json();

    // Filter by type if specified
    if (type !== "ALL") {
      data = data.filter((t) => t.type === type);
    }

    // Calculate totals using actual number fields
    const totalVolume = data.reduce((sum, t) => sum + (t.usdcSize || 0), 0);

    const buyVolume = data
      .filter((t) => t.side === "BUY")
      .reduce((sum, t) => sum + (t.usdcSize || 0), 0);

    const sellVolume = data
      .filter((t) => t.side === "SELL")
      .reduce((sum, t) => sum + (t.usdcSize || 0), 0);

    // Transform trades for frontend
    const transformedTrades = data.map((t) => ({
      id: t.transactionHash,
      timestamp: new Date(t.timestamp * 1000).toISOString(), // Convert Unix timestamp to ISO
      timestampUnix: t.timestamp,
      type: t.type,
      side: t.side || null,
      size: t.size,
      price: t.price,
      usdcAmount: t.usdcSize,
      outcomeIndex: t.outcomeIndex,
      outcome: t.outcome,
      transactionHash: t.transactionHash,
      user: {
        name: t.name,
        pseudonym: t.pseudonym,
        profileImage: t.profileImage,
      },
      market: {
        conditionId: t.conditionId,
        title: t.title,
        slug: t.slug,
        eventSlug: t.eventSlug,
        icon: t.icon,
        asset: t.asset,
      },
    }));

    // Group by date for summary
    const tradesByDate = transformedTrades.reduce(
      (acc, trade) => {
        const date = trade.timestamp.split("T")[0];
        if (!acc[date]) {
          acc[date] = { count: 0, volume: 0 };
        }
        acc[date].count++;
        acc[date].volume += trade.usdcAmount;
        return acc;
      },
      {} as Record<string, { count: number; volume: number }>
    );

    return NextResponse.json({
      success: true,
      user,
      trades: transformedTrades,
      summary: {
        totalVolume,
        buyVolume,
        sellVolume,
        tradeCount: data.length,
        uniqueMarkets: new Set(data.map((t) => t.conditionId)).size,
      },
      dailySummary: tradesByDate,
      pagination: {
        limit,
        offset,
        hasMore: data.length === limit,
      },
    });
  } catch (error) {
    console.error("Error fetching trades:", error);
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
