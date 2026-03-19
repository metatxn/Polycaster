import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";

/**
 * Whale Activity API Route v2
 *
 * Improvements over v1:
 * - Combines leaderboard whales + global /trades scan for large non-whale flows
 * - Deduplicates activities by transaction hash
 * - Returns data freshness metadata for the UI
 */

export interface WhaleActivity {
  id: string;
  timestamp: string;
  trader: {
    address: string;
    name: string | null;
    profileImage: string | null;
    rank: number;
    totalPnl: number;
    totalVolume: number;
  };
  trade: {
    side: "BUY" | "SELL";
    size: number;
    price: number;
    usdcAmount: number;
    outcome: string;
    outcomeIndex: number;
  };
  market: {
    conditionId: string;
    title: string;
    slug: string;
    eventSlug: string;
    image?: string;
    tokenId?: string;
  };
  source: "leaderboard" | "global_scan";
}

export interface WhaleActivityResponse {
  success: boolean;
  activities: WhaleActivity[];
  whaleCount: number;
  totalTrades: number;
  lastUpdated: string;
  dataAge: number;
  error?: string;
}

interface LeaderboardTrader {
  rank: string;
  proxyWallet: string;
  userName: string | null;
  vol: number;
  pnl: number;
  profileImage: string | null;
}

interface TradeActivity {
  id?: string;
  timestamp: number;
  type: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  usdcSize: number;
  outcomeIndex: number;
  outcome: string;
  transactionHash?: string;
  conditionId?: string;
  title?: string;
  slug?: string;
  eventSlug?: string;
  icon?: string;
  asset?: string;
}

interface GlobalTradeData {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  icon?: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  name: string | null;
  pseudonym: string | null;
  profileImage: string | null;
  transactionHash: string;
}

async function fetchTopTraders(
  limit = 20,
  timePeriod: "DAY" | "WEEK" | "MONTH" | "ALL" = "WEEK"
): Promise<LeaderboardTrader[]> {
  try {
    const response = await fetch(
      `${POLYMARKET_API.DATA.BASE}/v1/leaderboard?category=OVERALL&timePeriod=${timePeriod}&orderBy=VOL&limit=${limit}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 300 },
      }
    );
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

async function fetchTraderActivity(
  address: string,
  limit = 50
): Promise<TradeActivity[]> {
  try {
    const response = await fetch(
      `${POLYMARKET_API.DATA.BASE}/activity?user=${address.toLowerCase()}&limit=${Math.min(limit, 100)}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      }
    );
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

async function fetchGlobalLargeTrades(limit = 200): Promise<GlobalTradeData[]> {
  try {
    const response = await fetch(
      `${POLYMARKET_API.DATA.BASE}/trades?limit=${limit}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      }
    );
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 15,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const fetchStartTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);

    const whaleCount = Math.min(
      Math.max(Number.parseInt(searchParams.get("whaleCount") || "25", 10), 5),
      100
    );
    const parsedMinTradeSize = Number.parseFloat(
      searchParams.get("minTradeSize") || "100"
    );
    const minTradeSize =
      Number.isNaN(parsedMinTradeSize) || parsedMinTradeSize < 0
        ? 100
        : parsedMinTradeSize;
    const tradesPerWhale = Math.min(
      Math.max(
        Number.parseInt(searchParams.get("tradesPerWhale") || "50", 10),
        1
      ),
      100
    );

    const timePeriodParam = searchParams.get("timePeriod") || "WEEK";
    const validTimePeriods = ["DAY", "WEEK", "MONTH", "ALL"] as const;
    const timePeriod = validTimePeriods.includes(
      timePeriodParam as (typeof validTimePeriods)[number]
    )
      ? (timePeriodParam as "DAY" | "WEEK" | "MONTH" | "ALL")
      : "WEEK";

    // Step 1: Fetch leaderboard whales + global large trades in parallel
    const tradesMultiplier: Record<string, number> = {
      DAY: 1,
      WEEK: 1,
      MONTH: 2,
      ALL: 2,
    };
    const adjustedTradesPerWhale = Math.min(
      tradesPerWhale * (tradesMultiplier[timePeriod] || 1),
      100
    );

    const [topTraders, globalTrades] = await Promise.all([
      fetchTopTraders(whaleCount, timePeriod),
      fetchGlobalLargeTrades(200),
    ]);

    const seenTxHashes = new Set<string>();
    const allActivities: WhaleActivity[] = [];
    const leaderboardWallets = new Set(
      topTraders.map((t) => t.proxyWallet.toLowerCase())
    );

    // Step 2: Fetch activity for each leaderboard whale (batched to avoid overwhelming the API)
    const BATCH_SIZE = 10;
    if (topTraders.length > 0) {
      const results: {
        trader: LeaderboardTrader;
        activities: TradeActivity[];
      }[] = [];

      for (let i = 0; i < topTraders.length; i += BATCH_SIZE) {
        const batch = topTraders.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (trader) => {
            const activities = await fetchTraderActivity(
              trader.proxyWallet,
              adjustedTradesPerWhale
            );
            return { trader, activities };
          })
        );
        results.push(...batchResults);
      }

      for (const { trader, activities } of results) {
        for (const activity of activities) {
          if (activity.type !== "TRADE") continue;

          const usdcAmount = activity.usdcSize || 0;
          if (usdcAmount < minTradeSize) continue;

          const txHash =
            activity.transactionHash ||
            `${trader.proxyWallet}-${activity.timestamp}-${activity.outcomeIndex}-${activity.size}`;

          if (seenTxHashes.has(txHash)) continue;
          seenTxHashes.add(txHash);

          const timestampISO = new Date(
            activity.timestamp * 1000
          ).toISOString();

          allActivities.push({
            id: txHash,
            timestamp: timestampISO,
            trader: {
              address: trader.proxyWallet,
              name: trader.userName,
              profileImage: trader.profileImage,
              rank: Number.parseInt(trader.rank, 10) || 0,
              totalPnl: trader.pnl,
              totalVolume: trader.vol,
            },
            trade: {
              side: activity.side,
              size: activity.size || 0,
              price: activity.price || 0,
              usdcAmount,
              outcome: activity.outcome,
              outcomeIndex: activity.outcomeIndex,
            },
            market: {
              conditionId: activity.conditionId || "",
              title: activity.title || "Unknown Market",
              slug: activity.slug || "",
              tokenId: activity.asset || "",
              eventSlug: activity.eventSlug || "",
              image: activity.icon,
            },
            source: "leaderboard",
          });
        }
      }
    }

    // Step 3: Add large trades from global scan (non-leaderboard wallets)
    const globalMinTradeSize = Math.max(minTradeSize, 500);
    for (const trade of globalTrades) {
      if (leaderboardWallets.has(trade.proxyWallet.toLowerCase())) continue;

      const usdValue = trade.size * trade.price;
      if (usdValue < globalMinTradeSize) continue;

      const txHash =
        trade.transactionHash ||
        `global-${trade.proxyWallet}-${trade.timestamp}`;
      if (seenTxHashes.has(txHash)) continue;
      seenTxHashes.add(txHash);

      allActivities.push({
        id: txHash,
        timestamp: new Date(trade.timestamp * 1000).toISOString(),
        trader: {
          address: trade.proxyWallet,
          name: trade.name || trade.pseudonym || null,
          profileImage: trade.profileImage,
          rank: 0,
          totalPnl: 0,
          totalVolume: 0,
        },
        trade: {
          side: trade.side,
          size: trade.size,
          price: trade.price,
          usdcAmount: usdValue,
          outcome: trade.outcome,
          outcomeIndex: trade.outcomeIndex,
        },
        market: {
          conditionId: trade.conditionId,
          title: trade.title || "Unknown Market",
          slug: trade.slug || "",
          eventSlug: trade.eventSlug || "",
          image: trade.icon,
          tokenId: trade.asset || "",
        },
        source: "global_scan",
      });
    }

    // Step 4: Filter by time period
    const now = Date.now();
    const timePeriodMs: Record<string, number> = {
      DAY: 24 * 60 * 60 * 1000,
      WEEK: 7 * 24 * 60 * 60 * 1000,
      MONTH: 30 * 24 * 60 * 60 * 1000,
      ALL: Infinity,
    };
    const cutoffMs = timePeriodMs[timePeriod] || timePeriodMs.WEEK;
    const cutoffTime = cutoffMs === Infinity ? 0 : now - cutoffMs;

    const filteredByTime = allActivities.filter((activity) => {
      return new Date(activity.timestamp).getTime() >= cutoffTime;
    });

    filteredByTime.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const resultLimit: Record<string, number> = {
      DAY: 500,
      WEEK: 500,
      MONTH: 1500,
      ALL: 2000,
    };
    const maxResults = resultLimit[timePeriod] || 500;
    const limitedActivities = filteredByTime.slice(0, maxResults);

    const dataAge = now - fetchStartTime;

    return NextResponse.json({
      success: true,
      activities: limitedActivities,
      whaleCount: topTraders.length,
      totalTrades: limitedActivities.length,
      lastUpdated: new Date().toISOString(),
      dataAge,
    } satisfies WhaleActivityResponse);
  } catch (error) {
    console.error("Whale activity API error:", error);
    return NextResponse.json(
      {
        success: false,
        activities: [],
        whaleCount: 0,
        totalTrades: 0,
        lastUpdated: new Date().toISOString(),
        dataAge: Date.now() - fetchStartTime,
        error: error instanceof Error ? error.message : "Unknown error",
      } satisfies WhaleActivityResponse,
      { status: 500 }
    );
  }
}
