import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_MESSAGES } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { isValidAddress } from "@/lib/validation";

/**
 * Polymarket Gamma API for public profiles
 */
const GAMMA_API = "https://gamma-api.polymarket.com";

/**
 * Public profile data structure from Polymarket
 */
interface PublicProfile {
  createdAt: string;
  proxyWallet: string;
  displayUsernamePublic: boolean;
  pseudonym: string;
  name: string;
  bio?: string;
  profileImage?: string;
  bannerImage?: string;
  website?: string;
  twitter?: string;
  users: Array<{
    id: string;
    creator: boolean;
    mod: boolean;
  }>;
  verifiedBadge: boolean;
}

/**
 * Validation schema for query parameters
 */
const querySchema = z.object({
  address: z
    .string()
    .min(1, "Wallet address is required")
    .refine(isValidAddress, { message: "Invalid Ethereum address format" }),
});

/**
 * GET /api/user/public-profile
 *
 * Fetch public profile from Polymarket's Gamma API
 *
 * Query Parameters:
 * - address: User's wallet address (proxy or main) (required)
 *
 * Response:
 * - success: boolean
 * - profile: PublicProfile object or null if not found
 */
export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse and validate query parameters
    const parsed = querySchema.safeParse({
      address: searchParams.get("address"),
    });

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

    const { address } = parsed.data;

    // Fetch profile from Polymarket
    const response = await fetch(
      `${GAMMA_API}/public-profile?address=${encodeURIComponent(address)}`,
      {
        headers: {
          Accept: "application/json",
        },
        next: { revalidate: 300 }, // Cache for 5 minutes
      }
    );

    // Handle 404 - profile not found
    if (response.status === 404) {
      return NextResponse.json({
        success: true,
        profile: null,
        message: "Profile not found",
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Polymarket Profile API error:", errorText);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch profile from Polymarket",
          details: response.status,
        },
        { status: response.status }
      );
    }

    const profile: PublicProfile = await response.json();

    return NextResponse.json({
      success: true,
      profile,
    });
  } catch (error) {
    console.error("Error fetching public profile:", error);
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
