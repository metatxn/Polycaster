import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { fetchTrades } from "@/lib/polymarket";

const log = createLogger("api.markets.trades");

/**
 * GET /api/markets/trades/:tokenID
 * Get recent trades for a token
 *
 * This is a read-only operation that calls the CLOB API directly
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tokenID: string }> }
) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(_request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { tokenID } = await params;

    // Fetch trades directly from CLOB API
    const trades = await fetchTrades(tokenID);

    return NextResponse.json({
      success: true,
      tokenID,
      trades,
    });
  } catch (error) {
    log.error("fetch.failed", { error });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
