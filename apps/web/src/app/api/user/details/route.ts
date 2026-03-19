import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_MESSAGES } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { isValidAddress } from "@/lib/validation";

/**
 * Polymarket Data API base URL
 */
const DATA_API_BASE = "https://data-api.polymarket.com";

/**
 * User details from Polymarket leaderboard API
 * Based on: /v1/leaderboard?timePeriod=day&orderBy=PNL&limit=1&offset=0&user={address}&category=overall
 */
interface PolymarketUserDetails {
  rank: string;
  proxyWallet: string;
  userName: string;
  xUsername: string;
  verifiedBadge: boolean;
  vol: number;
  pnl: number;
  profileImage: string;
}

/**
 * Helper to convert null/empty to undefined for optional fields
 */
const optionalString = z
  .string()
  .optional()
  .nullable()
  .transform((val) => (val === null || val === "" ? undefined : val));

/**
 * Validation schema for query parameters
 */
const querySchema = z.object({
  user: z.string().min(1, "User address is required").refine(isValidAddress, {
    message: "Invalid Ethereum address format",
  }),
  timePeriod: optionalString.pipe(
    z.enum(["day", "week", "month", "all"]).optional().default("day")
  ),
  category: optionalString.pipe(
    z
      .enum(["overall", "crypto", "sports", "politics"])
      .optional()
      .default("overall")
  ),
});

/**
 * GET /api/user/details
 *
 * Fetch user details from Polymarket leaderboard API
 * Uses: /v1/leaderboard?timePeriod=day&orderBy=PNL&limit=1&offset=0&user={address}&category=overall
 *
 * Query Parameters:
 * - user: User's wallet address (required)
 * - timePeriod: Time period for stats (day, week, month, all) (default: day)
 * - category: Category filter (overall, crypto, sports, politics) (default: overall)
 *
 * Response:
 * - User profile info, rank, volume, and P&L
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
      user: searchParams.get("user"),
      timePeriod: searchParams.get("timePeriod"),
      category: searchParams.get("category"),
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

    const { user, timePeriod, category } = parsed.data;

    // Build query URL using exact Polymarket format
    const queryParams = new URLSearchParams({
      timePeriod: timePeriod,
      orderBy: "PNL",
      limit: "1",
      offset: "0",
      user: user.toLowerCase(),
      category: category,
    });

    // Fetch user details from Polymarket leaderboard API
    const response = await fetch(
      `${DATA_API_BASE}/v1/leaderboard?${queryParams.toString()}`,
      {
        headers: {
          Accept: "application/json",
        },
        next: { revalidate: 60 }, // Cache for 1 minute
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Polymarket API error:", errorText);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch user details from Polymarket",
          details: response.status,
        },
        { status: response.status }
      );
    }

    const data: PolymarketUserDetails[] = await response.json();

    if (!data || data.length === 0) {
      return NextResponse.json({
        success: true,
        user,
        details: null,
        message: "User not found in leaderboard",
      });
    }

    const userDetails = data[0];

    return NextResponse.json({
      success: true,
      user,
      timePeriod,
      category,
      details: {
        rank: parseInt(userDetails.rank, 10),
        proxyWallet: userDetails.proxyWallet,
        userName: userDetails.userName,
        xUsername: userDetails.xUsername || null,
        verifiedBadge: userDetails.verifiedBadge,
        volume: userDetails.vol,
        pnl: userDetails.pnl,
        profileImage: userDetails.profileImage || null,
      },
    });
  } catch (error) {
    console.error("Error fetching user details:", error);
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
