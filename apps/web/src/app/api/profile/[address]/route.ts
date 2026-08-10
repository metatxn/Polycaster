import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { jsonError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { isValidAddress } from "@/lib/validation";

const log = createLogger("api.profile");

/**
 * Profile API Route
 *
 * Fetches comprehensive trader profile data from multiple Polymarket APIs
 */

/** Fetch with a timeout (default 10s) to prevent hanging on slow upstream APIs */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { next?: { revalidate: number } } = {},
  timeoutMs = 10_000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface TraderProfile {
  // Basic Info
  proxyWallet: string;
  userName: string | null;
  profileImage: string | null;
  bio: string | null;
  xUsername: string | null;
  verifiedBadge: boolean;

  // Stats
  totalVolume: number;
  totalPnl: number;
  positionsCount: number;
  tradesCount: number;

  // Rankings
  rankings: {
    overall: { rank: string; pnl: number; vol: number } | null;
    day: { rank: string; pnl: number; vol: number } | null;
    week: { rank: string; pnl: number; vol: number } | null;
    month: { rank: string; pnl: number; vol: number } | null;
  };
}

interface PublicProfile {
  name?: string;
  pseudonym?: string;
  profileImage?: string;
  bio?: string;
  xUsername?: string;
  verifiedBadge?: boolean;
}

interface PnLData {
  pnl?: { total?: number };
  volume?: { total?: number };
}

interface UpstreamResult<T> {
  data: T;
  failed: boolean;
}

function upstreamSuccess<T>(data: T): UpstreamResult<T> {
  return { data, failed: false };
}

function upstreamFailure<T>(fallback: T): UpstreamResult<T> {
  return { data: fallback, failed: true };
}

async function fetchPublicProfile(
  address: string
): Promise<UpstreamResult<PublicProfile | null>> {
  try {
    const response = await fetchWithTimeout(
      `${POLYMARKET_API.DATA.BASE}/profile/${address}`,
      { next: { revalidate: 300 } } // Cache for 5 minutes
    );
    if (!response.ok) return upstreamFailure(null);
    return upstreamSuccess((await response.json()) as PublicProfile);
  } catch {
    return upstreamFailure(null);
  }
}

async function fetchUserPnL(
  address: string
): Promise<UpstreamResult<PnLData | null>> {
  try {
    const response = await fetchWithTimeout(
      `https://user-pnl-api.polymarket.com/pnl/${address}`,
      { next: { revalidate: 60 } }
    );
    if (!response.ok) return upstreamFailure(null);
    return upstreamSuccess((await response.json()) as PnLData);
  } catch {
    return upstreamFailure(null);
  }
}

interface LeaderboardEntry {
  rank: string;
  pnl: number;
  vol: number;
}

async function fetchLeaderboardRank(
  address: string,
  timePeriod: string
): Promise<UpstreamResult<LeaderboardEntry | null>> {
  try {
    const response = await fetchWithTimeout(
      `${POLYMARKET_API.DATA.BASE}/v1/leaderboard?user=${address}&timePeriod=${timePeriod}`,
      { next: { revalidate: 60 } }
    );
    if (!response.ok) return upstreamFailure(null);
    const data = (await response.json()) as LeaderboardEntry[];
    if (Array.isArray(data) && data.length > 0) {
      return upstreamSuccess({
        rank: data[0].rank,
        pnl: data[0].pnl,
        vol: data[0].vol,
      });
    }
    return upstreamSuccess(null);
  } catch {
    return upstreamFailure(null);
  }
}

async function fetchPositions(
  address: string
): Promise<UpstreamResult<unknown>> {
  try {
    const response = await fetchWithTimeout(
      `${POLYMARKET_API.DATA.BASE}/positions?user=${address}`,
      { next: { revalidate: 60 } }
    );
    if (!response.ok) return upstreamFailure([]);
    return upstreamSuccess(await response.json());
  } catch {
    return upstreamFailure([]);
  }
}

async function fetchTrades(address: string): Promise<UpstreamResult<unknown>> {
  try {
    const response = await fetchWithTimeout(
      `${POLYMARKET_API.DATA.BASE}/trades?user=${address}&limit=100`,
      { next: { revalidate: 60 } }
    );
    if (!response.ok) return upstreamFailure([]);
    return upstreamSuccess(await response.json());
  } catch {
    return upstreamFailure([]);
  }
}

/**
 * @openapi
 * /api/profile/{address}:
 *   get:
 *     summary: Fetch /api/profile/{address}.
 *     tags: [Profile]
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
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(_request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { address } = await params;

    if (!address || !isValidAddress(address)) {
      return jsonError("Invalid Ethereum address format", 400);
    }

    // Fetch all data in parallel
    const [
      publicProfileResult,
      pnlDataResult,
      positionsResult,
      tradesResult,
      rankAllResult,
      rankDayResult,
      rankWeekResult,
      rankMonthResult,
    ] = await Promise.all([
      fetchPublicProfile(address),
      fetchUserPnL(address),
      fetchPositions(address),
      fetchTrades(address),
      fetchLeaderboardRank(address, "ALL"),
      fetchLeaderboardRank(address, "DAY"),
      fetchLeaderboardRank(address, "WEEK"),
      fetchLeaderboardRank(address, "MONTH"),
    ]);

    const upstreamFailed = [
      publicProfileResult,
      pnlDataResult,
      positionsResult,
      tradesResult,
      rankAllResult,
      rankDayResult,
      rankWeekResult,
      rankMonthResult,
    ].some((result) => result.failed);
    const publicProfile = publicProfileResult.data;
    const pnlData = pnlDataResult.data;
    const positions = positionsResult.data;
    const trades = tradesResult.data;
    const rankAll = rankAllResult.data;
    const rankDay = rankDayResult.data;
    const rankWeek = rankWeekResult.data;
    const rankMonth = rankMonthResult.data;

    // Calculate total volume from P&L data or rankings
    const totalVolume = rankAll?.vol || pnlData?.volume?.total || 0;
    const totalPnl = pnlData?.pnl?.total || rankAll?.pnl || 0;

    const profile: TraderProfile = {
      proxyWallet: address,
      userName: publicProfile?.name || publicProfile?.pseudonym || null,
      profileImage: publicProfile?.profileImage || null,
      bio: publicProfile?.bio || null,
      xUsername: publicProfile?.xUsername || null,
      verifiedBadge: publicProfile?.verifiedBadge || false,

      totalVolume,
      totalPnl,
      positionsCount: Array.isArray(positions) ? positions.length : 0,
      tradesCount: Array.isArray(trades) ? trades.length : 0,

      rankings: {
        overall: rankAll,
        day: rankDay,
        week: rankWeek,
        month: rankMonth,
      },
    };

    return NextResponse.json(profile, {
      headers: upstreamFailed
        ? { "Cache-Control": "no-store" }
        : getCacheHeaders("leaderboard"),
    });
  } catch (error) {
    log.error("fetch.failed", { error });
    return jsonError("Failed to fetch profile", 500);
  }
}
