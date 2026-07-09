import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";

/**
 * GET /api/wallet/positions
 *
 * This endpoint has been deprecated.
 * Position queries now happen on the frontend using the useClobClient hook
 * which uses the real user signer for authentication.
 *
 * Use the `getOpenOrders()` method from the useClobClient hook instead.
 */
/**
 * @openapi
 * /api/wallet/positions:
 *   get:
 *     summary: Fetch /api/wallet/positions.
 *     tags: [Wallet]
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
export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  return NextResponse.json(
    {
      success: false,
      error:
        "This endpoint has been deprecated. Use the frontend useClobClient hook's getOpenOrders() method instead.",
      hint: "Wallet operations require user wallet authentication which is now handled on the frontend.",
    },
    { status: 410 } // 410 Gone
  );
}
