import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_MESSAGES } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { readJsonBodyWithLimit } from "@/lib/api-request-body";
import { isValidAddress } from "@/lib/validation";

const log = createLogger("api.wallet.validate");
const MAX_REQUEST_BODY_BYTES = 8 * 1024;

// Validation schema
const userAddressSchema = z.object({
  userAddress: z
    .string()
    .min(1, "User address is required")
    .refine(isValidAddress, {
      message: "Invalid Ethereum address format",
    }),
});

/**
 * POST /api/wallet/validate
 * Validate a user's wallet address and check if proxy wallet is deployed
 * This is useful for the frontend to check user setup status
 */
/**
 * @openapi
 * /api/wallet/validate:
 *   post:
 *     summary: Create or proxy /api/wallet/validate.
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
export async function POST(request: NextRequest) {
  // Rate limit: 30 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 30,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const jsonBody = await readJsonBodyWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    );
    if (!jsonBody.ok) {
      return NextResponse.json(
        {
          success: false,
          error: jsonBody.error,
        },
        { status: jsonBody.status }
      );
    }

    const parsed = userAddressSchema.safeParse(jsonBody.body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
        },
        { status: 400 }
      );
    }

    const { userAddress } = parsed.data;

    // Address format already validated by Zod schema with isValidAddress refine.
    return NextResponse.json({
      success: true,
      userAddress,
      isValid: true,
      message: "Valid Ethereum address",
    });
  } catch (error) {
    log.error("validate.failed", { error });
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : ERROR_MESSAGES.UNKNOWN_ERROR,
      },
      { status: 500 }
    );
  }
}
