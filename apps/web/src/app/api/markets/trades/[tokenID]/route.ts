import { createLogger } from "@knoww/logger";
import { ClobRequestError } from "@knoww/shared-types/clob";
import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { fetchTrades } from "@/lib/polymarket";

const log = createLogger("api.markets.trades");

/**
 * GET /api/markets/trades/:tokenID
 * Get recent trades for a token
 *
 * This is a read-only operation that calls the CLOB API directly
 */
/**
 * @openapi
 * /api/markets/trades/{tokenID}:
 *   get:
 *     summary: Fetch /api/markets/trades/{tokenID}.
 *     tags: [Markets]
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

    return NextResponse.json(
      {
        success: true,
        tokenID,
        trades,
      },
      { headers: getCacheHeaders("realtime") }
    );
  } catch (error) {
    log.error("fetch.failed", { error });
    // Never reflect the upstream/exception message to the client (CWE-209).
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load trades right now.",
      },
      {
        status: error instanceof ClobRequestError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
