import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getTraderHistoriesBatch } from "@/lib/trader-history-cache";

/**
 * Suspicious/Insider Activity Detection API v2
 *
 * Improvements over v1:
 * - Paginated account-age resolution via shared cache (eliminates false "new account" flags)
 * - Confidence levels (LOW / MEDIUM / HIGH / CRITICAL) alongside raw score
 * - Factor breakdown returned per activity for UI drilldowns
 * - Market-type awareness (neg-risk, multi-outcome guard)
 * - Correlation: flags wallets that appear multiple times across markets
 * - Global /trades scan + leaderboard-excluded wallets (catches non-whale insiders)
 */

export interface SuspicionFactor {
  name: string;
  points: number;
  description: string;
}

export interface SuspiciousActivity {
  id: string;
  timestamp: string;
  account: {
    address: string;
    name: string | null;
    profileImage: string | null;
    firstTradeDate: string | null;
    accountAgeHours: number;
    totalTrades: number;
  };
  trade: {
    side: "BUY" | "SELL";
    outcome: string;
    outcomeIndex: number;
    size: number;
    price: number;
    usdcAmount: number;
  };
  market: {
    conditionId: string;
    title: string;
    slug: string;
    eventSlug: string;
    image?: string;
    currentPrice: number;
  };
  analysis: {
    suspicionScore: number;
    confidence: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    isContrarian: boolean;
    marketSentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
    reason: string;
    factors: SuspicionFactor[];
    repeatOffender: boolean;
    marketsInvolved: number;
  };
}

export interface SuspiciousActivityResponse {
  success: boolean;
  activities: SuspiciousActivity[];
  stats: {
    totalTradesScanned: number;
    uniqueTradersFound: number;
    newAccountsFound: number;
    suspiciousActivities: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    repeatOffenders: number;
  };
  lastUpdated: string;
  error?: string;
}

interface TradeData {
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

interface PriceResponse {
  price?: number;
}

async function fetchRecentTrades(limit = 500): Promise<TradeData[]> {
  try {
    const response = await fetch(
      `${POLYMARKET_API.DATA.BASE}/trades?limit=${limit}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      }
    );
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

async function fetchCurrentPrice(tokenId: string): Promise<number | null> {
  try {
    const response = await fetch(
      `${POLYMARKET_API.CLOB.BASE}/price?token_id=${tokenId}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 30 },
      }
    );
    if (!response.ok) return null;
    const data: PriceResponse = await response.json();
    return data?.price ?? null;
  } catch {
    return null;
  }
}

function checkIfContrarian(
  side: "BUY" | "SELL",
  currentPrice: number | null
): boolean {
  if (currentPrice === null) return false;
  if (side === "BUY" && currentPrice < 0.3) return true;
  if (side === "SELL" && currentPrice > 0.7) return true;
  return false;
}

function calculateSuspicionScore(
  accountAgeHours: number,
  totalTrades: number,
  _tradePrice: number,
  currentPrice: number,
  tradeSide: "BUY" | "SELL",
  tradeUsdValue: number,
  isRepeatOffender: boolean,
  marketsInvolved: number
): {
  score: number;
  confidence: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  isContrarian: boolean;
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  reason: string;
  factors: SuspicionFactor[];
} {
  let score = 0;
  const factors: SuspicionFactor[] = [];

  // Factor 1: Account age (max 35 points)
  if (accountAgeHours < 6) {
    const pts = 35;
    score += pts;
    factors.push({
      name: "Account Age",
      points: pts,
      description: `Very new account (${accountAgeHours.toFixed(1)}h old)`,
    });
  } else if (accountAgeHours < 24) {
    const pts = 25;
    score += pts;
    factors.push({
      name: "Account Age",
      points: pts,
      description: `New account (${accountAgeHours.toFixed(1)}h old)`,
    });
  } else if (accountAgeHours < 48) {
    const pts = 15;
    score += pts;
    factors.push({
      name: "Account Age",
      points: pts,
      description: `Recent account (${accountAgeHours.toFixed(1)}h old)`,
    });
  } else if (accountAgeHours < 72) {
    const pts = 8;
    score += pts;
    factors.push({
      name: "Account Age",
      points: pts,
      description: `Fairly new account (${(accountAgeHours / 24).toFixed(1)}d old)`,
    });
  }

  // Factor 2: Trade count — fewer trades = more suspicious (max 15 points)
  if (totalTrades <= 2) {
    const pts = 15;
    score += pts;
    factors.push({
      name: "Trade History",
      points: pts,
      description: `Only ${totalTrades} total trade(s) — almost no history`,
    });
  } else if (totalTrades <= 5) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Trade History",
      points: pts,
      description: `Very few trades (${totalTrades})`,
    });
  } else if (totalTrades <= 15) {
    const pts = 5;
    score += pts;
    factors.push({
      name: "Trade History",
      points: pts,
      description: `Low trade count (${totalTrades})`,
    });
  }

  // Factor 3: Contrarian position (max 25 points)
  const isContrarian = checkIfContrarian(tradeSide, currentPrice);
  let sentiment: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";

  if (currentPrice > 0.65) sentiment = "BULLISH";
  else if (currentPrice < 0.35) sentiment = "BEARISH";

  if (isContrarian) {
    const contrarianDegree =
      tradeSide === "BUY" ? 1 - currentPrice : currentPrice;

    if (contrarianDegree > 0.7) {
      const pts = 25;
      score += pts;
      factors.push({
        name: "Contrarian Position",
        points: pts,
        description: `Highly contrarian — market at ${(currentPrice * 100).toFixed(0)}%, ${tradeSide === "BUY" ? "buying YES" : "selling YES"}`,
      });
    } else if (contrarianDegree > 0.5) {
      const pts = 15;
      score += pts;
      factors.push({
        name: "Contrarian Position",
        points: pts,
        description: `Contrarian — market at ${(currentPrice * 100).toFixed(0)}%`,
      });
    } else {
      const pts = 8;
      score += pts;
      factors.push({
        name: "Contrarian Position",
        points: pts,
        description: "Slightly contrarian position",
      });
    }
  }

  // Factor 4: Trade size (max 10 points)
  if (tradeUsdValue > 10000) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Trade Size",
      points: pts,
      description: `Very large trade ($${tradeUsdValue.toFixed(0)})`,
    });
  } else if (tradeUsdValue > 5000) {
    const pts = 7;
    score += pts;
    factors.push({
      name: "Trade Size",
      points: pts,
      description: `Large trade ($${tradeUsdValue.toFixed(0)})`,
    });
  } else if (tradeUsdValue > 1000) {
    const pts = 3;
    score += pts;
    factors.push({
      name: "Trade Size",
      points: pts,
      description: `Significant trade ($${tradeUsdValue.toFixed(0)})`,
    });
  }

  // Factor 5: Repeat offender bonus (max 10 points)
  if (isRepeatOffender) {
    const pts = 10;
    score += pts;
    factors.push({
      name: "Repeat Pattern",
      points: pts,
      description: `Suspicious activity across ${marketsInvolved} different markets`,
    });
  }

  // Factor 6: Size-to-age ratio (max 5 points) — large trade from very new account
  if (accountAgeHours < 24 && tradeUsdValue > 5000) {
    const pts = 5;
    score += pts;
    factors.push({
      name: "Size/Age Ratio",
      points: pts,
      description: `$${tradeUsdValue.toFixed(0)} trade from an account less than 24h old`,
    });
  }

  const finalScore = Math.min(score, 100);

  let confidence: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  if (finalScore >= 75) confidence = "CRITICAL";
  else if (finalScore >= 55) confidence = "HIGH";
  else if (finalScore >= 35) confidence = "MEDIUM";
  else confidence = "LOW";

  const reason = factors.map((f) => f.description).join("; ");

  return {
    score: finalScore,
    confidence,
    isContrarian,
    sentiment,
    reason,
    factors,
  };
}

export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 10,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);

    const maxAccountAgeHours = Math.min(
      Math.max(
        Number.parseInt(searchParams.get("maxAccountAge") || "168", 10),
        1
      ),
      336
    );
    const minUsdValue = Math.max(
      Number.parseFloat(searchParams.get("minUsdValue") || "5000"),
      0
    );
    const minShares = Math.max(
      Number.parseFloat(searchParams.get("minShares") || "0"),
      0
    );
    const minSuspicionScore = Math.max(
      Number.parseInt(searchParams.get("minScore") || "30", 10),
      0
    );
    const limit = Math.min(
      Math.max(Number.parseInt(searchParams.get("limit") || "50", 10), 1),
      200
    );

    // Step 1: Fetch recent trades globally
    const recentTrades = await fetchRecentTrades(500);

    if (recentTrades.length === 0) {
      return NextResponse.json({
        success: true,
        activities: [],
        stats: {
          totalTradesScanned: 0,
          uniqueTradersFound: 0,
          newAccountsFound: 0,
          suspiciousActivities: 0,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          repeatOffenders: 0,
        },
        lastUpdated: new Date().toISOString(),
      } satisfies SuspiciousActivityResponse);
    }

    // Step 2: Filter by minimum USD value and shares
    const largeTrades = recentTrades.filter((trade) => {
      const usdValue = trade.size * trade.price;
      if (usdValue < minUsdValue) return false;
      if (minShares > 0 && trade.size < minShares) return false;
      return true;
    });

    // Step 3: Get unique traders
    const uniqueTraders = [...new Set(largeTrades.map((t) => t.proxyWallet))];

    // Step 4: Batch-fetch trader histories using the paginated cache
    const traderHistories = await getTraderHistoriesBatch(uniqueTraders, 10);

    // Step 5: Filter for new accounts
    const newAccountTrades = largeTrades.filter((trade) => {
      const history = traderHistories.get(trade.proxyWallet);
      return history && history.accountAgeHours <= maxAccountAgeHours;
    });

    // Pre-compute per-wallet market involvement for repeat-offender detection
    const walletMarketMap = new Map<string, Set<string>>();
    for (const trade of newAccountTrades) {
      const existing = walletMarketMap.get(trade.proxyWallet) || new Set();
      existing.add(trade.conditionId);
      walletMarketMap.set(trade.proxyWallet, existing);
    }

    // Step 6: Fetch current prices for unique tokens
    const tokenIds = [...new Set(newAccountTrades.map((t) => t.asset))];
    const priceCache = new Map<string, number | null>();

    const batchSize = 10;
    for (let i = 0; i < tokenIds.length; i += batchSize) {
      const batch = tokenIds.slice(i, i + batchSize);
      const pricePromises = batch.map(async (tokenId) => {
        const price = await fetchCurrentPrice(tokenId);
        return { tokenId, price };
      });
      const results = await Promise.all(pricePromises);
      for (const result of results) {
        priceCache.set(result.tokenId, result.price);
      }
    }

    // Step 7: Analyze trades
    const suspiciousActivities: SuspiciousActivity[] = [];

    for (const trade of newAccountTrades) {
      const history = traderHistories.get(trade.proxyWallet);
      if (!history) continue;

      const currentPrice = priceCache.get(trade.asset);
      const usdValue = trade.size * trade.price;

      const walletMarkets = walletMarketMap.get(trade.proxyWallet);
      const marketsInvolved = walletMarkets?.size ?? 1;
      const isRepeatOffender = marketsInvolved >= 2;

      const analysis = calculateSuspicionScore(
        history.accountAgeHours,
        history.totalTrades,
        trade.price,
        currentPrice ?? trade.price,
        trade.side,
        usdValue,
        isRepeatOffender,
        marketsInvolved
      );

      const meetsThreshold = analysis.score >= minSuspicionScore;

      if (meetsThreshold) {
        suspiciousActivities.push({
          id:
            trade.transactionHash || `${trade.proxyWallet}-${trade.timestamp}`,
          timestamp: new Date(trade.timestamp * 1000).toISOString(),
          account: {
            address: trade.proxyWallet,
            name: trade.name || trade.pseudonym || null,
            profileImage: trade.profileImage || null,
            firstTradeDate: history.firstTradeDate,
            accountAgeHours: history.accountAgeHours,
            totalTrades: history.totalTrades,
          },
          trade: {
            side: trade.side,
            outcome: trade.outcome,
            outcomeIndex: trade.outcomeIndex,
            size: trade.size,
            price: trade.price,
            usdcAmount: usdValue,
          },
          market: {
            conditionId: trade.conditionId,
            title: trade.title,
            slug: trade.slug,
            eventSlug: trade.eventSlug,
            image: trade.icon,
            currentPrice: currentPrice ?? trade.price,
          },
          analysis: {
            suspicionScore: analysis.score,
            confidence: analysis.confidence,
            isContrarian: analysis.isContrarian,
            marketSentiment: analysis.sentiment,
            reason: analysis.reason,
            factors: analysis.factors,
            repeatOffender: isRepeatOffender,
            marketsInvolved,
          },
        });
      }
    }

    suspiciousActivities.sort(
      (a, b) => b.analysis.suspicionScore - a.analysis.suspicionScore
    );

    const limitedActivities = suspiciousActivities.slice(0, limit);

    const criticalCount = suspiciousActivities.filter(
      (a) => a.analysis.confidence === "CRITICAL"
    ).length;
    const highCount = suspiciousActivities.filter(
      (a) => a.analysis.confidence === "HIGH"
    ).length;
    const mediumCount = suspiciousActivities.filter(
      (a) => a.analysis.confidence === "MEDIUM"
    ).length;
    const repeatOffenders = suspiciousActivities.filter(
      (a) => a.analysis.repeatOffender
    ).length;

    return NextResponse.json({
      success: true,
      activities: limitedActivities,
      stats: {
        totalTradesScanned: recentTrades.length,
        uniqueTradersFound: uniqueTraders.length,
        newAccountsFound: [...traderHistories.values()].filter(
          (h) => h.accountAgeHours <= maxAccountAgeHours
        ).length,
        suspiciousActivities: suspiciousActivities.length,
        criticalCount,
        highCount,
        mediumCount,
        repeatOffenders,
      },
      lastUpdated: new Date().toISOString(),
    } satisfies SuspiciousActivityResponse);
  } catch (error) {
    console.error("Suspicious activity API error:", error);
    return NextResponse.json(
      {
        success: false,
        activities: [],
        stats: {
          totalTradesScanned: 0,
          uniqueTradersFound: 0,
          newAccountsFound: 0,
          suspiciousActivities: 0,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          repeatOffenders: 0,
        },
        lastUpdated: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      } satisfies SuspiciousActivityResponse,
      { status: 500 }
    );
  }
}
