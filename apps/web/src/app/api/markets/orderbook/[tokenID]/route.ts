import { createLogger } from "@knoww/logger";
import { ClobRequestError } from "@knoww/shared-types/clob";
import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { fetchOrderBook } from "@/lib/polymarket";

const log = createLogger("api.markets.orderbook");

/**
 * GET /api/markets/orderbook/:tokenID
 * Get order book for a token
 *
 * This is a read-only operation that calls the CLOB API directly
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tokenID: string }> }
) {
  // Rate limit: 120 requests per minute
  const rateLimitResponse = checkRateLimit(_request, {
    uniqueTokenPerInterval: 120,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { tokenID } = await params;

    // Fetch order book directly from CLOB API
    const orderBook = await fetchOrderBook(tokenID);

    // Order book is realtime data - short cache with stale-while-revalidate
    return NextResponse.json(
      {
        success: true,
        tokenID,
        orderBook,
      },
      { headers: getCacheHeaders("realtime") }
    );
  } catch (error) {
    log.error("fetch.failed", { error });
    // Never reflect the upstream/exception message to the client (CWE-209).
    // Map to the upstream status class when known; otherwise 500.
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load the order book right now.",
      },
      {
        status: error instanceof ClobRequestError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
