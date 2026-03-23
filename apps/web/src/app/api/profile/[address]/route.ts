import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { isValidAddress } from "@/lib/validation";

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

async function fetchPublicProfile(
  address: string
): Promise<PublicProfile | null> {
  try {
    const response = await fetchWithTimeout(
      `${POLYMARKET_API.DATA.BASE}/profile/${address}`,
      { next: { revalidate: 300 } } // Cache for 5 minutes
    );
    if (!response.ok) return null;
    return response.json() as Promise<PublicProfile>;
  } catch {
    return null;
  }
}

async function fetchUserPnL(address: string): Promise<PnLData | null> {
  try {
    const response = await fetchWithTimeout(
      `https://user-pnl-api.polymarket.com/pnl/${address}`,
      { next: { revalidate: 60 } }
    );
    if (!response.ok) return null;
    return response.json() as Promise<PnLData>;
  } catch {
    return null;
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
): Promise<{ rank: string; pnl: number; vol: number } | null> {
  try {
    const response = await fetchWithTimeout(
      `${POLYMARKET_API.DATA.BASE}/v1/leaderboard?user=${address}&timePeriod=${timePeriod}`,
      { next: { revalidate: 60 } }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as LeaderboardEntry[];
    if (Array.isArray(data) && data.length > 0) {
      return {
        rank: data[0].rank,
        pnl: data[0].pnl,
        vol: data[0].vol,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchPositions(address: string) {
  try {
    const response = await fetchWithTimeout(
      `${POLYMARKET_API.DATA.BASE}/positions?user=${address}`,
      { next: { revalidate: 60 } }
    );
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

async function fetchTrades(address: string) {
  try {
    const response = await fetchWithTimeout(
      `${POLYMARKET_API.DATA.BASE}/trades?user=${address}&limit=100`,
      { next: { revalidate: 60 } }
    );
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

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
      return NextResponse.json(
        { error: "Invalid Ethereum address format" },
        { status: 400 }
      );
    }

    // Fetch all data in parallel
    const [
      publicProfile,
      pnlData,
      positions,
      trades,
      rankAll,
      rankDay,
      rankWeek,
      rankMonth,
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

    return NextResponse.json(profile);
  } catch (error) {
    console.error("Profile API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}
