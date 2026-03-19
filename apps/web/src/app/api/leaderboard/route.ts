import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";

/**
 * Leaderboard API Route
 *
 * Fetches trader leaderboard rankings from Polymarket Data API
 * Reference: https://docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings
 */

export interface LeaderboardTrader {
  rank: string;
  proxyWallet: string;
  userName: string | null;
  vol: number;
  pnl: number;
  profileImage: string | null;
  xUsername: string | null;
  verifiedBadge: boolean;
}

export interface LeaderboardResponse {
  traders: LeaderboardTrader[];
  category: string;
  timePeriod: string;
  orderBy: string;
  total: number;
}

// Valid categories for the leaderboard
const VALID_CATEGORIES = [
  "OVERALL",
  "POLITICS",
  "SPORTS",
  "CRYPTO",
  "CULTURE",
  "MENTIONS",
  "WEATHER",
  "ECONOMICS",
  "TECH",
  "FINANCE",
] as const;

// Valid time periods
const VALID_TIME_PERIODS = ["DAY", "WEEK", "MONTH", "ALL"] as const;

// Valid order by options
const VALID_ORDER_BY = ["PNL", "VOL"] as const;

export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);

    // Parse and validate query parameters
    const category = searchParams.get("category")?.toUpperCase() || "OVERALL";
    const timePeriod = searchParams.get("timePeriod")?.toUpperCase() || "DAY";
    const orderBy = searchParams.get("orderBy")?.toUpperCase() || "PNL";
    const limit = Math.min(
      Math.max(Number.parseInt(searchParams.get("limit") || "25", 10), 1),
      50
    );
    const offset = Math.max(
      Number.parseInt(searchParams.get("offset") || "0", 10),
      0
    );
    const user = searchParams.get("user") || undefined;
    const userName = searchParams.get("userName") || undefined;

    // Validate category
    if (
      !VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])
    ) {
      return NextResponse.json(
        {
          error: `Invalid category. Valid options: ${VALID_CATEGORIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate time period
    if (
      !VALID_TIME_PERIODS.includes(
        timePeriod as (typeof VALID_TIME_PERIODS)[number]
      )
    ) {
      return NextResponse.json(
        {
          error: `Invalid timePeriod. Valid options: ${VALID_TIME_PERIODS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate order by
    if (!VALID_ORDER_BY.includes(orderBy as (typeof VALID_ORDER_BY)[number])) {
      return NextResponse.json(
        {
          error: `Invalid orderBy. Valid options: ${VALID_ORDER_BY.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Build query string
    const queryParams = new URLSearchParams({
      category,
      timePeriod,
      orderBy,
      limit: limit.toString(),
      offset: offset.toString(),
    });

    if (user) {
      queryParams.set("user", user);
    }
    if (userName) {
      queryParams.set("userName", userName);
    }

    const url = `${POLYMARKET_API.DATA.BASE}/v1/leaderboard?${queryParams.toString()}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      next: {
        revalidate: 60, // Cache for 1 minute
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Polymarket leaderboard API error:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch leaderboard data" },
        { status: response.status }
      );
    }

    const traders: LeaderboardTrader[] = await response.json();

    const result: LeaderboardResponse = {
      traders,
      category,
      timePeriod,
      orderBy,
      total: traders.length,
    };

    // Cache leaderboard data at edge for 1 minute
    return NextResponse.json(result, {
      headers: getCacheHeaders("leaderboard"),
    });
  } catch (error) {
    console.error("Leaderboard API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
