import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_MESSAGES } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { sanitizeUpstreamBody } from "@/lib/upstream-error";
import { isValidAddress } from "@/lib/validation";

const log = createLogger("api.user.public-profile");

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
/**
 * @openapi
 * /api/user/public-profile:
 *   get:
 *     summary: Fetch /api/user/public-profile.
 *     tags: [User]
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
      return NextResponse.json(
        {
          success: true,
          profile: null,
          message: "Profile not found",
        },
        { headers: getCacheHeaders("leaderboard") }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      log.error("upstream.error", {
        status: response.status,
        body: sanitizeUpstreamBody(errorText),
      });
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

    return NextResponse.json(
      {
        success: true,
        profile,
      },
      { headers: getCacheHeaders("leaderboard") }
    );
  } catch (error) {
    log.error("fetch.failed", { error });
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
