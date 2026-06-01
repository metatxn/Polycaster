import { createLogger } from "@knoww/logger";
import { ClobRequestError } from "@knoww/shared-types/clob";
import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { fetchMarket } from "@/lib/polymarket";

const log = createLogger("api.markets.info");

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
    log.error("fetch.failed", { error });
    // Never reflect the upstream/exception message to the client (CWE-209).
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load market info right now.",
      },
      {
        status: error instanceof ClobRequestError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
