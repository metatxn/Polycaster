import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_MESSAGES } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { isValidAddress } from "@/lib/validation";

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
export async function POST(request: NextRequest) {
  // Rate limit: 30 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 30,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const parsed = userAddressSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: parsed.error.message,
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
    console.error("Error validating wallet:", error);
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
