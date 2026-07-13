import { createLogger } from "@knoww/logger";
import Decimal from "decimal.js";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_MESSAGES } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { isValidAddress } from "@/lib/validation";

const log = createLogger("api.user.pnl");

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
  timestamp: string | number;
  side: "BUY" | "SELL";
  size: string | number;
  price: string | number;
  usdcSize: string | number;
  conditionId: string;
  outcome: string;
  asset?: string;
  id?: string;
  transactionHash?: string;
  type?: string;
}

interface NormalizedTradeData extends TradeData {
  timestampMs: number | null;
}

interface ActivityResult {
  trades: NormalizedTradeData[];
  pagesFetched: number;
  truncated: boolean;
}

interface PositionsResult {
  positions: PositionData[];
  pagesFetched: number;
  truncated: boolean;
}

const ACTIVITY_PAGE_SIZE = 100;
const MAX_ACTIVITY_PAGES = 10;
const POSITIONS_PAGE_SIZE = 100;
const MAX_POSITIONS_PAGES = 10;

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

function toDecimal(value: string | number | null | undefined): Decimal {
  try {
    const decimal = new Decimal(value ?? 0);
    return decimal.isFinite() ? decimal : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

function toNumber(value: Decimal): number {
  return value.toNumber();
}

function isFiniteDecimalValue(value: unknown): value is string | number {
  if (typeof value !== "string" && typeof value !== "number") return false;
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}

function isTradeData(value: unknown): value is TradeData {
  if (!value || typeof value !== "object") return false;
  const trade = value as Partial<TradeData>;
  if (trade.type !== undefined && trade.type !== "TRADE") return false;
  return (
    (typeof trade.timestamp === "string" ||
      typeof trade.timestamp === "number") &&
    normalizeActivityTimestamp(trade.timestamp) !== null &&
    (trade.side === "BUY" || trade.side === "SELL") &&
    isFiniteDecimalValue(trade.size) &&
    isFiniteDecimalValue(trade.price) &&
    isFiniteDecimalValue(trade.usdcSize) &&
    typeof trade.conditionId === "string" &&
    trade.conditionId.trim().length > 0 &&
    typeof trade.outcome === "string"
  );
}

function normalizeActivityTimestamp(value: string | number): number | null {
  const numericValue =
    typeof value === "number"
      ? value
      : value.trim() === ""
        ? Number.NaN
        : Number(value);

  if (Number.isFinite(numericValue)) {
    const timestampMs =
      Math.abs(numericValue) < 1_000_000_000_000
        ? numericValue * 1000
        : numericValue;
    return Number.isFinite(timestampMs) ? timestampMs : null;
  }

  if (typeof value !== "string") return null;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function getActivityIdentity(
  trade: TradeData,
  timestampMs: number | null
): string {
  if (trade.id) return `id:${trade.id}`;

  return JSON.stringify([
    trade.transactionHash ?? "",
    trade.type ?? "",
    trade.asset ?? "",
    timestampMs ?? String(trade.timestamp),
    trade.conditionId,
    trade.side,
    trade.size,
    trade.price,
    trade.usdcSize,
    trade.outcome,
  ]);
}

function pageCrossesStartDate(
  timestamps: number[],
  startTimestampMs: number | null
): boolean {
  if (startTimestampMs === null || timestamps.length === 0) return false;

  const isNewestFirst = timestamps.every(
    (timestamp, index) => index === 0 || timestamps[index - 1] >= timestamp
  );
  return isNewestFirst && timestamps[timestamps.length - 1] < startTimestampMs;
}

async function fetchActivity(
  user: string,
  startDate: Date | null
): Promise<ActivityResult> {
  const startTimestampMs = startDate?.getTime() ?? null;
  const trades: NormalizedTradeData[] = [];
  const seen = new Set<string>();
  let pagesFetched = 0;

  for (let page = 0; page < MAX_ACTIVITY_PAGES; page++) {
    const offset = page * ACTIVITY_PAGE_SIZE;
    const response = await fetch(
      `${DATA_API_BASE}/activity?user=${user.toLowerCase()}&limit=${ACTIVITY_PAGE_SIZE}&offset=${offset}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      }
    );

    if (!response.ok) throw new Error("Failed to fetch trades");

    const pageData: unknown = await response.json();
    if (!Array.isArray(pageData)) throw new Error("Failed to fetch trades");
    pagesFetched++;

    const pageTimestamps: number[] = [];
    for (const rawTrade of pageData) {
      if (!isTradeData(rawTrade)) continue;
      const timestampMs = normalizeActivityTimestamp(rawTrade.timestamp);
      if (timestampMs !== null) pageTimestamps.push(timestampMs);

      if (
        startTimestampMs !== null &&
        (timestampMs === null || timestampMs < startTimestampMs)
      ) {
        continue;
      }

      const identity = getActivityIdentity(rawTrade, timestampMs);
      if (seen.has(identity)) continue;
      seen.add(identity);
      trades.push({ ...rawTrade, timestampMs });
    }

    if (
      pageData.length < ACTIVITY_PAGE_SIZE ||
      pageCrossesStartDate(pageTimestamps, startTimestampMs)
    ) {
      return { trades, pagesFetched, truncated: false };
    }
  }

  return { trades, pagesFetched, truncated: true };
}

async function fetchPositions(user: string): Promise<PositionsResult> {
  const positions: PositionData[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < MAX_POSITIONS_PAGES; page++) {
    const response = await fetch(
      `${DATA_API_BASE}/positions?user=${user.toLowerCase()}&sizeThreshold=.1&limit=${POSITIONS_PAGE_SIZE}&offset=${page * POSITIONS_PAGE_SIZE}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      }
    );
    if (!response.ok) throw new Error("Failed to fetch positions");

    const pageData: unknown = await response.json();
    if (!Array.isArray(pageData)) throw new Error("Failed to fetch positions");
    for (const position of pageData as PositionData[]) {
      const identity = `${position.slug ?? ""}:${position.outcome ?? ""}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      positions.push(position);
    }
    if (pageData.length < POSITIONS_PAGE_SIZE) {
      return { positions, pagesFetched: page + 1, truncated: false };
    }
  }

  return {
    positions,
    pagesFetched: MAX_POSITIONS_PAGES,
    truncated: true,
  };
}

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
/**
 * @openapi
 * /api/user/pnl:
 *   get:
 *     summary: Fetch /api/user/pnl.
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

    const positionsResult = await fetchPositions(user);
    const allPositions = positionsResult.positions;

    // Filter to show only OPEN positions
    // - redeemable: false = market is still open/active
    // - redeemable: true with curPrice > 0 = won bet, can redeem
    const positions = allPositions.filter((p) => {
      const isOpenPosition = !p.redeemable;
      const isWinningRedeemable = p.redeemable && p.curPrice > 0;
      return isOpenPosition || isWinningRedeemable;
    });

    const activity = await fetchActivity(user, startDate);
    const trades = activity.trades;

    // Try to get P&L from dedicated API, fallback to position-based calculation
    let unrealizedPnl = new Decimal(0);
    let realizedPnlFromPositions = new Decimal(0);
    let pnlApiData: { t: number; p: number }[] | null = null;

    if (pnlApiResponse.ok) {
      try {
        pnlApiData = await pnlApiResponse.json();
        // The P&L API returns an array of { t: timestamp, p: pnl_value }
        // The last value is the current P&L
        if (Array.isArray(pnlApiData) && pnlApiData.length > 0) {
          const latestPnl = toDecimal(pnlApiData[pnlApiData.length - 1]?.p);
          // For now, treat the entire P&L as unrealized since we don't have a breakdown
          unrealizedPnl = latestPnl;
        }
      } catch {
        // Fallback to position-based calculation
        log.warn("parse.fallback_to_positions");
      }
    }

    // If P&L API didn't work, calculate from positions
    if (unrealizedPnl.isZero() && realizedPnlFromPositions.isZero()) {
      unrealizedPnl = positions.reduce(
        (sum, p) => sum.add(toDecimal(p.unrealizedPnl)),
        new Decimal(0)
      );

      realizedPnlFromPositions = positions.reduce(
        (sum, p) => sum.add(toDecimal(p.realizedPnl)),
        new Decimal(0)
      );
    }

    // Calculate additional metrics from trades
    const buyTrades = trades.filter((t) => t.side === "BUY");
    const sellTrades = trades.filter((t) => t.side === "SELL");

    const totalBuyValue = buyTrades.reduce(
      (sum, t) => sum.add(toDecimal(t.usdcSize)),
      new Decimal(0)
    );

    const totalSellValue = sellTrades.reduce(
      (sum, t) => sum.add(toDecimal(t.usdcSize)),
      new Decimal(0)
    );

    // Calculate current portfolio value
    const currentPortfolioValue = positions.reduce(
      (sum, p) => sum.add(toDecimal(p.curValue)),
      new Decimal(0)
    );

    const initialInvestment = positions.reduce(
      (sum, p) => sum.add(toDecimal(p.initialValue)),
      new Decimal(0)
    );

    // Calculate win rate (positions with positive P&L)
    const positionsWithPnl = positions.filter(
      (p) => !toDecimal(p.unrealizedPnl).isZero()
    );
    const winningPositions = positionsWithPnl.filter((p) =>
      toDecimal(p.unrealizedPnl).gt(0)
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
          if (trade.timestampMs === null) return acc;
          const date = new Date(trade.timestampMs).toISOString().split("T")[0];
          if (!acc[date]) {
            acc[date] = { realized: 0, trades: 0, volume: 0 };
          }

          // Approximate realized P&L from trades
          // This is simplified - actual P&L requires matching buys/sells
          const tradeValue = toDecimal(trade.usdcSize);
          acc[date].trades++;
          acc[date].volume = toNumber(
            toDecimal(acc[date].volume).add(tradeValue)
          );

          return acc;
        },
        {} as Record<
          string,
          { realized: number; trades: number; volume: number }
        >
      );
    }

    // Calculate ROI
    const totalPnl = unrealizedPnl.add(realizedPnlFromPositions);
    const roi = initialInvestment.gt(0)
      ? toNumber(totalPnl.div(initialInvestment).mul(100))
      : 0;

    // Best and worst performing positions
    const sortedByPnl = [...positions].sort((a, b) =>
      toDecimal(b.unrealizedPnl).cmp(toDecimal(a.unrealizedPnl))
    );

    const bestPerformer = sortedByPnl[0];
    const worstPerformer = sortedByPnl[sortedByPnl.length - 1];

    return NextResponse.json({
      success: true,
      user,
      period,
      pnl: {
        realized: toNumber(realizedPnlFromPositions),
        unrealized: toNumber(unrealizedPnl),
        total: toNumber(totalPnl),
        roi,
      },
      portfolio: {
        currentValue: toNumber(currentPortfolioValue),
        initialInvestment: toNumber(initialInvestment),
        positionCount: positions.length,
        positionsComplete: !positionsResult.truncated,
        positionsPagesFetched: positionsResult.pagesFetched,
        positionsTruncated: positionsResult.truncated,
      },
      trading: {
        totalBuyValue: toNumber(totalBuyValue),
        totalSellValue: toNumber(totalSellValue),
        netFlow: toNumber(totalBuyValue.sub(totalSellValue)),
        tradeCount: trades.length,
        uniqueMarkets: new Set(trades.map((t) => t.conditionId)).size,
        activityComplete: !activity.truncated,
        activityPagesFetched: activity.pagesFetched,
        activityTruncated: activity.truncated,
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
              pnl: toNumber(toDecimal(bestPerformer.unrealizedPnl)),
              pnlPercent: toDecimal(bestPerformer.initialValue).gt(0)
                ? toNumber(
                    toDecimal(bestPerformer.unrealizedPnl)
                      .div(toDecimal(bestPerformer.initialValue))
                      .mul(100)
                  )
                : 0,
            }
          : null,
        worstPerformer: worstPerformer
          ? {
              title: worstPerformer.title,
              slug: worstPerformer.slug,
              outcome: worstPerformer.outcome,
              pnl: toNumber(toDecimal(worstPerformer.unrealizedPnl)),
              pnlPercent: toDecimal(worstPerformer.initialValue).gt(0)
                ? toNumber(
                    toDecimal(worstPerformer.unrealizedPnl)
                      .div(toDecimal(worstPerformer.initialValue))
                      .mul(100)
                  )
                : 0,
            }
          : null,
      },
      history: includeHistory ? dailyHistory : undefined,
      // Include P&L chart data from Polymarket's P&L API
      pnlHistory: pnlApiData,
    });
  } catch (error) {
    log.error("calculate.failed", { error });
    return NextResponse.json(
      {
        success: false,
        error: ERROR_MESSAGES.UNKNOWN_ERROR,
      },
      { status: 500 }
    );
  }
}
