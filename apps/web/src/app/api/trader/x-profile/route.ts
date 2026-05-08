import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import {
  buildTraderXProfileIndex,
  normalizeXHandle,
  type TraderXProfile,
} from "@/lib/trader-x-profile";

const log = createLogger("api.trader.x_profile");

const INDEX_TTL_MS = 5 * 60 * 1000;
const LEADERBOARD_LIMIT = 50;
const LEADERBOARD_MAX_OFFSET = 1000;
const LEADERBOARD_ORDERS = ["PNL", "VOL"] as const;

let cachedIndex: {
  expiresAt: number;
  index: Map<string, TraderXProfile>;
} | null = null;
let indexInFlight: Promise<Map<string, TraderXProfile>> | null = null;

/**
 * @openapi
 * /api/trader/x-profile:
 *   get:
 *     summary: Resolve an X handle to public Polymarket trader PNL.
 *     description: Looks up a public X username in a short-lived cached index built from Polymarket leaderboard entries that include `xUsername`. The route is read-only, rate limited, and only returns public Polymarket profile fields.
 *     tags:
 *       - Trader
 *     parameters:
 *       - in: query
 *         name: handle
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[A-Za-z0-9_]{1,15}$"
 *         description: X username, with or without a leading @.
 *     responses:
 *       200:
 *         description: Matching public Polymarket trader profile.
 *       400:
 *         description: Missing or invalid X handle.
 *       404:
 *         description: No public Polymarket profile was found for the X handle.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Failed to resolve trader profile.
 */
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 120,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const handle = normalizeXHandle(request.nextUrl.searchParams.get("handle"));
    if (!handle) {
      return NextResponse.json(
        { success: false, error: "Invalid X handle" },
        { status: 400 }
      );
    }

    const index = await getTraderXProfileIndex();
    const profile = index.get(handle);
    if (!profile) {
      return NextResponse.json(
        { success: false, error: "Trader profile not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, profile },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch (error) {
    log.error("resolve.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to resolve trader profile" },
      { status: 500 }
    );
  }
}

async function getTraderXProfileIndex(): Promise<Map<string, TraderXProfile>> {
  const now = Date.now();
  if (cachedIndex && cachedIndex.expiresAt > now) {
    return cachedIndex.index;
  }

  if (!indexInFlight) {
    indexInFlight = refreshTraderXProfileIndex().finally(() => {
      indexInFlight = null;
    });
  }

  return indexInFlight;
}

async function refreshTraderXProfileIndex(): Promise<
  Map<string, TraderXProfile>
> {
  const traders: unknown[] = [];

  for (const orderBy of LEADERBOARD_ORDERS) {
    for (
      let offset = 0;
      offset <= LEADERBOARD_MAX_OFFSET;
      offset += LEADERBOARD_LIMIT
    ) {
      const page = await fetchLeaderboardPage(orderBy, offset);
      traders.push(...page);
      if (page.length < LEADERBOARD_LIMIT) break;
    }
  }

  const index = buildTraderXProfileIndex(traders);
  cachedIndex = {
    expiresAt: Date.now() + INDEX_TTL_MS,
    index,
  };
  return index;
}

async function fetchLeaderboardPage(
  orderBy: (typeof LEADERBOARD_ORDERS)[number],
  offset: number
): Promise<unknown[]> {
  const params = new URLSearchParams({
    category: "OVERALL",
    timePeriod: "ALL",
    orderBy,
    limit: String(LEADERBOARD_LIMIT),
    offset: String(offset),
  });

  const response = await fetch(
    `${POLYMARKET_API.DATA.BASE}/v1/leaderboard?${params.toString()}`,
    {
      headers: {
        Accept: "application/json",
      },
      next: {
        revalidate: 300,
      },
    }
  );

  if (!response.ok) {
    log.warn("leaderboard.fetch_failed", {
      orderBy,
      offset,
      status: response.status,
      statusText: response.statusText,
    });
    return [];
  }

  const payload: unknown = await response.json();
  return Array.isArray(payload) ? payload : [];
}
