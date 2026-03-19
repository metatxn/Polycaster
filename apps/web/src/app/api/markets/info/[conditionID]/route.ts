import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { fetchMarket } from "@/lib/polymarket";

/**
 * GET /api/markets/info/:conditionID
 * Get market information by condition ID
 *
 * This is a read-only operation that calls the CLOB API directly
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ conditionID: string }> }
) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(_request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { conditionID } = await params;

    // Fetch market info directly from CLOB API
    const market = await fetchMarket(conditionID);

    return NextResponse.json({
      success: true,
      market,
    });
  } catch (error) {
    console.error("Error fetching market info:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
