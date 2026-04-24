/**
 * Backtest harness for insider detection.
 *
 * Goal: measure, against real resolved markets, whether the ensemble
 * detector (account-loader + size-hider + timing-cluster) identifies
 * traders with a real edge.
 *
 * Flow:
 * 1. Fetch recently-resolved binary markets with meaningful volume
 * 2. For each market, fetch up to MAX_TRADES_PER_MARKET trades
 * 3. Batch-fetch trader histories so we know account age
 * 4. For each market: build per-wallet-per-side accumulators (size-hider
 *    context) and per-side timing clusters (with price history)
 * 5. Score every trade with the ensemble
 * 6. Compute per-trade P&L against the market's final outcome
 * 7. Aggregate — overall and per-archetype — precision@K, win-rate
 *    lift, mean profit, plus "which archetype actually helped"
 *
 * Deliberately one-shot: we care about nailing a reference number per
 * run, not running at scale.
 */

import { POLYMARKET_API } from "@/constants/polymarket";
import { getTraderHistoriesBatch } from "@/lib/trader-history-cache";
import { scoreFundingCluster } from "./archetypes/funding-cluster";
import { scoreOwnerCluster } from "./archetypes/owner-cluster";
import type {
  AccumulatedTrade,
  AccumulatorContext,
} from "./archetypes/size-hider";
import {
  buildClusters,
  type ClusterTrade,
  type TimingClusterContext,
} from "./archetypes/timing-cluster";
import type { ArchetypeId, ArchetypeScore } from "./archetypes/types";
import { categorize } from "./category";
import {
  ARCHETYPE_LABELS,
  type ConfidenceLevel,
  type EnsembleResult,
  type SuspicionFactor,
  scoreTrade,
  type TradeSide,
} from "./detector";
import { getWalletFundingBatch, type WalletFunding } from "./funding-source";
import { buildResolutionKnowledgeBase } from "./market-resolutions";
import {
  aggregatePnl,
  computeTradePnl,
  type PnlAggregate,
  type TradePnl,
} from "./pnl";
import { fetchPriceHistory, type PriceBucket } from "./price-history";
import {
  type FetchResolvedMarketsDiagnostics,
  fetchResolvedMarkets,
  type ResolvedMarket,
} from "./resolved-markets";
import { getSafeOwnersBatch, type SafeOwners } from "./safe-owner";
import { computeWalletEdge, type WalletEdge } from "./wallet-edge";
import { getWalletTradesBatch } from "./wallet-trades-cache";

interface RawTrade {
  proxyWallet: string;
  side: TradeSide;
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title?: string;
  slug?: string;
  outcome: string;
  outcomeIndex: number;
  name?: string | null;
  pseudonym?: string | null;
  profileImage?: string | null;
  transactionHash?: string;
}

const MAX_TRADES_PER_MARKET = 300;
const TRADES_PAGE_SIZE = 500;
const MAX_OFFSET = 3000; // Polymarket hard cap
const PRICE_HISTORY_FIDELITY_MINUTES = 5;
/** Sample offsets to spread fetched trades across the market's life.
 *  The Polymarket /trades endpoint returns most-recent-first with no
 *  ascending sort, so to see EARLY trades (where information-edge
 *  bets live) we jump to deeper offsets rather than paginating from
 *  the top. */
const SAMPLE_OFFSETS = [0, 500, 1000, 1500, 2500];

async function fetchMarketTradesAtOffset(
  conditionId: string,
  offset: number,
  limit: number
): Promise<RawTrade[]> {
  const url = `${POLYMARKET_API.DATA.BASE}/trades?market=${conditionId}&limit=${limit}&offset=${offset}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!response.ok) return [];
    const page = (await response.json()) as unknown;
    return Array.isArray(page) ? (page as RawTrade[]) : [];
  } catch {
    return [];
  }
}

async function fetchMarketTrades(conditionId: string): Promise<RawTrade[]> {
  const perSample = Math.ceil(MAX_TRADES_PER_MARKET / SAMPLE_OFFSETS.length);
  const perOffsetLimit = Math.min(perSample, TRADES_PAGE_SIZE);

  // Fetch sample offsets in parallel. Each captures a different slice
  // of the market's trade history.
  const samples = await Promise.all(
    SAMPLE_OFFSETS.filter((o) => o < MAX_OFFSET).map((offset) =>
      fetchMarketTradesAtOffset(conditionId, offset, perOffsetLimit)
    )
  );

  // Deduplicate by transactionHash + wallet + timestamp since nearby
  // offsets can overlap on dense markets.
  const seen = new Set<string>();
  const out: RawTrade[] = [];
  for (const page of samples) {
    for (const t of page) {
      const key = `${t.transactionHash ?? ""}|${t.proxyWallet}|${t.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out.slice(0, MAX_TRADES_PER_MARKET);
}

export interface BacktestOptions {
  maxDaysAgo: number;
  minDaysAgo: number;
  minDurationHours: number;
  minVolumeUsd: number;
  maxMarkets: number;
  /** Suspicion threshold for flagging. Retained as a fallback gate
   *  alongside the per-archetype thresholds — a trade is flagged if
   *  any archetype fires OR the ensemble maxScore meets this. */
  minSuspicionScore: number;
  /** Minimum trade USD value to consider (live detector defaults to 5000). */
  minTradeUsd: number;
}

export interface FlaggedTradeRecord {
  wallet: string;
  walletName: string | null;
  conditionId: string;
  marketQuestion: string;
  tradeTimestamp: number;
  side: TradeSide;
  outcomeIndex: number;
  size: number;
  price: number;
  usdValue: number;
  accountAgeHours: number;
  totalTrades: number;
  score: number;
  confidence: ConfidenceLevel;
  factors: SuspicionFactor[];
  firedArchetypes: ArchetypeId[];
  archetypes: ArchetypeScore[];
  /** Phase 3-½ specialist-first sort tier; see detector.ts. */
  sortPriority: number;
  /** Phase 4: funding lookup for this wallet, populated only for
   *  trades where category-specialist fired. Null on non-specialist
   *  trades (funding lookup is gated on specialist to keep Alchemy
   *  call volume bounded). */
  funding: WalletFunding | null;
  /** Phase 5: Safe-owner lookup for this wallet. Populated for every
   *  flagged wallet (owner lookup is a single cheap multicall per
   *  batch, so it's not gated like funding). Null when the address
   *  isn't a Safe (EOA or non-Safe contract). */
  owner: SafeOwners | null;
  finalPayout: number;
  pnl: TradePnl;
}

export interface ArchetypeStats {
  archetype: ArchetypeId;
  label: string;
  flaggedCount: number;
  aggregate: PnlAggregate;
  /** win rate / baseline win rate, for this archetype alone. */
  winRateLift: number;
  precisionAtK: { k: number; precision: number; n: number }[];
}

export interface PerMarketStats {
  conditionId: string;
  question: string;
  volumeUsd: number;
  totalTrades: number;
  eligibleTrades: number;
  flaggedTrades: number;
  baseline: PnlAggregate;
  flagged: PnlAggregate;
}

export interface WalletEdgeDiagnostics {
  /** Number of markets in the resolution knowledge base. */
  kbIndexed: number;
  /** Number of wallet-edges that had at least one scored historical trade. */
  walletsWithEdgeData: number;
  /** Total wallets we looked at. */
  walletsConsidered: number;
  /** Wallets with ≥5 resolved trades in some category (specialist-eligible). */
  walletsWithSpecialtySample: number;
}

export interface FundingDiagnostics {
  /** Wallets we looked up funding for (every specialist-firing wallet). */
  lookups: number;
  /** Wallets where we found a first-funder address. */
  resolved: number;
  /** First-funder classified as a known centralized exchange. */
  cexFunded: number;
  /** First-funder classified as a cross-chain bridge. */
  bridgeFunded: number;
  /** First-funder classified as self-custody (not in the known list). */
  selfCustodyFunded: number;
  /** Distinct shared-funder clusters among specialist wallets (≥2 sharing a first-funder). */
  clusters: number;
  /** Number of specialist-firing wallets that ended up in a ≥2-wallet cluster. */
  walletsInClusters: number;
}

export interface OwnerDiagnostics {
  /** Flagged wallets we queried for Safe owners. */
  lookups: number;
  /** Wallets that returned a valid owner array (i.e. are Safes). */
  resolvedSafes: number;
  /** Wallets whose getOwners() call reverted (EOAs or non-Safe contracts). */
  nonSafes: number;
  /** Distinct shared-owner clusters among flagged wallets (≥2 sharing a primary owner). */
  clusters: number;
  /** Number of flagged wallets that ended up in a ≥2-wallet owner cluster. */
  walletsInClusters: number;
}

export interface BacktestResult {
  generatedAt: string;
  options: BacktestOptions;
  marketsScanned: number;
  totalTrades: number;
  eligibleTrades: number;
  flaggedTrades: number;
  uniqueFlaggedWallets: number;
  baseline: PnlAggregate;
  /** Ensemble-combined flagged cohort (any archetype fired). */
  flagged: PnlAggregate;
  /** (flagged win rate) / (baseline win rate) when baseline > 0. */
  winRateLift: number;
  /** flagged.meanProfitPerShare / baseline.meanProfitPerShare. */
  meanProfitLift: number;
  /** Top-K precision on the ensemble-merged cohort. */
  precisionAtK: { k: number; precision: number; n: number }[];
  perMarket: PerMarketStats[];
  /** Per-archetype breakdown — which pattern actually caught edge. */
  perArchetype: ArchetypeStats[];
  topFlagged: FlaggedTradeRecord[];
  runtimeMs: number;
  resolvedMarketsDiagnostics: FetchResolvedMarketsDiagnostics;
  /** Phase 3: wallet-edge coverage diagnostics. */
  walletEdgeDiagnostics: WalletEdgeDiagnostics;
  /** Phase 4: funding-source coverage diagnostics. */
  fundingDiagnostics: FundingDiagnostics;
  /** Phase 5: Safe-owner cluster diagnostics. */
  ownerDiagnostics: OwnerDiagnostics;
}

interface MarketContext {
  market: ResolvedMarket;
  trades: RawTrade[];
  /** tokenId → price history covering the market's trading window. */
  priceHistoryByToken: Map<string, PriceBucket[]>;
  /** (wallet|condId|side) → accumulator context. */
  accumulators: Map<string, AccumulatorContext>;
  /** trade → its cluster context (if any). */
  tradeCluster: Map<RawTrade, { ctx: TimingClusterContext; side: TradeSide }>;
}

function buildMarketContext(
  market: ResolvedMarket,
  trades: RawTrade[],
  priceHistoryByToken: Map<string, PriceBucket[]>
): MarketContext {
  // Per-(wallet, condId, side) accumulators for size-hider
  const accBuckets = new Map<string, RawTrade[]>();
  for (const t of trades) {
    const k = `${t.proxyWallet}|${t.conditionId}|${t.side}`;
    const arr = accBuckets.get(k) ?? [];
    arr.push(t);
    accBuckets.set(k, arr);
  }
  const accumulators = new Map<string, AccumulatorContext>();
  for (const [k, arr] of accBuckets) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => a.timestamp - b.timestamp);
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

  // Per-(market, side) timing clusters.
  const sideBuckets = new Map<TradeSide, RawTrade[]>();
  for (const t of trades) {
    const arr = sideBuckets.get(t.side) ?? [];
    arr.push(t);
    sideBuckets.set(t.side, arr);
  }
  const tradeCluster = new Map<
    RawTrade,
    { ctx: TimingClusterContext; side: TradeSide }
  >();
  for (const [side, arr] of sideBuckets) {
    if (arr.length < 3) continue;
    const clusterTrades: ClusterTrade[] = arr.map((t) => ({
      wallet: t.proxyWallet,
      timestamp: t.timestamp,
      usdValue: t.size * t.price,
      price: t.price,
      size: t.size,
    }));
    // Use the clobTokenId for the *side* matched by trade's outcomeIndex.
    // For binary markets outcomeIndex maps 0→first token, 1→second token.
    // We attribute the same price history to the whole cluster.
    const outcomeIndex = arr[0].outcomeIndex;
    const tokenId = market.clobTokenIds[outcomeIndex];
    const priceHistory = tokenId
      ? (priceHistoryByToken.get(tokenId) ?? [])
      : [];
    const clusters = buildClusters(clusterTrades, priceHistory);
    for (const cluster of clusters) {
      for (const ct of cluster.trades) {
        const match = arr.find(
          (t) => t.proxyWallet === ct.wallet && t.timestamp === ct.timestamp
        );
        if (match) tradeCluster.set(match, { ctx: cluster, side });
      }
    }
  }

  return { market, trades, priceHistoryByToken, accumulators, tradeCluster };
}

async function fetchMarketPriceHistory(
  market: ResolvedMarket
): Promise<Map<string, PriceBucket[]>> {
  const out = new Map<string, PriceBucket[]>();
  const startTs = Math.floor(market.startedAt.getTime() / 1000);
  // Fetch through 2h post-close so timing-cluster's "price moved after"
  // can look ahead past the last trade.
  const endTs = Math.floor(market.closedAt.getTime() / 1000) + 2 * 60 * 60;
  const tokens = market.clobTokenIds.slice(0, 2);
  const histories = await Promise.all(
    tokens.map((tokenId) =>
      fetchPriceHistory(tokenId, startTs, endTs, PRICE_HISTORY_FIDELITY_MINUTES)
    )
  );
  for (let i = 0; i < tokens.length; i++) {
    out.set(tokens[i], histories[i]);
  }
  return out;
}

function perArchetypeStats(
  flagged: FlaggedTradeRecord[],
  baselineWinRate: number
): ArchetypeStats[] {
  const archetypeIds: ArchetypeId[] = [
    "account_loader",
    "size_hider",
    "timing_cluster",
    "category_specialist",
    "funding_cluster",
    "owner_cluster",
  ];
  return archetypeIds.map((id) => {
    const subset = flagged.filter((f) => f.firedArchetypes.includes(id));
    const subsetPnls = subset.map((s) => s.pnl);
    const aggregate = aggregatePnl(subsetPnls);
    const lift = baselineWinRate > 0 ? aggregate.winRate / baselineWinRate : 0;
    const sortedByScore = [...subset].sort((a, b) => {
      const aScore = a.archetypes.find((x) => x.archetype === id)?.score ?? 0;
      const bScore = b.archetypes.find((x) => x.archetype === id)?.score ?? 0;
      return bScore - aScore;
    });
    const precisionAtK = [5, 10, 20, 50].map((k) => {
      const slice = sortedByScore.slice(0, k);
      const wins = slice.filter((f) => f.pnl.isWin).length;
      return {
        k,
        precision: slice.length === 0 ? 0 : wins / slice.length,
        n: slice.length,
      };
    });
    return {
      archetype: id,
      label: ARCHETYPE_LABELS[id],
      flaggedCount: subset.length,
      aggregate,
      winRateLift: lift,
      precisionAtK,
    };
  });
}

export async function runBacktest(
  options: BacktestOptions
): Promise<BacktestResult> {
  const startedAt = Date.now();

  // Step 1: Resolved markets
  const { markets, diagnostics: resolvedMarketsDiagnostics } =
    await fetchResolvedMarkets({
      maxDaysAgo: options.maxDaysAgo,
      minDaysAgo: options.minDaysAgo,
      minDurationHours: options.minDurationHours,
      minVolumeUsd: options.minVolumeUsd,
      limit: options.maxMarkets,
    });

  // Step 2: Per-market trades (parallelized)
  const marketTrades = new Map<string, RawTrade[]>();
  const concurrency = 4;
  for (let i = 0; i < markets.length; i += concurrency) {
    const batch = markets.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (market) => ({
        conditionId: market.conditionId,
        trades: await fetchMarketTrades(market.conditionId),
      }))
    );
    for (const r of results) marketTrades.set(r.conditionId, r.trades);
  }

  // Step 3: Trader histories + wallet trade-history (for wallet-edge).
  // Fire both in parallel — they hit different endpoints.
  const uniqueWallets = new Set<string>();
  for (const trades of marketTrades.values()) {
    for (const t of trades) uniqueWallets.add(t.proxyWallet);
  }
  const walletList = [...uniqueWallets];
  const [traderHistories, walletTrades, resolutionKB] = await Promise.all([
    getTraderHistoriesBatch(walletList, 10),
    getWalletTradesBatch(walletList, 6),
    buildResolutionKnowledgeBase({ minVolumeUsd: 1000, maxPages: 10 }),
  ]);

  // Compute wallet-edge per unique wallet (pure compute over the two
  // caches we just loaded — fast).
  const walletEdges = new Map<string, WalletEdge>();
  for (const addr of walletList) {
    const trades = walletTrades.get(addr.toLowerCase()) ?? [];
    walletEdges.set(addr, computeWalletEdge(addr, trades, resolutionKB));
  }

  // Step 4: Cross-market "repeat offender" map (account-loader factor)
  const walletMarketMap = new Map<string, Set<string>>();
  for (const [conditionId, trades] of marketTrades) {
    for (const t of trades) {
      const set = walletMarketMap.get(t.proxyWallet) ?? new Set();
      set.add(conditionId);
      walletMarketMap.set(t.proxyWallet, set);
    }
  }

  // Step 5: Per-market price histories (parallelized) + contexts
  const marketContexts = new Map<string, MarketContext>();
  for (let i = 0; i < markets.length; i += concurrency) {
    const batch = markets.slice(i, i + concurrency);
    const entries = await Promise.all(
      batch.map(async (market) => {
        const priceHistory = await fetchMarketPriceHistory(market);
        const trades = marketTrades.get(market.conditionId) ?? [];
        return [
          market.conditionId,
          buildMarketContext(market, trades, priceHistory),
        ] as const;
      })
    );
    for (const [id, ctx] of entries) marketContexts.set(id, ctx);
  }

  // Step 6: Score + P&L every trade
  const flaggedAll: FlaggedTradeRecord[] = [];
  const flaggedPnls: TradePnl[] = [];
  const baselinePnls: TradePnl[] = [];
  const perMarket: PerMarketStats[] = [];
  let totalTrades = 0;
  let eligibleTrades = 0;

  for (const [conditionId, ctx] of marketContexts) {
    const { market, trades, accumulators, tradeCluster } = ctx;
    const marketBaseline: TradePnl[] = [];
    const marketFlagged: TradePnl[] = [];
    let marketEligible = 0;
    let marketFlaggedCount = 0;

    for (const trade of trades) {
      totalTrades++;
      const usdValue = trade.size * trade.price;
      if (usdValue < options.minTradeUsd) continue;
      // Exclude trades where the fill price equals (or near-equals)
      // the eventual payout — these are mechanical closing fills, not
      // real bets. Using a 2¢ band around 0 and 1 keeps most
      // uncertainty-era trades in the sample.
      if (trade.price >= 0.98 || trade.price <= 0.02) continue;
      eligibleTrades++;
      marketEligible++;

      const pnl = computeTradePnl(
        {
          outcomeIndex: trade.outcomeIndex,
          side: trade.side,
          size: trade.size,
          price: trade.price,
        },
        market.resolution
      );
      if (!pnl) continue;

      baselinePnls.push(pnl);
      marketBaseline.push(pnl);

      const history = traderHistories.get(trade.proxyWallet);
      if (!history) continue;

      const walletMarkets = walletMarketMap.get(trade.proxyWallet);
      const marketsInvolved = walletMarkets?.size ?? 1;
      const isRepeatOffender = marketsInvolved >= 2;

      const sizeHiderCtx = accumulators.get(
        `${trade.proxyWallet}|${trade.conditionId}|${trade.side}`
      );
      const clusterMatch = tradeCluster.get(trade);
      const walletEdge = walletEdges.get(trade.proxyWallet);
      const tradeCategory = categorize(trade.slug);
      const categorySpecialistInput =
        walletEdge && walletEdge.scoredTrades > 0
          ? { edge: walletEdge, tradeCategory }
          : null;

      const ensemble: EnsembleResult = scoreTrade({
        accountLoader: {
          accountAgeHours: history.accountAgeHours,
          totalTrades: history.totalTrades,
          tradeSide: trade.side,
          tradeUsdValue: usdValue,
          referencePrice: trade.price,
          isRepeatOffender,
          marketsInvolved,
        },
        sizeHider: sizeHiderCtx ?? null,
        timingCluster: clusterMatch ?? null,
        categorySpecialist: categorySpecialistInput,
        // Phase 4 funding-cluster is scored in a post-pass after we've
        // identified which wallets fired specialist. Cheaper than
        // fetching funding for every unique wallet up-front.
        fundingCluster: null,
        // Phase 5 owner-cluster is likewise scored in a post-pass
        // since sharedOwnerCount depends on the full flagged set.
        ownerCluster: null,
      });

      // Phase 2 — only flag if at least one archetype fires. The
      // ensemble's per-archetype thresholds are the right gates; the
      // legacy score fallback would let weakly-scored multi-factor
      // trades slip through with no clean "why."
      if (!ensemble.anyFired) continue;
      marketFlaggedCount++;

      flaggedPnls.push(pnl);
      marketFlagged.push(pnl);

      const finalPayout = market.resolution.prices[trade.outcomeIndex] ?? 0;
      const factors: SuspicionFactor[] = ensemble.archetypes.flatMap(
        (a) => a.factors
      );

      flaggedAll.push({
        wallet: trade.proxyWallet,
        walletName: trade.name ?? trade.pseudonym ?? null,
        conditionId,
        marketQuestion: market.question,
        tradeTimestamp: trade.timestamp,
        side: trade.side,
        outcomeIndex: trade.outcomeIndex,
        size: trade.size,
        price: trade.price,
        usdValue,
        accountAgeHours: history.accountAgeHours,
        totalTrades: history.totalTrades,
        score: ensemble.maxScore,
        confidence: ensemble.confidence,
        factors,
        firedArchetypes: ensemble.firedArchetypes,
        archetypes: ensemble.archetypes,
        sortPriority: ensemble.sortPriority,
        funding: null,
        owner: null,
        finalPayout,
        pnl,
      });
    }

    perMarket.push({
      conditionId,
      question: market.question,
      volumeUsd: market.volumeUsd,
      totalTrades: trades.length,
      eligibleTrades: marketEligible,
      flaggedTrades: marketFlaggedCount,
      baseline: aggregatePnl(marketBaseline),
      flagged: aggregatePnl(marketFlagged),
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Phase 4 post-pass: on-chain funding cluster.
  //
  // The funding-cluster archetype stacks on specialist — we only pay
  // for Alchemy lookups on wallets that already fired specialist, and
  // we only build the shared-funder graph across THAT subset. Any
  // wallet shared-funder signal outside specialist-firing wallets is
  // noise (popular DEX aggregators, relayers, etc. fund thousands of
  // retail wallets indifferently).
  //
  // Steps:
  //   1. Collect specialist-firing wallets
  //   2. Batch-fetch funding via Alchemy
  //   3. Build firstFunder → {specialist wallets} map
  //   4. For each specialist-firing flagged record, score the funding
  //      archetype with sharedFunderCount from the map
  //   5. If funding_cluster fires, mutate the record: add the score
  //      to archetypes, push "funding_cluster" into firedArchetypes,
  //      promote sortPriority to 2
  // ─────────────────────────────────────────────────────────────────
  const specialistWallets = new Set<string>();
  for (const rec of flaggedAll) {
    if (rec.firedArchetypes.includes("category_specialist")) {
      specialistWallets.add(rec.wallet.toLowerCase());
    }
  }

  const fundingMap =
    specialistWallets.size > 0
      ? await getWalletFundingBatch([...specialistWallets], 4)
      : new Map<string, WalletFunding>();

  // funder-address → set of specialist wallets funded by it. Only
  // non-CEX, non-unknown funders populate this graph — CEX first-
  // funders are shared across millions of retail wallets and carry
  // no clustering signal.
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

  for (const rec of flaggedAll) {
    if (!rec.firedArchetypes.includes("category_specialist")) continue;
    const funding = fundingMap.get(rec.wallet.toLowerCase());
    if (!funding) continue;

    rec.funding = funding;

    const funder = funding.firstFunderAddress;
    const sharedFunderCount = funder
      ? Math.max(0, (funderToSpecialistWallets.get(funder)?.size ?? 0) - 1)
      : 0;

    const fundingScore = scoreFundingCluster({
      funding,
      sharedFunderCount,
      specialistFired: true,
      tradeTimestamp: rec.tradeTimestamp,
    });

    // Replace the zero-score funding_cluster entry that scoreTrade
    // already placed in rec.archetypes (so the UI's per-archetype
    // drilldown sees the real score, not the placeholder).
    const idx = rec.archetypes.findIndex(
      (a) => a.archetype === "funding_cluster"
    );
    if (idx >= 0) rec.archetypes[idx] = fundingScore;
    else rec.archetypes.push(fundingScore);

    if (fundingScore.score >= fundingScore.threshold) {
      rec.firedArchetypes = [...rec.firedArchetypes, "funding_cluster"];
      rec.factors = [...rec.factors, ...fundingScore.factors];
      rec.sortPriority = 2;
      rec.score = Math.max(rec.score, fundingScore.score);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Phase 5 post-pass: Safe-owner cluster.
  //
  // For every flagged wallet (any archetype), fetch the primary owner
  // EOA via a single viem multicall. Group flagged wallets by owner.
  // If ≥2 share the same primary owner, they're almost certainly
  // operated by the same person — fire `owner_cluster` on each trade
  // in the cluster and bump sortPriority accordingly.
  //
  // Unlike funding-cluster, this archetype is NOT specialist-gated:
  // shared-owner overlap is a strong enough standalone signal to
  // warrant surfacing.
  // ─────────────────────────────────────────────────────────────────
  const flaggedWallets = [
    ...new Set(flaggedAll.map((r) => r.wallet.toLowerCase())),
  ];
  const ownerMap =
    flaggedWallets.length > 0
      ? await getSafeOwnersBatch(flaggedWallets)
      : new Map<string, SafeOwners>();

  // owner EOA → set of flagged wallets controlled by that owner.
  const ownerToFlaggedWallets = new Map<string, Set<string>>();
  for (const [wallet, safe] of ownerMap) {
    if (!safe.primaryOwner) continue;
    const set =
      ownerToFlaggedWallets.get(safe.primaryOwner) ?? new Set<string>();
    set.add(wallet);
    ownerToFlaggedWallets.set(safe.primaryOwner, set);
  }

  for (const rec of flaggedAll) {
    const safe = ownerMap.get(rec.wallet.toLowerCase());
    if (!safe) continue;
    rec.owner = safe;

    const owner = safe.primaryOwner;
    const sharedOwnerCount = owner
      ? Math.max(0, (ownerToFlaggedWallets.get(owner)?.size ?? 0) - 1)
      : 0;

    const ownerScore = scoreOwnerCluster({
      ownerAddress: owner,
      sharedOwnerCount,
    });

    const idx = rec.archetypes.findIndex(
      (a) => a.archetype === "owner_cluster"
    );
    if (idx >= 0) rec.archetypes[idx] = ownerScore;
    else rec.archetypes.push(ownerScore);

    if (ownerScore.score >= ownerScore.threshold) {
      rec.firedArchetypes = [...rec.firedArchetypes, "owner_cluster"];
      rec.factors = [...rec.factors, ...ownerScore.factors];
      rec.score = Math.max(rec.score, ownerScore.score);
      // Recompute sortPriority with the full signal set (specialist +
      // funding + owner). Matches detector.ts's tier logic.
      const specialistFired = rec.firedArchetypes.includes(
        "category_specialist"
      );
      const fundingFired = rec.firedArchetypes.includes("funding_cluster");
      const ownerFired = true; // just fired
      if (specialistFired && fundingFired && ownerFired) rec.sortPriority = 3;
      else if (specialistFired && (fundingFired || ownerFired))
        rec.sortPriority = 2;
      else if (specialistFired || ownerFired) rec.sortPriority = 1;
    }
  }

  // Phase 3-½ + Phase 4 + Phase 5 sort: four-tier sortPriority
  // (3=platinum, 2=gold, 1=silver, 0=baseline), secondary by raw
  // maxScore within each tier.
  flaggedAll.sort((a, b) => {
    if (a.sortPriority !== b.sortPriority)
      return b.sortPriority - a.sortPriority;
    return b.score - a.score;
  });

  const baseline = aggregatePnl(baselinePnls);
  const flagged = aggregatePnl(flaggedPnls);

  const winRateLift =
    baseline.winRate > 0 ? flagged.winRate / baseline.winRate : 0;
  const meanProfitLift =
    Math.abs(baseline.meanProfitPerShare) > 1e-6
      ? flagged.meanProfitPerShare / baseline.meanProfitPerShare
      : 0;

  const precisionAtK = [5, 10, 20, 50].map((k) => {
    const slice = flaggedAll.slice(0, k);
    const wins = slice.filter((f) => f.pnl.isWin).length;
    return {
      k,
      precision: slice.length === 0 ? 0 : wins / slice.length,
      n: slice.length,
    };
  });

  const uniqueFlaggedWallets = new Set(flaggedAll.map((f) => f.wallet)).size;
  const perArchetype = perArchetypeStats(flaggedAll, baseline.winRate);

  // Phase 3 coverage diagnostics: how many wallets did we have
  // meaningful edge data for? Low numbers here explain why category-
  // specialist doesn't fire — it needs ≥5 resolved trades in one
  // category, which requires deep knowledge-base coverage.
  let walletsWithEdgeData = 0;
  let walletsWithSpecialtySample = 0;
  for (const edge of walletEdges.values()) {
    if (edge.scoredTrades > 0) walletsWithEdgeData++;
    if (edge.byCategory.some((c) => c.resolvedTrades >= 5)) {
      walletsWithSpecialtySample++;
    }
  }
  const walletEdgeDiagnostics: WalletEdgeDiagnostics = {
    kbIndexed: resolutionKB.indexed,
    walletsWithEdgeData,
    walletsConsidered: walletEdges.size,
    walletsWithSpecialtySample,
  };

  // Phase 4 diagnostics: what did the funding lookup actually find?
  // Low resolve rates usually mean the Alchemy key isn't set (falls
  // back to no-op); low cluster counts at healthy resolve rates mean
  // the specialist cohort is spread across many unrelated funders.
  let cexFunded = 0;
  let bridgeFunded = 0;
  let selfCustodyFunded = 0;
  let resolvedFunding = 0;
  for (const funding of fundingMap.values()) {
    if (funding.firstFunderAddress) resolvedFunding++;
    if (funding.firstFunderCategory === "cex") cexFunded++;
    else if (funding.firstFunderCategory === "bridge") bridgeFunded++;
    else if (funding.firstFunderCategory === "self_custody") {
      selfCustodyFunded++;
    }
  }
  let clusters = 0;
  let walletsInClusters = 0;
  for (const wallets of funderToSpecialistWallets.values()) {
    if (wallets.size >= 2) {
      clusters++;
      walletsInClusters += wallets.size;
    }
  }
  const fundingDiagnostics: FundingDiagnostics = {
    lookups: fundingMap.size,
    resolved: resolvedFunding,
    cexFunded,
    bridgeFunded,
    selfCustodyFunded,
    clusters,
    walletsInClusters,
  };

  // Phase 5 owner coverage. `lookups` is the whole flagged cohort;
  // `resolvedSafes` is the subset whose `getOwners()` returned an
  // array (i.e. is actually a Safe contract); the rest reverted.
  let resolvedSafes = 0;
  let nonSafes = 0;
  for (const safe of ownerMap.values()) {
    if (safe.primaryOwner) resolvedSafes++;
    else nonSafes++;
  }
  let ownerClusters = 0;
  let walletsInOwnerClusters = 0;
  for (const wallets of ownerToFlaggedWallets.values()) {
    if (wallets.size >= 2) {
      ownerClusters++;
      walletsInOwnerClusters += wallets.size;
    }
  }
  const ownerDiagnostics: OwnerDiagnostics = {
    lookups: ownerMap.size,
    resolvedSafes,
    nonSafes,
    clusters: ownerClusters,
    walletsInClusters: walletsInOwnerClusters,
  };

  return {
    generatedAt: new Date().toISOString(),
    options,
    marketsScanned: markets.length,
    totalTrades,
    eligibleTrades,
    flaggedTrades: flaggedAll.length,
    uniqueFlaggedWallets,
    baseline,
    flagged,
    winRateLift,
    meanProfitLift,
    resolvedMarketsDiagnostics,
    walletEdgeDiagnostics,
    fundingDiagnostics,
    ownerDiagnostics,
    precisionAtK,
    perMarket,
    perArchetype,
    topFlagged: flaggedAll.slice(0, 25),
    runtimeMs: Date.now() - startedAt,
  };
}
