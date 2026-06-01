import { createLogger } from "@knoww/logger";
import { ClobRequestError } from "@knoww/shared-types/clob";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { fetchPrice } from "@/lib/polymarket";

const log = createLogger("api.markets.price");

// Validation schema
const priceSchema = z.object({
  tokenID: z.string().describe("Token ID for the market outcome"),
  side: z.enum(["BUY", "SELL"]).optional().describe("Side to get price for"),
});

/**
 * GET /api/markets/price
 * Get current price for a token
 *
 * This is a read-only operation that calls the CLOB API directly
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limit: 120 requests per minute
    const rateLimitResponse = checkRateLimit(request, {
      uniqueTokenPerInterval: 120,
    });
    if (rateLimitResponse) return rateLimitResponse;

    const searchParams = request.nextUrl.searchParams;
    const tokenID = searchParams.get("tokenID");
    const side = searchParams.get("side");

    const parsed = priceSchema.safeParse({ tokenID, side });

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

    // Fetch price directly from CLOB API
    const price = await fetchPrice(parsed.data.tokenID);

    // Price data is realtime - short cache
    return NextResponse.json(
      {
        success: true,
        tokenID: parsed.data.tokenID,
        side: parsed.data.side || "midpoint",
        price,
      },
      { headers: getCacheHeaders("realtime") }
    );
  } catch (error) {
    log.error("fetch.failed", { error });
    // Never reflect the upstream/exception message to the client (CWE-209).
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load the price right now.",
      },
      {
        status: error instanceof ClobRequestError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
