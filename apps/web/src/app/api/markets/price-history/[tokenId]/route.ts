import { createLogger } from "@knoww/logger";
import { ClobRequestError } from "@knoww/shared-types/clob";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api-error";
import {
  clampedInt,
  firstIssueMessage,
  orAbsent,
  tokenIdSchema,
} from "@/lib/api-query";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { fetchCachedClobPriceHistory } from "@/lib/price-history-cache";
import { alignPriceHistoryStartTs } from "@/lib/price-history-time";

const log = createLogger("api.markets.price-history");

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
/**
 * @openapi
 * /api/markets/price-history/{tokenId}:
 *   get:
 *     summary: Fetch /api/markets/price-history/{tokenId}.
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
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const tokenIdResult = tokenIdSchema.safeParse((await params).tokenId);
    if (!tokenIdResult.success) {
      return jsonError(firstIssueMessage(tokenIdResult.error), 400);
    }
    const tokenId = tokenIdResult.data;

    const { searchParams } = new URL(request.url);
    // If no startTs provided, default to 30 days ago.
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const parsedQuery = z
      .object({
        fidelity: clampedInt(1, 1440, 60),
        startTs: clampedInt(0, 4102444800, thirtyDaysAgo),
      })
      .parse({
        fidelity: orAbsent(searchParams.get("fidelity")),
        startTs: orAbsent(searchParams.get("startTs")),
      });
    const fidelity = parsedQuery.fidelity;
    const startTs = searchParams.has("startTs")
      ? parsedQuery.startTs
      : alignPriceHistoryStartTs(parsedQuery.startTs, fidelity);

    // Fetch from Polymarket CLOB API
    const data = await fetchCachedClobPriceHistory(tokenId, {
      startTs,
      fidelity,
    });

    // Return with cache headers - price history can be cached longer
    return NextResponse.json(
      {
        success: true,
        history: data.history || [],
        tokenId,
        startTs,
        fidelity,
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
