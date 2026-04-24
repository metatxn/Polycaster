import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { scoreFundingCluster } from "@/lib/insider/archetypes/funding-cluster";
import { scoreOwnerCluster } from "@/lib/insider/archetypes/owner-cluster";
import type {
  AccumulatedTrade,
  AccumulatorContext,
} from "@/lib/insider/archetypes/size-hider";
import {
  buildClusters,
  type ClusterTrade,
  type TimingClusterContext,
} from "@/lib/insider/archetypes/timing-cluster";
import { categorize } from "@/lib/insider/category";
import {
  type ArchetypeId,
  type ArchetypeScore,
  type SuspicionFactor,
  scoreTrade,
} from "@/lib/insider/detector";
import {
  getWalletFundingBatch,
  type WalletFunding,
} from "@/lib/insider/funding-source";
import { getCachedKB } from "@/lib/insider/market-resolutions";
import { getSafeOwnersBatch, type SafeOwners } from "@/lib/insider/safe-owner";
import { getCachedWalletEdgesBatch } from "@/lib/insider/wallet-edge-cache";
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
 *
 * Scoring itself lives in `@/lib/insider/detector` so the backtest
 * harness can replay identical logic against historical trades.
 */

export type { SuspicionFactor };

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
    /** Phase 2+: which archetype detectors fired on this trade. */
    firedArchetypes: ArchetypeId[];
    /** Phase 2+: full per-archetype score breakdown for drilldown. */
    archetypes: ArchetypeScore[];
    /** Phase 3-½: specialist-first sort tier. See detector.ts. */
    sortPriority: number;
    /** Phase 4: on-chain funding lookup for specialist-firing wallets.
     *  Null when specialist didn't fire OR the KB wasn't warm this
     *  request. */
    funding: WalletFunding | null;
    /** Phase 5: Safe-owner lookup for this wallet. Populated for every
     *  flagged wallet; null when the address isn't a Safe (EOA or
     *  non-Safe contract). */
    owner: SafeOwners | null;
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

    // Step 5: Pre-compute per-wallet market involvement for
    // account-loader's repeat-offender factor.
    const walletMarketMap = new Map<string, Set<string>>();
    for (const trade of largeTrades) {
      const existing = walletMarketMap.get(trade.proxyWallet) || new Set();
      existing.add(trade.conditionId);
      walletMarketMap.set(trade.proxyWallet, existing);
    }

    // Step 6: Fetch current prices for unique tokens (drives the
    // account-loader contrarian factor and is surfaced on the UI).
    const tokenIds = [...new Set(largeTrades.map((t) => t.asset))];
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

    // Step 7a: Build per-(wallet, market, side) accumulation contexts
    // from the largeTrades window. Every trade with ≥3 same-direction
    // companions from the same wallet on the same market gets a
    // non-null size-hider context.
    const accumulatorKey = (
      wallet: string,
      condId: string,
      side: string
    ): string => `${wallet}|${condId}|${side}`;
    const accumulatorBuckets = new Map<string, TradeData[]>();
    for (const t of largeTrades) {
      const k = accumulatorKey(t.proxyWallet, t.conditionId, t.side);
      const arr = accumulatorBuckets.get(k) ?? [];
      arr.push(t);
      accumulatorBuckets.set(k, arr);
    }
    const accumulators = new Map<string, AccumulatorContext>();
    for (const [k, trades] of accumulatorBuckets) {
      if (trades.length < 2) continue;
      const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
      const rows: AccumulatedTrade[] = sorted.map((t) => ({
        timestamp: t.timestamp,
        usdValue: t.size * t.price,
        price: t.price,
        size: t.size,
      }));
      const totalUsd = rows.reduce((s, r) => s + r.usdValue, 0);
      const totalSize = rows.reduce((s, r) => s + r.size, 0);
      const vwap =
        totalSize > 0
          ? rows.reduce((s, r) => s + r.price * r.size, 0) / totalSize
          : 0;
      accumulators.set(k, {
        tradeCount: rows.length,
        totalUsdValue: totalUsd,
        firstTimestamp: rows[0].timestamp,
        lastTimestamp: rows[rows.length - 1].timestamp,
        vwapPrice: vwap,
        trades: rows,
      });
    }

    // Step 7b: Build per-(market, side) timing clusters. Each cluster
    // is attributed to every trade inside it.
    const marketSideKey = (condId: string, side: string): string =>
      `${condId}|${side}`;
    const marketSideBuckets = new Map<string, TradeData[]>();
    for (const t of largeTrades) {
      const k = marketSideKey(t.conditionId, t.side);
      const arr = marketSideBuckets.get(k) ?? [];
      arr.push(t);
      marketSideBuckets.set(k, arr);
    }
    // Map trade → cluster context + side (live route skips price history
    // to keep latency tolerable; the tightness + aggregate factors still
    // drive a meaningful score on their own).
    const tradeCluster = new Map<
      TradeData,
      { ctx: TimingClusterContext; side: "BUY" | "SELL" }
    >();
    for (const [k, trades] of marketSideBuckets) {
      if (trades.length < 3) continue;
      const [, side] = k.split("|") as [string, "BUY" | "SELL"];
      const clusterTrades: ClusterTrade[] = trades.map((t) => ({
        wallet: t.proxyWallet,
        timestamp: t.timestamp,
        usdValue: t.size * t.price,
        price: t.price,
        size: t.size,
      }));
      const clusters = buildClusters(clusterTrades, []);
      if (clusters.length === 0) continue;
      // Attribute each cluster's context to every original trade it
      // contains (match by wallet + timestamp).
      for (const cluster of clusters) {
        for (const ct of cluster.trades) {
          const match = trades.find(
            (t) => t.proxyWallet === ct.wallet && t.timestamp === ct.timestamp
          );
          if (match) tradeCluster.set(match, { ctx: cluster, side });
        }
      }
    }

    // Step 7c: Phase 3 specialist archetype — needs the resolution KB
    // + each wallet's trade history. The KB is module-cached with a
    // background refresh, so the first cold-start request gets null
    // here and serves Phase 2 only. Subsequent requests (after the
    // background build settles, typically <60s) get the full
    // ensemble including specialist.
    const kb = getCachedKB({ minVolumeUsd: 1000, maxPages: 10 });
    const walletEdges = kb
      ? await getCachedWalletEdgesBatch(uniqueTraders, kb, 6)
      : new Map();

    // Step 7d: Analyze trades. Run every trade (not just new-account
    // trades) through the ensemble — size-hider and timing-cluster are
    // age-blind so we must not pre-filter on account age.
    const suspiciousActivities: SuspiciousActivity[] = [];

    for (const trade of largeTrades) {
      const history = traderHistories.get(trade.proxyWallet);
      if (!history) continue;

      const currentPrice = priceCache.get(trade.asset);
      const usdValue = trade.size * trade.price;
      const referencePrice = currentPrice ?? trade.price;

      const walletMarkets = walletMarketMap.get(trade.proxyWallet);
      const marketsInvolved = walletMarkets?.size ?? 1;
      const isRepeatOffender = marketsInvolved >= 2;

      const sizeHiderCtx = accumulators.get(
        accumulatorKey(trade.proxyWallet, trade.conditionId, trade.side)
      );
      const clusterCtx = tradeCluster.get(trade);

      // Phase 3 categorySpecialist input — built from the cached
      // wallet-edge for this wallet + the current trade's category.
      // Null when the KB wasn't warm this request (cold start) or
      // this wallet has zero resolved historical trades.
      const edge = walletEdges.get(trade.proxyWallet.toLowerCase());
      const tradeCategory = categorize(trade.slug);
      const categorySpecialist =
        edge && edge.scoredTrades > 0 ? { edge, tradeCategory } : null;

      const ensemble = scoreTrade({
        accountLoader: {
          accountAgeHours: history.accountAgeHours,
          totalTrades: history.totalTrades,
          tradeSide: trade.side,
          tradeUsdValue: usdValue,
          referencePrice,
          isRepeatOffender,
          marketsInvolved,
        },
        sizeHider: sizeHiderCtx ?? null,
        timingCluster: clusterCtx ?? null,
        categorySpecialist,
        // Phase 4 funding-cluster is scored in a post-pass after we
        // identify specialist-firing wallets — keeps Alchemy calls
        // bounded to the tiny specialist subset instead of every
        // unique trader.
        fundingCluster: null,
        // Phase 5 owner-cluster is likewise scored in a post-pass
        // (requires knowing the full flagged cohort).
        ownerCluster: null,
      });

      // Backward-compat filter: the legacy `minSuspicionScore` param
      // now gates on the ensemble's max score. `anyFired` also
      // qualifies — it's the honest trigger for ensemble-era
      // flagging.
      const meetsThreshold =
        ensemble.anyFired || ensemble.maxScore >= minSuspicionScore;
      if (!meetsThreshold) continue;

      // Legacy-compat derivations for the existing UI fields.
      const isContrarian =
        (trade.side === "BUY" && referencePrice < 0.3) ||
        (trade.side === "SELL" && referencePrice > 0.7);
      const marketSentiment: "BULLISH" | "BEARISH" | "NEUTRAL" =
        referencePrice > 0.65
          ? "BULLISH"
          : referencePrice < 0.35
            ? "BEARISH"
            : "NEUTRAL";
      const flatFactors: SuspicionFactor[] = ensemble.archetypes.flatMap(
        (a) => a.factors
      );

      suspiciousActivities.push({
        id: trade.transactionHash || `${trade.proxyWallet}-${trade.timestamp}`,
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
          currentPrice: referencePrice,
        },
        analysis: {
          suspicionScore: ensemble.maxScore,
          confidence: ensemble.confidence,
          isContrarian,
          marketSentiment,
          reason: ensemble.reason,
          factors: flatFactors,
          repeatOffender: isRepeatOffender,
          marketsInvolved,
          firedArchetypes: ensemble.firedArchetypes,
          archetypes: ensemble.archetypes,
          sortPriority: ensemble.sortPriority,
          funding: null,
          owner: null,
        },
      });
    }

    // ───────────────────────────────────────────────────────────
    // Phase 4 funding-cluster post-pass.
    //
    // Identical logic to backtest.ts: only specialist-firing wallets
    // get an Alchemy lookup (typically 0-3 per request), and the
    // shared-funder graph is built within that subset. If funding
    // fires, promote sortPriority to 2 (gold tier).
    // ───────────────────────────────────────────────────────────
    const specialistWallets = new Set<string>();
    for (const a of suspiciousActivities) {
      if (a.analysis.firedArchetypes.includes("category_specialist")) {
        specialistWallets.add(a.account.address.toLowerCase());
      }
    }

    const fundingMap =
      specialistWallets.size > 0
        ? await getWalletFundingBatch([...specialistWallets], 4)
        : new Map<string, WalletFunding>();

    const funderToSpecialistWallets = new Map<string, Set<string>>();
    for (const [wallet, funding] of fundingMap) {
      const cat = funding.firstFunderCategory;
      if (cat !== "self_custody" && cat !== "bridge") continue;
      if (!funding.firstFunderAddress) continue;
      const set =
        funderToSpecialistWallets.get(funding.firstFunderAddress) ??
        new Set<string>();
      set.add(wallet);
      funderToSpecialistWallets.set(funding.firstFunderAddress, set);
    }

    for (const a of suspiciousActivities) {
      if (!a.analysis.firedArchetypes.includes("category_specialist")) continue;
      const funding = fundingMap.get(a.account.address.toLowerCase());
      if (!funding) continue;

      a.analysis.funding = funding;

      const funder = funding.firstFunderAddress;
      const sharedFunderCount = funder
        ? Math.max(0, (funderToSpecialistWallets.get(funder)?.size ?? 0) - 1)
        : 0;

      const fundingScore = scoreFundingCluster({
        funding,
        sharedFunderCount,
        specialistFired: true,
        tradeTimestamp: Math.floor(new Date(a.timestamp).getTime() / 1000),
      });

      const idx = a.analysis.archetypes.findIndex(
        (s) => s.archetype === "funding_cluster"
      );
      if (idx >= 0) a.analysis.archetypes[idx] = fundingScore;
      else a.analysis.archetypes.push(fundingScore);

      if (fundingScore.score >= fundingScore.threshold) {
        a.analysis.firedArchetypes = [
          ...a.analysis.firedArchetypes,
          "funding_cluster",
        ];
        a.analysis.factors = [...a.analysis.factors, ...fundingScore.factors];
        a.analysis.sortPriority = 2;
        a.analysis.suspicionScore = Math.max(
          a.analysis.suspicionScore,
          fundingScore.score
        );
      }
    }

    // ─────────────────────────────────────────────────────────
    // Phase 5 owner-cluster post-pass.
    //
    // Fetch Safe primary-owners for every flagged wallet via a
    // single viem multicall. Group by owner EOA, fire owner_cluster
    // on wallets whose owner is shared with ≥1 other flagged wallet.
    // ─────────────────────────────────────────────────────────
    const flaggedWallets = [
      ...new Set(
        suspiciousActivities.map((a) => a.account.address.toLowerCase())
      ),
    ];
    const ownerMap =
      flaggedWallets.length > 0
        ? await getSafeOwnersBatch(flaggedWallets)
        : new Map<string, SafeOwners>();

    const ownerToFlaggedWallets = new Map<string, Set<string>>();
    for (const [wallet, safe] of ownerMap) {
      if (!safe.primaryOwner) continue;
      const set =
        ownerToFlaggedWallets.get(safe.primaryOwner) ?? new Set<string>();
      set.add(wallet);
      ownerToFlaggedWallets.set(safe.primaryOwner, set);
    }

    for (const a of suspiciousActivities) {
      const safe = ownerMap.get(a.account.address.toLowerCase());
      if (!safe) continue;
      a.analysis.owner = safe;

      const owner = safe.primaryOwner;
      const sharedOwnerCount = owner
        ? Math.max(0, (ownerToFlaggedWallets.get(owner)?.size ?? 0) - 1)
        : 0;

      const ownerScore = scoreOwnerCluster({
        ownerAddress: owner,
        sharedOwnerCount,
      });

      const idx = a.analysis.archetypes.findIndex(
        (s) => s.archetype === "owner_cluster"
      );
      if (idx >= 0) a.analysis.archetypes[idx] = ownerScore;
      else a.analysis.archetypes.push(ownerScore);

      if (ownerScore.score >= ownerScore.threshold) {
        a.analysis.firedArchetypes = [
          ...a.analysis.firedArchetypes,
          "owner_cluster",
        ];
        a.analysis.factors = [...a.analysis.factors, ...ownerScore.factors];
        a.analysis.suspicionScore = Math.max(
          a.analysis.suspicionScore,
          ownerScore.score
        );
        // Recompute sortPriority with the full signal set (matches
        // detector.ts + backtest.ts).
        const specialistFired = a.analysis.firedArchetypes.includes(
          "category_specialist"
        );
        const fundingFired =
          a.analysis.firedArchetypes.includes("funding_cluster");
        if (specialistFired && fundingFired) a.analysis.sortPriority = 3;
        else if (specialistFired) a.analysis.sortPriority = 2;
        else a.analysis.sortPriority = 1;
      }
    }

    // Phase 3-½ + Phase 4 + Phase 5 sort: four-tier sortPriority first,
    // then raw suspicion score within each tier.
    suspiciousActivities.sort((a, b) => {
      if (a.analysis.sortPriority !== b.analysis.sortPriority) {
        return b.analysis.sortPriority - a.analysis.sortPriority;
      }
      return b.analysis.suspicionScore - a.analysis.suspicionScore;
    });

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
