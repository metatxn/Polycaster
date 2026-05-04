import { createLogger } from "@knoww/logger";
import {
  ClobRequestError,
  fetchClobPriceHistory,
} from "@knoww/shared-types/clob";
import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";

const log = createLogger("api.markets.price-history");

/**
 * Price history response from Polymarket CLOB API
 * @see https://docs.polymarket.com/api-reference/pricing/get-price-history-for-a-traded-token
 */
interface PriceHistoryPoint {
  t: number; // UTC timestamp (seconds)
  p: number; // Price (0-1)
}

interface PolymarketPriceHistoryResponse {
  history: PriceHistoryPoint[];
}

/**
 * GET /api/markets/price-history/[tokenId]
 *
 * Fetches historical price data for a specified market token from Polymarket CLOB API.
 *
 * Query Parameters:
 * - startTs: Start time as Unix timestamp in seconds (required)
 * - fidelity: Resolution of data in minutes (default: 60)
 *
 * Example: /api/markets/price-history/[tokenId]?startTs=1754353491&fidelity=720
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { tokenId } = await params;

    if (!tokenId) {
      return NextResponse.json(
        { success: false, error: "Token ID is required" },
        { status: 400 }
      );
    }

    // Validate token ID format (should be a long numeric string)
    if (tokenId.length < 10) {
      return NextResponse.json(
        { success: false, error: "Invalid token ID format" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const fidelity = searchParams.get("fidelity") || "60";
    let startTs = searchParams.get("startTs");

    // If no startTs provided, default to 30 days ago
    if (!startTs) {
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
      startTs = thirtyDaysAgo.toString();
    }

    // Fetch from Polymarket CLOB API
    const data = await fetchClobPriceHistory<PolymarketPriceHistoryResponse>(
      tokenId,
      { startTs, fidelity },
      {
        requestInit: {
          headers: { "Content-Type": "application/json" },
          next: { revalidate: 60 }, // Cache for 1 minute
        },
      }
    );

    // Return with cache headers - price history can be cached longer
    return NextResponse.json(
      {
        success: true,
        history: data.history || [],
        tokenId,
        startTs: Number(startTs),
        fidelity: Number(fidelity),
      },
      { headers: getCacheHeaders("priceHistory") }
    );
  } catch (error) {
    log.error("fetch.failed", { error });

    if (error instanceof ClobRequestError && error.status === 404) {
      return NextResponse.json(
        { success: false, error: "Token not found", history: [] },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch price history",
        history: [],
      },
      { status: error instanceof ClobRequestError ? error.status : 500 }
    );
  }
}
