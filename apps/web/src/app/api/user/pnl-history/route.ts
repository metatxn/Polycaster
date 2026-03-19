import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_MESSAGES } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { isValidAddress } from "@/lib/validation";

/**
 * Polymarket User P&L API
 */
const USER_PNL_API = "https://user-pnl-api.polymarket.com";

/**
 * P&L data point from Polymarket
 */
interface PnLDataPoint {
  t: number; // Unix timestamp
  p: number; // P&L value
}

/**
 * Validation schema for query parameters
 * Supported intervals by Polymarket API: 'max', 'all', '1m', '1w', '1d', '12h', '6h'
 */
const querySchema = z.object({
  user: z
    .string()
    .min(1, "User address is required")
    .refine(isValidAddress, { message: "Invalid Ethereum address format" }),
  interval: z
    .enum(["6h", "12h", "1d", "1w", "1m", "all", "max"])
    .optional()
    .nullable()
    .transform((val) => val ?? "1m"),
  fidelity: z
    .enum(["1h", "1d", "1w"])
    .optional()
    .nullable()
    .transform((val) => val ?? "1d"),
});

/**
 * GET /api/user/pnl-history
 *
 * Fetch P&L history for charting from Polymarket's User P&L API
 *
 * Query Parameters:
 * - user: User's wallet address (required)
 * - interval: Time range (6h, 12h, 1d, 1w, 1m, all, max) (default: 1m)
 * - fidelity: Data point granularity (1h, 1d, 1w) (default: 1d)
 *
 * Response:
 * - data: Array of { timestamp, pnl } objects
 * - summary: { startPnl, endPnl, change, changePercent, high, low }
 */
export async function GET(request: NextRequest) {
  // Rate limit: 30 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 30,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse and validate query parameters
    const parsed = querySchema.safeParse({
      user: searchParams.get("user"),
      interval: searchParams.get("interval"),
      fidelity: searchParams.get("fidelity"),
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

    const { user, interval, fidelity } = parsed.data;

    // Build query URL for Polymarket's User P&L API
    const queryParams = new URLSearchParams({
      user_address: user,
      interval: interval,
      fidelity: fidelity,
    });

    // Fetch P&L history from Polymarket
    const response = await fetch(
      `${USER_PNL_API}/user-pnl?${queryParams.toString()}`,
      {
        headers: {
          Accept: "application/json",
        },
        next: { revalidate: 60 }, // Cache for 1 minute
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Polymarket P&L API error:", errorText);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch P&L history from Polymarket",
          details: response.status,
        },
        { status: response.status }
      );
    }

    const rawData: PnLDataPoint[] = await response.json();

    // Handle empty data
    if (!rawData || rawData.length === 0) {
      return NextResponse.json({
        success: true,
        user,
        interval,
        fidelity,
        data: [],
        summary: {
          startPnl: 0,
          endPnl: 0,
          change: 0,
          changePercent: 0,
          high: 0,
          low: 0,
        },
      });
    }

    // Transform data for frontend
    const data = rawData.map((point) => ({
      timestamp: new Date(point.t * 1000).toISOString(),
      date: new Date(point.t * 1000).toLocaleDateString(),
      pnl: point.p,
    }));

    // Calculate summary statistics
    const pnlValues = rawData.map((p) => p.p);
    const startPnl = pnlValues[0] || 0;
    const endPnl = pnlValues[pnlValues.length - 1] || 0;
    const change = endPnl - startPnl;
    const changePercent =
      startPnl !== 0 ? (change / Math.abs(startPnl)) * 100 : 0;
    const high = Math.max(...pnlValues);
    const low = Math.min(...pnlValues);

    return NextResponse.json({
      success: true,
      user,
      interval,
      fidelity,
      data,
      summary: {
        startPnl,
        endPnl,
        change,
        changePercent,
        high,
        low,
        dataPoints: data.length,
      },
    });
  } catch (error) {
    console.error("Error fetching P&L history:", error);
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
