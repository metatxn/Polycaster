import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { fetchOrderBook } from "@/lib/polymarket";

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
    console.error("Error fetching order book:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
