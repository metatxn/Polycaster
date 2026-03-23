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
 * Polymarket User P&L API base URL
 */
const USER_PNL_API = "https://user-pnl-api.polymarket.com";

/**
 * Position data for P&L calculation
 */
interface PositionData {
  size: string;
  avgPrice: string;
  currentPrice: string;
  curPrice: number;
  realizedPnl: string;
  unrealizedPnl: string;
  curValue: string;
  initialValue: string;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  redeemable: boolean;
  outcome: string;
  title: string;
  slug: string;
}

/**
 * Trade data for P&L calculation
 */
interface TradeData {
  timestamp: string;
  side: "BUY" | "SELL";
  size: string;
  price: string;
  usdcSize: string;
  conditionId: string;
  outcome: string;
}

/**
 * Helper to convert null/empty to undefined for optional fields
 */
const optionalBoolean = z
  .union([z.string(), z.boolean()])
  .optional()
  .nullable()
  .transform((val) => {
    if (val === null || val === "" || val === undefined) return undefined;
    if (typeof val === "boolean") return val;
    return val === "true";
  });

/**
 * Validation schema for query parameters
 */
const querySchema = z.object({
  user: z.string().min(1, "User address is required").refine(isValidAddress, {
    message: "Invalid Ethereum address format",
  }),
  period: z
    .enum(["1d", "7d", "30d", "90d", "365d", "all"])
    .optional()
    .nullable()
    .transform((val) => val ?? "all"),
  includeHistory: optionalBoolean.pipe(z.boolean().optional().default(false)),
});

/**
 * GET /api/user/pnl
 *
 * Calculate Profit & Loss for a user
 *
 * Query Parameters:
 * - user: User's wallet address (required)
 * - period: Time period for P&L calculation (1d, 7d, 30d, 90d, 365d, all) (default: all)
 * - includeHistory: Include daily P&L history (default: false)
 *
 * Response:
 * - realizedPnl: Total realized profit/loss from closed positions
 * - unrealizedPnl: Total unrealized profit/loss from open positions
 * - totalPnl: Combined realized + unrealized P&L
 * - winRate: Percentage of winning trades
 * - history: Daily P&L breakdown (if includeHistory=true)
 */
export async function GET(request: NextRequest) {
  // Rate limit: 30 requests per minute (expensive endpoint)
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 30,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse and validate query parameters
    // The schema handles null/empty values via transforms
    const parsed = querySchema.safeParse({
      user: searchParams.get("user"),
      period: searchParams.get("period"),
      includeHistory: searchParams.get("includeHistory"),
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

    const { user, period, includeHistory } = parsed.data;

    // Calculate date range based on period
    const now = new Date();
    let startDate: Date | null = null;

    switch (period) {
      case "1d":
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "365d":
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = null;
    }

    // Map period to Polymarket P&L API interval
    const intervalMap: Record<string, string> = {
      "1d": "1d",
      "7d": "1w",
      "30d": "1m",
      "90d": "3m",
      "365d": "1y",
      all: "all",
    };
    const pnlInterval = intervalMap[period] || "all";

    // Fetch P&L from Polymarket's dedicated P&L API
    const pnlApiResponse = await fetch(
      `${USER_PNL_API}/user-pnl?user_address=${user.toLowerCase()}&interval=${pnlInterval}&fidelity=1d`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      }
    );

    // Fetch current positions (use same params as Polymarket)
    const positionsResponse = await fetch(
      `${DATA_API_BASE}/positions?user=${user.toLowerCase()}&sizeThreshold=.1&redeemable=true&limit=100&offset=0`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      }
    );

    if (!positionsResponse.ok) {
      throw new Error("Failed to fetch positions");
    }

    const allPositions: PositionData[] = await positionsResponse.json();

    // Filter to show only OPEN positions
    // - redeemable: false = market is still open/active
    // - redeemable: true with curPrice > 0 = won bet, can redeem
    const positions = allPositions.filter((p) => {
      const isOpenPosition = !p.redeemable;
      const isWinningRedeemable = p.redeemable && p.curPrice > 0;
      return isOpenPosition || isWinningRedeemable;
    });

    // Fetch trade history
    const tradesResponse = await fetch(
      `${DATA_API_BASE}/activity?user=${user.toLowerCase()}&limit=100`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      }
    );

    if (!tradesResponse.ok) {
      throw new Error("Failed to fetch trades");
    }

    let trades: TradeData[] = await tradesResponse.json();

    // Filter trades by date range
    if (startDate) {
      trades = trades.filter(
        (t) => new Date(t.timestamp).getTime() >= startDate.getTime()
      );
    }

    // Try to get P&L from dedicated API, fallback to position-based calculation
    let unrealizedPnl = 0;
    let realizedPnlFromPositions = 0;
    let pnlApiData: { t: number; p: number }[] | null = null;

    if (pnlApiResponse.ok) {
      try {
        pnlApiData = await pnlApiResponse.json();
        // The P&L API returns an array of { t: timestamp, p: pnl_value }
        // The last value is the current P&L
        if (Array.isArray(pnlApiData) && pnlApiData.length > 0) {
          const latestPnl = pnlApiData[pnlApiData.length - 1]?.p || 0;
          // For now, treat the entire P&L as unrealized since we don't have a breakdown
          unrealizedPnl = latestPnl;
        }
      } catch {
        // Fallback to position-based calculation
        console.warn("Failed to parse P&L API response, using position data");
      }
    }

    // If P&L API didn't work, calculate from positions
    if (unrealizedPnl === 0 && realizedPnlFromPositions === 0) {
      unrealizedPnl = positions.reduce(
        (sum, p) => sum + Number.parseFloat(p.unrealizedPnl || "0"),
        0
      );

      realizedPnlFromPositions = positions.reduce(
        (sum, p) => sum + Number.parseFloat(p.realizedPnl || "0"),
        0
      );
    }

    // Calculate additional metrics from trades
    const buyTrades = trades.filter((t) => t.side === "BUY");
    const sellTrades = trades.filter((t) => t.side === "SELL");

    const totalBuyValue = buyTrades.reduce(
      (sum, t) => sum + Number.parseFloat(t.usdcSize || "0"),
      0
    );

    const totalSellValue = sellTrades.reduce(
      (sum, t) => sum + Number.parseFloat(t.usdcSize || "0"),
      0
    );

    // Calculate current portfolio value
    const currentPortfolioValue = positions.reduce(
      (sum, p) => sum + Number.parseFloat(p.curValue || "0"),
      0
    );

    const initialInvestment = positions.reduce(
      (sum, p) => sum + Number.parseFloat(p.initialValue || "0"),
      0
    );

    // Calculate win rate (positions with positive P&L)
    const positionsWithPnl = positions.filter(
      (p) => Number.parseFloat(p.unrealizedPnl || "0") !== 0
    );
    const winningPositions = positionsWithPnl.filter(
      (p) => Number.parseFloat(p.unrealizedPnl || "0") > 0
    );
    const winRate =
      positionsWithPnl.length > 0
        ? (winningPositions.length / positionsWithPnl.length) * 100
        : 0;

    // Calculate daily P&L history if requested
    let dailyHistory: Record<
      string,
      { realized: number; trades: number; volume: number }
    > = {};

    if (includeHistory) {
      dailyHistory = trades.reduce(
        (acc, trade) => {
          const date = new Date(trade.timestamp).toISOString().split("T")[0];
          if (!acc[date]) {
            acc[date] = { realized: 0, trades: 0, volume: 0 };
          }

          // Approximate realized P&L from trades
          // This is simplified - actual P&L requires matching buys/sells
          const tradeValue = Number.parseFloat(trade.usdcSize || "0");
          acc[date].trades++;
          acc[date].volume += tradeValue;

          return acc;
        },
        {} as Record<
          string,
          { realized: number; trades: number; volume: number }
        >
      );
    }

    // Calculate ROI
    const totalPnl = unrealizedPnl + realizedPnlFromPositions;
    const roi =
      initialInvestment > 0 ? (totalPnl / initialInvestment) * 100 : 0;

    // Best and worst performing positions
    const sortedByPnl = [...positions].sort(
      (a, b) =>
        Number.parseFloat(b.unrealizedPnl || "0") -
        Number.parseFloat(a.unrealizedPnl || "0")
    );

    const bestPerformer = sortedByPnl[0];
    const worstPerformer = sortedByPnl[sortedByPnl.length - 1];

    return NextResponse.json({
      success: true,
      user,
      period,
      pnl: {
        realized: realizedPnlFromPositions,
        unrealized: unrealizedPnl,
        total: totalPnl,
        roi,
      },
      portfolio: {
        currentValue: currentPortfolioValue,
        initialInvestment,
        positionCount: positions.length,
      },
      trading: {
        totalBuyValue,
        totalSellValue,
        netFlow: totalBuyValue - totalSellValue,
        tradeCount: trades.length,
        uniqueMarkets: new Set(trades.map((t) => t.conditionId)).size,
      },
      performance: {
        winRate,
        winningPositions: winningPositions.length,
        losingPositions: positionsWithPnl.length - winningPositions.length,
        bestPerformer: bestPerformer
          ? {
              title: bestPerformer.title,
              slug: bestPerformer.slug,
              outcome: bestPerformer.outcome,
              pnl: Number.parseFloat(bestPerformer.unrealizedPnl || "0"),
              pnlPercent:
                Number.parseFloat(bestPerformer.initialValue || "0") > 0
                  ? (Number.parseFloat(bestPerformer.unrealizedPnl || "0") /
                      Number.parseFloat(bestPerformer.initialValue || "0")) *
                    100
                  : 0,
            }
          : null,
        worstPerformer: worstPerformer
          ? {
              title: worstPerformer.title,
              slug: worstPerformer.slug,
              outcome: worstPerformer.outcome,
              pnl: Number.parseFloat(worstPerformer.unrealizedPnl || "0"),
              pnlPercent:
                Number.parseFloat(worstPerformer.initialValue || "0") > 0
                  ? (Number.parseFloat(worstPerformer.unrealizedPnl || "0") /
                      Number.parseFloat(worstPerformer.initialValue || "0")) *
                    100
                  : 0,
            }
          : null,
      },
      history: includeHistory ? dailyHistory : undefined,
      // Include P&L chart data from Polymarket's P&L API
      pnlHistory: pnlApiData,
    });
  } catch (error) {
    console.error("Error calculating P&L:", error);
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
