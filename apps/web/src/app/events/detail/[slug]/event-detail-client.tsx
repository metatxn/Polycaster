"use client";

import { createLogger } from "@knoww/logger";
import {
  fetchClobOrderBook,
  fetchClobOrderBooks,
} from "@knoww/shared-types/clob";
import {
  getGammaYesNoMarketFields,
  resolveNegRisk,
} from "@knoww/shared-types/polymarket";
import Decimal from "decimal.js";

const log = createLogger("event-detail");

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChromeHeader } from "@/components/app-layout";
import { CommentsSection } from "@/components/comments";
import { ErrorBoundary } from "@/components/error-boundary";
import { LeagueRail, LeagueRailMobile } from "@/components/league-rail";
import type { TimeRange } from "@/components/market-price-chart";
import { Navbar } from "@/components/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CLOB_BASE_URL } from "@/constants/polymarket";
import type { Event } from "@/hooks/use-event-detail";
import { useEventDetail } from "@/hooks/use-event-detail";
import {
  useOrderBook as useOrderBookFromStore,
  useOrderBookStore,
} from "@/hooks/use-orderbook-store";
import { usePriceAlertDetection } from "@/hooks/use-price-alerts";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useOrderBookWebSocket } from "@/hooks/use-shared-websocket";
import { useSportsWebSocket } from "@/hooks/use-sports-websocket";
import { type Position, useUserPositions } from "@/hooks/use-user-positions";
import { ensureReadableSeriesColors } from "@/lib/chart-colors";
import { formatVolume } from "@/lib/formatters";
import { getMarketShortLabel } from "@/lib/market-labels";
import { SPORT_GROUPS } from "@/lib/sport-categories";
import { matchSportsEventToGame } from "@/lib/sports-event-match";
import {
  type CachedSportsLiveGame,
  readCachedSportsLiveGame,
  SPORTS_LIVE_GAME_CACHE_TTL_MS,
  shouldUseCachedSportsLiveGame,
  sportsLiveGameCacheKey,
  writeCachedSportsLiveGame,
} from "@/lib/sports-live-game-cache";
import { applyLiveTradingOutcomeQuotes } from "@/lib/trading-outcome-quotes";
import type { TokenMarketMap } from "@/types/comments";
import type { OutcomeData, TradingSide } from "@/types/market";
import { CandidateTicker } from "./candidate-ticker";
import { FieldTiles } from "./field-tiles";
import { HeaderSection } from "./header-section";
import { MatchupOutcomes } from "./matchup-outcomes";
import { OutcomesTable } from "./outcomes-table";
import { isTeamMatchupEvent, TeamMatchupHero } from "./team-matchup-hero";

// Lazy load heavy components - they're code-split into separate chunks
const MarketPriceChart = dynamic(
  () =>
    import("@/components/market-price-chart").then((mod) => ({
      default: mod.MarketPriceChart,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
  }
);

const TradingForm = dynamic(
  () =>
    import("@/components/trading-form").then((mod) => ({
      default: mod.TradingForm,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full">
        <div className="border-t border-b border-border/40 py-4 space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    ),
  }
);

// Props for the client component
interface EventDetailClientProps {
  slug: string;
  initialEvent?: Event | null;
}

// Cap list-row REST quote hydration so large events do not fan out hundreds of
// CLOB /book requests on first paint.
const MAX_MARKETS_WITH_REST_QUOTES = 20;

type BookSnapshot = {
  market?: string;
  asset_id?: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  min_order_size?: string;
  tick_size?: string;
};

type PriceHistoryPoint = {
  t: number;
  p: number;
};

type PriceHistoryBatchResponse = {
  success: boolean;
  histories: Array<{
    tokenId: string;
    history: PriceHistoryPoint[];
  }>;
};

/**
 * Per-outcome palette for the multi-series chart, the field tiles, and the
 * outcomes table — single source of truth so a contender's color is the
 * same everywhere on the page. 5 colors chosen to read on both light and
 * dark themes; cycles for events with more than 5 outcomes.
 */
const CANDIDATE_PALETTE = [
  "hsl(221, 83%, 53%)", // Blue
  "hsl(25, 95%, 53%)", // Orange
  "hsl(280, 70%, 55%)", // Purple
  "hsl(142, 76%, 36%)", // Green
  "hsl(340, 82%, 52%)", // Rose
];

const chartTimeRangeToStartTsOffset: Record<TimeRange, number> = {
  "30M": 30 * 60,
  "1H": 60 * 60,
  "2H": 2 * 60 * 60,
  "3H": 3 * 60 * 60,
  "6H": 6 * 60 * 60,
  "1D": 24 * 60 * 60,
  "1W": 7 * 24 * 60 * 60,
  "1M": 30 * 24 * 60 * 60,
  ALL: 365 * 24 * 60 * 60,
};

const chartTimeRangeToFidelity: Record<Exclude<TimeRange, "ALL">, number> = {
  "30M": 1,
  "1H": 1,
  "2H": 1,
  "3H": 1,
  "6H": 1,
  "1D": 5,
  "1W": 30,
  "1M": 120,
};

function computeAllRangeFidelity(spanSeconds: number): number {
  const spanMinutes = spanSeconds / 60;
  const raw = Math.max(1, Math.round(spanMinutes / 400));
  const buckets = [1, 5, 15, 30, 60, 120, 240, 360, 720, 1440];
  for (const bucket of buckets) {
    if (raw <= bucket) return bucket;
  }
  return 1440;
}

function getChartRangePriceHistoryRequest(
  timeRange: TimeRange,
  startDate: string | undefined
): { startTs: number; fidelity: number } {
  const nowSec = Math.floor(Date.now() / 1000);

  if (timeRange === "ALL") {
    const parsedStart = startDate
      ? Math.floor(new Date(startDate).getTime() / 1000)
      : Number.NaN;
    const fallback = nowSec - chartTimeRangeToStartTsOffset.ALL;
    const startTs = Number.isFinite(parsedStart)
      ? Math.min(parsedStart, nowSec)
      : fallback;

    return {
      startTs,
      fidelity: computeAllRangeFidelity(Math.max(60, nowSec - startTs)),
    };
  }

  return {
    startTs: nowSec - chartTimeRangeToStartTsOffset[timeRange],
    fidelity: chartTimeRangeToFidelity[timeRange],
  };
}

function isLiveSportsEventForChart(event: Event | null | undefined): boolean {
  if (
    !event ||
    !isTeamMatchupEvent(event.teams) ||
    event.closed === true ||
    event.archived === true
  ) {
    return false;
  }

  if (event.live === true || event.score || event.period || event.elapsed) {
    return true;
  }

  const kickoffMs = event.startTime ? new Date(event.startTime).getTime() : NaN;
  if (!Number.isFinite(kickoffMs)) return false;

  const elapsedMs = Date.now() - kickoffMs;
  return elapsedMs >= 0 && elapsedMs < 8 * 60 * 60 * 1000;
}

async function fetchBookSnapshot(
  tokenId: string
): Promise<BookSnapshot | null> {
  try {
    return await fetchClobOrderBook(tokenId, { host: CLOB_BASE_URL });
  } catch {
    return null;
  }
}

async function fetchBookSnapshots(tokenIds: string[]): Promise<BookSnapshot[]> {
  if (tokenIds.length === 0) return [];

  try {
    return await fetchClobOrderBooks(tokenIds, { host: CLOB_BASE_URL });
  } catch {
    return [];
  }
}

async function fetchPriceHistoryBatch(
  tokenIds: string[],
  startTs: number,
  fidelity: number
): Promise<PriceHistoryBatchResponse["histories"]> {
  if (tokenIds.length === 0) return [];

  const response = await fetch("/api/markets/price-history/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokenIds, startTs, fidelity }),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch price history");
  }

  const data = (await response.json()) as PriceHistoryBatchResponse;
  return data.success ? data.histories : [];
}

function toDisplayPercentagePointChange(changeFraction: number): number {
  if (!Number.isFinite(changeFraction)) return 0;

  const percentagePoints = new Decimal(changeFraction).mul(100);
  const rounded = percentagePoints
    .toDecimalPlaces(
      percentagePoints.abs().lt(1) ? 1 : 0,
      Decimal.ROUND_HALF_UP
    )
    .toNumber();

  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeOutcomeName(value: unknown): string {
  if (value == null) return "";

  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSportsRailActiveSlug(event: Event | null | undefined): string {
  if (!event) return "sports";

  const searchableValues = [
    event.slug,
    event.title,
    ...(event.tags ?? []),
    ...(event.markets ?? []).flatMap((market) => [
      market.slug,
      market.question,
      market.groupItemTitle,
      market.parentEventTitle,
      market.sportsMarketType,
    ]),
    ...(event.teams ?? []).flatMap((team) => [
      team.name,
      team.abbreviation,
      team.alias,
      team.league,
    ]),
  ]
    .map(normalizeOutcomeName)
    .filter(Boolean);

  for (const group of SPORT_GROUPS) {
    for (const league of group.leagues) {
      const leagueCandidates = [league.slug, league.label, league.tagSlug].map(
        normalizeOutcomeName
      );

      if (
        leagueCandidates.some((candidate) =>
          searchableValues.some((value) => value.includes(candidate))
        )
      ) {
        return league.slug;
      }
    }

    const groupCandidates = [group.slug, group.label, group.tagSlug].map(
      normalizeOutcomeName
    );
    if (
      groupCandidates.some((candidate) =>
        searchableValues.some((value) => value.includes(candidate))
      )
    ) {
      return group.slug;
    }
  }

  return "sports";
}

function findOutcomeIndexFromUrl(
  rawOutcome: string | undefined,
  outcomes: OutcomeData[],
  selectedMarket: { groupItemTitle?: string; question?: string } | null,
  event: Event | null
): number {
  const target = normalizeOutcomeName(rawOutcome);
  if (!target) return -1;

  const directIndex = outcomes.findIndex(
    (outcome) => normalizeOutcomeName(outcome.name) === target
  );
  if (directIndex !== -1) return directIndex;

  if (
    selectedMarket &&
    normalizeOutcomeName(selectedMarket.groupItemTitle) === target
  ) {
    return 0;
  }

  if (event?.teams?.length) {
    const teamIndex = event.teams.findIndex((team) => {
      const names = [team.name, team.abbreviation, team.alias].map(
        normalizeOutcomeName
      );
      return names.some((name) => name && name === target);
    });
    if (teamIndex !== -1) {
      const marketText = normalizeOutcomeName(
        `${selectedMarket?.groupItemTitle ?? ""} ${
          selectedMarket?.question ?? ""
        }`
      );
      const team = event.teams[teamIndex];
      const teamNames = [team.name, team.abbreviation, team.alias]
        .map(normalizeOutcomeName)
        .filter(Boolean);
      if (teamNames.some((name) => marketText.includes(name))) return 0;
    }
  }

  return -1;
}

function matchupMoneylineRank(
  rawLabel: string | undefined,
  teams: NonNullable<Event["teams"]>
): number {
  const label = normalizeOutcomeName(rawLabel);
  if (!label) return 3;
  if (label.startsWith("draw")) return 1;

  const teamIndex = teams.findIndex((team) => {
    const names = [team.name, team.abbreviation, team.alias]
      .map(normalizeOutcomeName)
      .filter(Boolean);
    return names.some(
      (name) => label === name || label.includes(name) || name.includes(label)
    );
  });

  if (teamIndex === 0) return 0;
  if (teamIndex === 1) return 2;
  return 3;
}

function matchupMoneylineLabel(
  rawLabel: string | undefined,
  teams: NonNullable<Event["teams"]>
): string {
  const rank = matchupMoneylineRank(rawLabel, teams);
  if (rank === 0) return teams[0]?.name.trim() || "Team A";
  if (rank === 1) return "Draw";
  if (rank === 2) return teams[1]?.name.trim() || "Team B";
  return (rawLabel || "Moneyline").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// Dedicated trading-panel order book snapshot shape.
// Keep this separate from other ["orderBook", tokenId] query consumers so the
// trading form never reads an incompatible cached payload and waits for staleness.
interface TradingPanelOrderBookSnapshot {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  min_order_size: string;
  tick_size: string;
}

export default function EventDetailClient({
  slug: eventSlugOrId,
  initialEvent,
}: EventDetailClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read URL params for pre-filling trading form (from "Modify Order" in sell modal)
  const urlSide = searchParams?.get("side") as TradingSide | null;
  const urlShares = searchParams?.get("shares");
  const urlOutcome = searchParams?.get("outcome");
  const urlConditionId = searchParams?.get("conditionId");

  // Parse initial values from URL
  const initialSide: TradingSide | undefined =
    urlSide === "SELL" || urlSide === "BUY" ? urlSide : undefined;
  const initialShares: number | undefined = urlShares
    ? Number.parseFloat(urlShares)
    : undefined;
  const initialOutcomeFromUrl = urlOutcome?.toLowerCase();

  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState(0);
  const [chartTimeRange, setChartTimeRange] = useState<TimeRange>(() =>
    isLiveSportsEventForChart(initialEvent) ? "1H" : "ALL"
  );
  const chartTimeRangeTouchedRef = useRef(false);
  const liveSportsChartDefaultAppliedRef = useRef(
    isLiveSportsEventForChart(initialEvent)
  );
  // Track which market has its order book expanded (null = none)
  const [expandedOrderBookMarketId, setExpandedOrderBookMarketId] = useState<
    string | null
  >(null);
  // Outcome table collapse state - using Tailwind's 'lg' breakpoint (1024px)
  // Collapsed below lg (covers iPad Air 820px), expanded at lg and above
  const [isOutcomeTableExpanded, setIsOutcomeTableExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(min-width: 1024px)").matches; // Tailwind 'lg' breakpoint
    }
    return true; // Default to expanded for SSR
  });
  const [isScrolled, setIsScrolled] = useState(false);
  const [cachedLiveGame, setCachedLiveGame] =
    useState<CachedSportsLiveGame | null>(null);

  // Track pending refetch timers so we can cancel them on unmount
  const sellRefetchTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Cleanup sell refetch timers on unmount to prevent firing on unmounted component
  useEffect(() => {
    return () => {
      for (const timer of sellRefetchTimersRef.current) {
        clearTimeout(timer);
      }
      sellRefetchTimersRef.current = [];
    };
  }, []);

  // Handle scroll for sticky header effects with performance optimization and hysteresis
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          // Use hysteresis to prevent flickering:
          // - Scroll down: trigger at 50px
          // - Scroll up: untrigger at 10px
          setIsScrolled((prev) => {
            if (!prev && scrollY > 50) return true;
            if (prev && scrollY < 10) return false;
            return prev;
          });
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Order book store action for preloading from REST
  // Select only the action (stable ref) to avoid re-rendering on every store update
  const setOrderBookFromRest = useOrderBookStore((s) => s.setOrderBookFromRest);
  const queryClient = useQueryClient();

  // Helper to quickly seed order book from REST (direct Polymarket call) for
  // a token. Routes through React Query's cache (`queryClient.fetchQuery`)
  // using the same `["orderBook", tokenId]` key that every other orderbook
  // consumer uses, so repeated preloads (StrictMode double-invokes, effect
  // re-runs on dep changes, hover handlers in the outcomes table, etc.)
  // share ONE in-flight network request per token instead of each issuing
  // their own raw fetch.
  const preloadOrderBook = useCallback(
    async (tokenId: string | undefined) => {
      if (!tokenId) return;
      try {
        const data = await queryClient.fetchQuery<BookSnapshot>({
          queryKey: ["orderBook", tokenId],
          queryFn: async () => {
            const snapshot = await fetchBookSnapshot(tokenId);
            if (!snapshot) {
              throw new Error("Failed to fetch order book");
            }
            return snapshot;
          },
          staleTime: 30_000,
        });
        // Still skip seeding if both endpoints returned empty — preserves
        // any WS-delivered data already in the store.
        if (data.bids.length === 0 && data.asks.length === 0) return;
        setOrderBookFromRest(tokenId, data.bids, data.asks);
      } catch (err) {
        log.error("orderbook.preload_failed", { error: err });
      }
    },
    [queryClient, setOrderBookFromRest]
  );

  // Use slug from URL params - API handles both slugs and numeric IDs
  // Pass initialEvent from server for instant rendering (React 19 SSR optimization)
  const {
    data: event,
    isLoading: loading,
    error,
  } = useEventDetail(eventSlugOrId, initialEvent);
  const hasTeamMatchup = isTeamMatchupEvent(event?.teams);
  const { games: liveSportsGames } = useSportsWebSocket({
    enabled: hasTeamMatchup,
  });
  const liveGame = useMemo(
    () => (event ? matchSportsEventToGame(event, liveSportsGames) : null),
    [event, liveSportsGames]
  );
  const liveGameCacheKey = useMemo(() => {
    const keySource = event?.slug ?? eventSlugOrId;
    return keySource ? sportsLiveGameCacheKey(keySource) : null;
  }, [event?.slug, eventSlugOrId]);

  useEffect(() => {
    if (!liveGameCacheKey || !event || typeof window === "undefined") {
      setCachedLiveGame(null);
      return;
    }

    setCachedLiveGame(
      readCachedSportsLiveGame(window.sessionStorage, liveGameCacheKey, event)
    );
  }, [event, liveGameCacheKey]);

  useEffect(() => {
    if (!liveGame || !liveGameCacheKey || typeof window === "undefined") return;

    const cacheEntry: CachedSportsLiveGame = {
      gameId: liveGame.gameId,
      leagueAbbreviation: liveGame.leagueAbbreviation,
      slug: liveGame.slug,
      homeTeam: liveGame.homeTeam,
      awayTeam: liveGame.awayTeam,
      status: liveGame.status,
      score: liveGame.score,
      period: liveGame.period,
      elapsed: liveGame.elapsed,
      live: liveGame.live,
      ended: liveGame.ended,
      updatedAt: liveGame.updatedAt,
      receivedAt: liveGame.receivedAt,
    };

    writeCachedSportsLiveGame(
      window.sessionStorage,
      liveGameCacheKey,
      cacheEntry
    );
    setCachedLiveGame(cacheEntry);
  }, [liveGame, liveGameCacheKey]);

  useEffect(() => {
    if (!cachedLiveGame) return;

    const ageMs = Date.now() - cachedLiveGame.receivedAt;
    const expiresInMs = Math.max(0, SPORTS_LIVE_GAME_CACHE_TTL_MS - ageMs);
    const timeout = window.setTimeout(() => {
      setCachedLiveGame(null);
    }, expiresInMs);

    return () => window.clearTimeout(timeout);
  }, [cachedLiveGame]);

  const displayLiveGame = liveGame
    ? liveGame
    : shouldUseCachedSportsLiveGame(cachedLiveGame, event)
      ? cachedLiveGame
      : null;

  const handleChartTimeRangeChange = useCallback((range: TimeRange) => {
    chartTimeRangeTouchedRef.current = true;
    setChartTimeRange(range);
  }, []);

  useEffect(() => {
    if (
      liveSportsChartDefaultAppliedRef.current ||
      !isLiveSportsEventForChart(event) ||
      chartTimeRangeTouchedRef.current
    ) {
      return;
    }

    liveSportsChartDefaultAppliedRef.current = true;
    setChartTimeRange((current) => (current === "ALL" ? "1H" : current));
  }, [event]);

  // Fetch user positions to show "You have a position" indicator
  const {
    proxyAddress,
    isDeployed: hasProxyWallet,
    refresh: refreshProxyWallet,
  } = useProxyWallet();
  const tradingAddress =
    hasProxyWallet && proxyAddress ? proxyAddress : undefined;
  const { data: positionsData, refetch: refetchPositions } = useUserPositions({
    userAddress: tradingAddress,
    enabled: !!tradingAddress,
  });

  // Handle sell success - refresh positions and wallet balance
  const handleSellSuccess = useCallback(() => {
    // Immediate refetch
    refetchPositions();
    refreshProxyWallet();

    // Clear any previously scheduled refetch timers (e.g. from rapid sell clicks)
    for (const timer of sellRefetchTimersRef.current) {
      clearTimeout(timer);
    }
    sellRefetchTimersRef.current = [];

    // Multiple delayed refetches to catch backend updates
    const refetchAll = () => {
      refetchPositions();
      refreshProxyWallet();
    };

    // Refetch at 1s, 3s, and 5s to catch the update
    // Store timer IDs so they can be cancelled on unmount
    sellRefetchTimersRef.current = [
      setTimeout(refetchAll, 1000),
      setTimeout(refetchAll, 3000),
      setTimeout(refetchAll, 5000),
    ];
  }, [refetchPositions, refreshProxyWallet]);

  // Build position lookup maps for fast matching
  const { positionsByConditionId, positionsByAsset } = useMemo(() => {
    const byConditionId = new Map<string, Position[]>();
    const byAsset = new Map<string, Position[]>();

    if (!positionsData?.positions) {
      return {
        positionsByConditionId: byConditionId,
        positionsByAsset: byAsset,
      };
    }

    for (const position of positionsData.positions) {
      // Group by conditionId
      if (position.conditionId) {
        const existing = byConditionId.get(position.conditionId) || [];
        existing.push(position);
        byConditionId.set(position.conditionId, existing);
      }
      // Group by asset (token ID)
      if (position.asset) {
        const existing = byAsset.get(position.asset) || [];
        existing.push(position);
        byAsset.set(position.asset, existing);
      }
    }

    return { positionsByConditionId: byConditionId, positionsByAsset: byAsset };
  }, [positionsData?.positions]);

  // Helper to get all user positions for a market. Split positions can create
  // both YES and NO rows for the same condition, so callers must not collapse
  // by conditionId.
  const getMarketPositions = useCallback(
    (market: {
      conditionId?: string;
      yesTokenId?: string;
      noTokenId?: string;
    }): Position[] => {
      const seen = new Set<string>();
      const results: Position[] = [];
      const addPositions = (positions: Position[] | undefined) => {
        for (const position of positions ?? []) {
          if (seen.has(position.id)) continue;
          seen.add(position.id);
          results.push(position);
        }
      };

      // Try conditionId first (most reliable)
      if (market.conditionId) {
        addPositions(positionsByConditionId.get(market.conditionId));
      }
      // Fallback to asset/token ID matching
      if (market.yesTokenId) {
        addPositions(positionsByAsset.get(market.yesTokenId));
      }
      if (market.noTokenId) {
        addPositions(positionsByAsset.get(market.noTokenId));
      }
      return results;
    },
    [positionsByConditionId, positionsByAsset]
  );

  // Handle order success
  const handleOrderSuccess = useCallback((_order: unknown) => {
    // console.log("Order placed successfully:", order);
  }, []);

  // Handle order error
  const handleOrderError = useCallback((_error: Error) => {
    // console.error("Order failed:", error);
  }, []);

  // Handle price click from order book
  const handlePriceClick = useCallback((_price: number) => {
    // console.log("Price clicked:", price);
  }, []);

  // Compute markets safely (even when event is null/undefined)
  const allMarkets = useMemo(() => {
    if (!event?.markets) return [];
    // Keep inactive markets hidden from UI
    return event.markets.filter((market) => market.active !== false);
  }, [event?.markets]);

  const openMarkets = useMemo(
    () => allMarkets.filter((m) => m.closed !== true),
    [allMarkets]
  );

  const closedMarkets = useMemo(
    () => allMarkets.filter((m) => m.closed === true),
    [allMarkets]
  );

  // "Single outcome" in this UI means: the event only has ONE market.
  // If there are multiple markets under the event, we only show order books when a user expands a specific market row.
  const totalMarketsCount =
    (typeof event?.marketCount === "number" ? event.marketCount : undefined) ??
    event?.markets?.length ??
    0;
  const isSingleMarketEvent = totalMarketsCount === 1;

  // Compute selected market, trading outcomes, and sorted market data for display
  const {
    selectedMarket,
    tradingOutcomes: staticTradingOutcomes,
    currentTokenId,
    tokenMarketMap,
    sortedMarketData,
  } = useMemo(() => {
    if (!event || openMarkets.length === 0) {
      return {
        selectedMarket: null,
        tradingOutcomes: [] as OutcomeData[],
        currentTokenId: "",
        tokenMarketMap: new Map() as TokenMarketMap,
        sortedMarketData: [] as Array<{
          id: string;
          conditionId: string;
          question: string;
          groupItemTitle: string;
          yesProbability: number;
          yesPrice: string;
          noPrice: string;
          yesTokenId: string;
          noTokenId: string;
          negRisk: boolean;
          orderMinSize: number;
          change: number;
          hasOneDayPriceChange: boolean;
          volume: string;
          color: string;
          sportsMarketType?: string;
          /** Parent event linkage for negRisk children fanned-out in /api/events/[id]. */
          parentEventId?: string;
          parentEventTitle?: string;
          /** Raw outcome labels (e.g. ["Mumbai Indians","Sunrisers Hyderabad"]). */
          rawOutcomes?: string[];
          /** Long-form rules text for the per-market About panel. */
          description?: string;
          /** Per-market resolution deadline (ISO). */
          endDate?: string;
          /** ISO timestamp the market opened. */
          createdAt?: string;
          /** Public canonical URL of the resolution source. */
          resolutionSource?: string;
          /** Resolver wallet address (Polygonscan-linkable). */
          resolvedBy?: string;
        }>,
      };
    }

    // Build market data - shared transformation for both trading and display
    const marketData = openMarkets.map((market, idx) => {
      const parsedMarket = getGammaYesNoMarketFields(market);
      const outcomes = parsedMarket.outcomes;
      const yesPrice = parsedMarket.yesPrice;
      const noPrice = parsedMarket.noPrice;

      const yesProbability = yesPrice
        ? Number.parseFloat((Number.parseFloat(yesPrice) * 100).toFixed(0))
        : 0;
      // Gamma's `oneDayPriceChange` is a fraction (0.05 = +5%). The outcome
      // table renders percentage-point moves.
      const hasOneDayPriceChange =
        typeof market.oneDayPriceChange === "number" &&
        Number.isFinite(market.oneDayPriceChange);
      const rawChange = hasOneDayPriceChange
        ? (market.oneDayPriceChange ?? 0)
        : 0;
      const change = toDisplayPercentagePointChange(rawChange);

      const rawMinSize = market.orderMinSize ?? market.order_min_size;
      const orderMinSize =
        typeof rawMinSize === "number"
          ? rawMinSize
          : Number.parseFloat(String(rawMinSize ?? "1")) || 1;

      return {
        id: market.id,
        conditionId: market.conditionId || "",
        question: market.question,
        groupItemTitle: getMarketShortLabel(market, event.title),
        yesProbability,
        yesPrice: yesPrice || "0",
        noPrice: noPrice || "0",
        yesTokenId: parsedMarket.yesTokenId,
        noTokenId: parsedMarket.noTokenId,
        negRisk: resolveNegRisk(market),
        orderMinSize,
        change,
        hasOneDayPriceChange,
        volume: market.volume || "0",
        color: CANDIDATE_PALETTE[idx % CANDIDATE_PALETTE.length],
        sportsMarketType: market.sportsMarketType,
        parentEventId:
          market.parentEventId !== undefined && market.parentEventId !== null
            ? String(market.parentEventId)
            : undefined,
        parentEventTitle: market.parentEventTitle,
        rawOutcomes: outcomes.length > 0 ? outcomes : undefined,
        description: market.description,
        endDate: market.endDate,
        createdAt: market.createdAt,
        resolutionSource: market.resolutionSource,
        resolvedBy: market.resolvedBy,
      };
    });

    const sortedMarketData = [...marketData].sort(
      (a, b) => b.yesProbability - a.yesProbability
    );

    const defaultSelectedMarket = isTeamMatchupEvent(event.teams)
      ? (sortedMarketData.find(
          (m) => (m.sportsMarketType ?? "").toLowerCase() === "moneyline"
        ) ??
        sortedMarketData.find((m) => m.question === event.title) ??
        sortedMarketData[0])
      : sortedMarketData[0];
    const selected =
      sortedMarketData.find((m) => m.id === selectedMarketId) ||
      defaultSelectedMarket;

    // Build trading outcomes
    const selectedOutcomeNames = selected?.rawOutcomes ?? [];
    const outcomes: OutcomeData[] = selected
      ? [
          {
            name: selectedOutcomeNames[0] || "Yes",
            tokenId: selected.yesTokenId,
            price: Number.parseFloat(selected.yesPrice) || 0.5,
            probability: (Number.parseFloat(selected.yesPrice) || 0.5) * 100,
          },
          {
            name: selectedOutcomeNames[1] || "No",
            tokenId: selected.noTokenId,
            price: Number.parseFloat(selected.noPrice) || 0.5,
            probability: (Number.parseFloat(selected.noPrice) || 0.5) * 100,
          },
        ]
      : [];

    const tokenId = outcomes[selectedOutcomeIndex]?.tokenId || "";

    // Build token to market mapping for comments position display.
    // For binary events (one market on the page, e.g. "Hantavirus
    // pandemic?") we leave marketName empty so the comment pill
    // falls back to the Yes/No outcome label and reads as the tight
    // "124 NO" form. For multi-outcome events (FIFA, elections —
    // multiple markets in the same group) we keep the short
    // `groupItemTitle` (e.g. "Arsenal") so users can tell which
    // option the position is on.
    const isMultiOutcomeEvent = marketData.length > 1;
    const tokenMap: TokenMarketMap = new Map();
    for (const market of marketData) {
      const marketName = isMultiOutcomeEvent
        ? market.groupItemTitle || market.question || ""
        : "";

      if (market.yesTokenId) {
        const yesOutcome = market.rawOutcomes?.[0] || "Yes";
        tokenMap.set(market.yesTokenId, {
          tokenId: market.yesTokenId,
          marketName,
          outcome: yesOutcome,
        });
      }
      if (market.noTokenId) {
        const noOutcome = market.rawOutcomes?.[1] || "No";
        tokenMap.set(market.noTokenId, {
          tokenId: market.noTokenId,
          marketName,
          outcome: noOutcome,
        });
      }
    }

    return {
      selectedMarket: selected,
      tradingOutcomes: outcomes,
      currentTokenId: tokenId,
      tokenMarketMap: tokenMap,
      sortedMarketData,
    };
  }, [event, openMarkets, selectedMarketId, selectedOutcomeIndex]);

  const tradingOutcomeQuoteKey = useOrderBookStore((state) =>
    staticTradingOutcomes
      .map((outcome) => {
        const lastTrade = outcome.tokenId
          ? state.lastTrades.get(outcome.tokenId)
          : undefined;
        const orderBook = outcome.tokenId
          ? state.orderBooks.get(outcome.tokenId)
          : undefined;

        return [
          outcome.tokenId,
          lastTrade?.price ?? "",
          orderBook?.midpoint ?? "",
          orderBook?.bestBid ?? "",
          orderBook?.bestAsk ?? "",
        ].join(":");
      })
      .join("|")
  );

  const tradingOutcomes = useMemo(() => {
    if (!tradingOutcomeQuoteKey) return staticTradingOutcomes;

    const quotesByTokenId = new Map<
      string,
      {
        lastTradePrice?: number | null;
        midpoint?: number | null;
        bestBid?: number | null;
        bestAsk?: number | null;
      }
    >();

    for (const entry of tradingOutcomeQuoteKey.split("|")) {
      const [tokenId, rawLastTrade, rawMidpoint, rawBestBid, rawBestAsk] =
        entry.split(":");
      if (!tokenId) continue;

      quotesByTokenId.set(tokenId, {
        lastTradePrice: Number.parseFloat(rawLastTrade ?? ""),
        midpoint: Number.parseFloat(rawMidpoint ?? ""),
        bestBid: Number.parseFloat(rawBestBid ?? ""),
        bestAsk: Number.parseFloat(rawBestAsk ?? ""),
      });
    }

    return applyLiveTradingOutcomeQuotes(
      staticTradingOutcomes,
      quotesByTokenId
    );
  }, [staticTradingOutcomes, tradingOutcomeQuoteKey]);

  // Bound WS scope to the market the user is actively inspecting/trading.
  // Table rows get their initial BID/ASK strip from REST hydration below; the
  // websocket takes over only after a market is selected or expanded.
  const websocketTokenIds = useMemo(() => {
    const tokenIds = new Set<string>();

    if (
      (selectedMarketId || isSingleMarketEvent) &&
      selectedMarket?.yesTokenId
    ) {
      tokenIds.add(selectedMarket.yesTokenId);
    }
    if (
      (selectedMarketId || isSingleMarketEvent) &&
      selectedMarket?.noTokenId
    ) {
      tokenIds.add(selectedMarket.noTokenId);
    }

    if (expandedOrderBookMarketId) {
      const expandedMarket = sortedMarketData.find(
        (m) => m.id === expandedOrderBookMarketId
      );
      if (expandedMarket?.yesTokenId) {
        tokenIds.add(expandedMarket.yesTokenId);
      }
      if (expandedMarket?.noTokenId) {
        tokenIds.add(expandedMarket.noTokenId);
      }
    }

    return Array.from(tokenIds);
  }, [
    sortedMarketData,
    selectedMarket,
    selectedMarketId,
    expandedOrderBookMarketId,
    isSingleMarketEvent,
  ]);

  // Enable price alert detection only for actively subscribed tokens.
  usePriceAlertDetection(websocketTokenIds);

  // Auto-expand the order book upfront when the event has exactly one market.
  useEffect(() => {
    if (!isSingleMarketEvent) return;
    const onlyMarketId = openMarkets[0]?.id;
    if (!onlyMarketId) return;

    setSelectedMarketId((prev) => prev || onlyMarketId);
    setExpandedOrderBookMarketId((prev) => prev ?? onlyMarketId);
  }, [isSingleMarketEvent, openMarkets]);

  // Sports detail pages should open on Polymarket's primary market, not on
  // whichever child has the highest YES price (for cricket that is often the
  // "Completed Match" side). Seed the selection state so the highlighted row,
  // websocket scope, and trading form all agree with the moneyline default.
  useEffect(() => {
    if (selectedMarketId || isSingleMarketEvent || !event) return;
    if (!isTeamMatchupEvent(event.teams)) return;

    const moneyline =
      openMarkets.find(
        (market) =>
          (market.sportsMarketType ?? "").toLowerCase() === "moneyline"
      ) ?? openMarkets.find((market) => market.question === event.title);

    if (moneyline?.id) {
      setSelectedMarketId(moneyline.id);
    }
  }, [event, isSingleMarketEvent, openMarkets, selectedMarketId]);

  // Preload Yes + No books whenever the selected market's tokens change —
  // this is what keeps the BID/ASK/SPREAD strip populated after a candidate
  // click. Without this preload, switching candidates made the strip flash
  // em-dashes until the trading-panel's own useQuery completed a round
  // trip. `preloadOrderBook` is React-Query deduped, so repeated calls are
  // cheap when the cache is already warm.
  const selectedYesTokenId = selectedMarket?.yesTokenId;
  const selectedNoTokenId = selectedMarket?.noTokenId;
  useEffect(() => {
    if (selectedYesTokenId) void preloadOrderBook(selectedYesTokenId);
    if (selectedNoTokenId) void preloadOrderBook(selectedNoTokenId);
  }, [selectedYesTokenId, selectedNoTokenId, preloadOrderBook]);

  // Seed the outcome-table inline quotes from REST before any row is clicked.
  // The websocket subscription below is intentionally narrower; it switches on
  // for the market the user selects or expands.
  const restQuoteTokenIds = useMemo(
    () => [
      ...new Set(
        sortedMarketData
          .slice(0, MAX_MARKETS_WITH_REST_QUOTES)
          .map((market) => market.yesTokenId)
          .filter((tokenId): tokenId is string => Boolean(tokenId))
      ),
    ],
    [sortedMarketData]
  );

  const earliestCreatedAt = useMemo(
    () =>
      openMarkets.reduce<string | undefined>((earliest, market) => {
        if (!market.createdAt) return earliest;
        if (!earliest) return market.createdAt;
        return new Date(market.createdAt) < new Date(earliest)
          ? market.createdAt
          : earliest;
      }, event?.createdAt),
    [event?.createdAt, openMarkets]
  );

  // Sports kickoff time. Each market on a sports event carries its own
  // `gameStartTime` — the earliest of those (or the event-level `startTime`)
  // is the actual game start. We surface this in the header instead of the
  // resolution `endDate`, which on Polymarket sits ~7 days after kickoff and
  // misled the UI into showing "MAY 6" for an Apr 29 game.
  const kickoffAt = useMemo(() => {
    let earliest: string | undefined = event?.startTime;
    for (const market of allMarkets) {
      const ts = market.gameStartTime;
      if (!ts) continue;
      const normalized =
        ts.includes("T") || ts.endsWith("Z") ? ts : ts.replace(" ", "T");
      const t = new Date(normalized).getTime();
      if (!Number.isFinite(t)) continue;
      if (!earliest || t < new Date(earliest).getTime()) {
        earliest = normalized;
      }
    }
    return earliest;
  }, [allMarkets, event?.startTime]);

  const chartRangeHistoryRequest = useMemo(
    () => getChartRangePriceHistoryRequest(chartTimeRange, earliestCreatedAt),
    [chartTimeRange, earliestCreatedAt]
  );

  const { data: chartRangePriceHistories } = useQuery({
    queryKey: [
      "priceHistory",
      "outcome-table",
      chartTimeRange,
      restQuoteTokenIds,
      chartRangeHistoryRequest.startTs,
      chartRangeHistoryRequest.fidelity,
    ],
    queryFn: () =>
      fetchPriceHistoryBatch(
        restQuoteTokenIds,
        chartRangeHistoryRequest.startTs,
        chartRangeHistoryRequest.fidelity
      ),
    enabled: restQuoteTokenIds.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const chartRangeChangeByTokenId = useMemo(() => {
    const map = new Map<string, number>();

    if (!chartRangePriceHistories) return map;

    const currentPriceByTokenId = new Map(
      sortedMarketData.map((market) => [
        market.yesTokenId,
        Number.parseFloat(market.yesPrice),
      ])
    );

    for (const entry of chartRangePriceHistories) {
      const history = entry.history || [];
      const reference = history.find((point) => Number.isFinite(point.p));
      const current = currentPriceByTokenId.get(entry.tokenId);

      if (!reference || !Number.isFinite(current)) continue;

      const change = toDisplayPercentagePointChange(
        (current ?? 0) - reference.p
      );
      map.set(entry.tokenId, change);
    }

    return map;
  }, [chartRangePriceHistories, sortedMarketData]);

  const sortedMarketDataWithChartRangeChange = useMemo(
    () =>
      sortedMarketData.map((market) => {
        const rangeChange = chartRangeChangeByTokenId.get(market.yesTokenId);
        return { ...market, change: rangeChange ?? 0 };
      }),
    [sortedMarketData, chartRangeChangeByTokenId]
  );

  const displayQuoteTokenIds = useMemo(
    () =>
      sortedMarketDataWithChartRangeChange
        .filter((market) => market.negRisk && market.yesTokenId)
        .map((market) => market.yesTokenId),
    [sortedMarketDataWithChartRangeChange]
  );
  const displayQuoteBestAskKey = useOrderBookStore((state) =>
    displayQuoteTokenIds
      .map((tokenId) => `${tokenId}:${state.orderBooks.get(tokenId)?.bestAsk}`)
      .join("|")
  );
  const displayQuoteBestAskByTokenId = useMemo(() => {
    const quotes = new Map<string, number | null>();
    if (!displayQuoteBestAskKey) return quotes;
    for (const entry of displayQuoteBestAskKey.split("|")) {
      const [tokenId, rawBestAsk] = entry.split(":");
      if (!tokenId) continue;
      const bestAsk = Number.parseFloat(rawBestAsk ?? "");
      quotes.set(tokenId, Number.isFinite(bestAsk) ? bestAsk : null);
    }
    return quotes;
  }, [displayQuoteBestAskKey]);
  const matchupMarketDataWithDisplayQuotes = useMemo(
    () =>
      sortedMarketDataWithChartRangeChange.map((market) => {
        if (!market.negRisk || !market.yesTokenId) return market;

        const bestAsk = displayQuoteBestAskByTokenId.get(market.yesTokenId);
        if (
          bestAsk === null ||
          bestAsk === undefined ||
          !Number.isFinite(bestAsk)
        ) {
          return market;
        }

        return {
          ...market,
          displayYesPrice: String(bestAsk),
        };
      }),
    [displayQuoteBestAskByTokenId, sortedMarketDataWithChartRangeChange]
  );

  useEffect(() => {
    if (restQuoteTokenIds.length === 0) return;

    let cancelled = false;

    const seedBooks = async () => {
      try {
        const books = await queryClient.fetchQuery<BookSnapshot[]>({
          queryKey: ["orderBooks", restQuoteTokenIds],
          queryFn: () => fetchBookSnapshots(restQuoteTokenIds),
          staleTime: 30_000,
        });

        if (cancelled) return;

        if (books.length === 0) {
          for (const tokenId of restQuoteTokenIds) {
            void preloadOrderBook(tokenId);
          }
          return;
        }

        const seededTokenIds = new Set<string>();
        for (const book of books) {
          const tokenId = book.asset_id;
          if (!tokenId) continue;
          const bids = book.bids || [];
          const asks = book.asks || [];
          if (bids.length === 0 && asks.length === 0) continue;
          seededTokenIds.add(tokenId);
          setOrderBookFromRest(tokenId, bids, asks);
        }

        for (const tokenId of restQuoteTokenIds) {
          if (!seededTokenIds.has(tokenId)) {
            void preloadOrderBook(tokenId);
          }
        }
      } catch (error) {
        log.error("orderbook.batch_preload_failed", { error });
        for (const tokenId of restQuoteTokenIds) {
          void preloadOrderBook(tokenId);
        }
      }
    };

    void seedBooks();

    return () => {
      cancelled = true;
    };
  }, [restQuoteTokenIds, queryClient, preloadOrderBook, setOrderBookFromRest]);

  // Pre-select market based on conditionId from URL (for "Modify Order" from sell modal)
  useEffect(() => {
    if (!urlConditionId || openMarkets.length === 0) return;

    // Find the market that matches the conditionId
    const matchingMarket = openMarkets.find(
      (market) => market.conditionId === urlConditionId
    );

    if (matchingMarket) {
      setSelectedMarketId(matchingMarket.id);
      setExpandedOrderBookMarketId(matchingMarket.id);
    }
  }, [urlConditionId, openMarkets]);

  // Set outcome index based on URL param (for "Modify Order" from sell modal).
  // Apply ONCE after tradingOutcomes is populated — re-running this effect on
  // every selectedOutcomeIndex change would fight the user, snapping their
  // Yes/No clicks back to whatever the URL says.
  const appliedUrlOutcomeRef = useRef(false);
  useEffect(() => {
    if (appliedUrlOutcomeRef.current) return;
    if (!initialOutcomeFromUrl || tradingOutcomes.length === 0) return;

    const outcomeIndex = findOutcomeIndexFromUrl(
      initialOutcomeFromUrl,
      tradingOutcomes,
      selectedMarket,
      event ?? null
    );
    if (outcomeIndex !== -1) {
      setSelectedOutcomeIndex(outcomeIndex);
    }
    appliedUrlOutcomeRef.current = true;
  }, [event, initialOutcomeFromUrl, selectedMarket, tradingOutcomes]);

  // ARCHITECTURE: REST first, then WebSocket for real-time updates
  // This is how Binance, Coinbase, and Polymarket work

  // STEP 1: Fetch initial order book snapshot directly from Polymarket CLOB API
  // Direct fetch is faster than going through our Next.js API route.
  //
  // NOTE: shared queryKey `["orderBook", tokenId]` — same as the <OrderBook>
  // component and the sell-position modal. React Query dedupes across all
  // concurrent consumers so the page + the orderbook panel + the sell modal
  // mounting together produces ONE /book request per token, not three. The
  // queryFn returns the richer shape (tick_size + min_order_size) so consumers
  // that need those fields still get them even when the shared cache entry
  // was seeded by another call site.
  const { data: orderBookData } =
    useQuery<TradingPanelOrderBookSnapshot | null>({
      queryKey: ["orderBook", currentTokenId],
      queryFn: async (): Promise<TradingPanelOrderBookSnapshot | null> => {
        if (!currentTokenId) return null;
        // Uses the shared V2→V1 fallback helper: during pre-cutover, V2
        // `/book` often returns empty levels even when the book has depth
        // on legacy. Without the fallback, switching candidates leaves
        // BID/ASK/SPREAD as em-dashes until the WebSocket catches up.
        const snapshot = await fetchBookSnapshot(currentTokenId);
        if (!snapshot) return null;
        return {
          bids: snapshot.bids,
          asks: snapshot.asks,
          min_order_size: snapshot.min_order_size || "1",
          tick_size: snapshot.tick_size || "0.01",
        };
      },
      enabled: !!currentTokenId,
      staleTime: 30000, // Consider fresh for 30s (WebSocket will update)
    });

  // STEP 2: Seed the store with REST data when it arrives.
  //
  // Guard: only seed if the REST response actually carries levels. CLOB V2
  // currently returns `{bids: [], asks: []}` for many of the tokens we care
  // about while the legacy CLOB (and the WebSocket feed, which mirrors it)
  // still carries the real book. Without the guard, switching candidates
  // and returning would re-seed the store with the empty V2 snapshot,
  // clobbering the real WS-delivered data and flashing em-dashes in the
  // BID/ASK/SPREAD strip until the next WS book event. Passing through
  // only non-empty snapshots means we never destructively overwrite good
  // data — empties are left alone for the WS feed to fill in.
  useEffect(() => {
    if (!orderBookData || !currentTokenId) return;
    const bids = orderBookData.bids || [];
    const asks = orderBookData.asks || [];
    if (bids.length === 0 && asks.length === 0) return;
    setOrderBookFromRest(currentTokenId, bids, asks);
  }, [orderBookData, currentTokenId, setOrderBookFromRest]);

  // STEP 3: Connect to shared WebSocket for real-time incremental updates
  // Uses singleton WebSocket manager - only ONE connection for all components
  const { connectionState, isConnected } =
    useOrderBookWebSocket(websocketTokenIds);

  // Get order book from store (seeded by REST, updated by WebSocket)
  const storeOrderBook = useOrderBookFromStore(currentTokenId);

  // Extract best bid, ask, tick_size, min_order_size, and full order book for slippage
  // Store has merged REST + WebSocket data
  const { bestBid, bestAsk, tickSize, minOrderSize, orderBook } =
    useMemo(() => {
      const marketMinOrderSize = selectedMarket?.orderMinSize ?? 1;

      // Use store data (seeded by REST, updated by WebSocket)
      if (storeOrderBook) {
        return {
          bestBid: storeOrderBook.bestBid ?? undefined,
          bestAsk: storeOrderBook.bestAsk ?? undefined,
          tickSize: 0.01, // Default tick size
          minOrderSize: marketMinOrderSize,
          orderBook: {
            bids: storeOrderBook.bids,
            asks: storeOrderBook.asks,
          },
        };
      }

      // Fall back to raw REST API data if store is empty
      if (!orderBookData) {
        return {
          bestBid: undefined,
          bestAsk: undefined,
          tickSize: 0.01,
          minOrderSize: marketMinOrderSize,
          orderBook: undefined,
        };
      }

      const bids = orderBookData.bids || [];
      const asks = orderBookData.asks || [];

      const sortedBids = [...bids].sort(
        (a, b) => Number.parseFloat(b.price) - Number.parseFloat(a.price)
      );
      const sortedAsks = [...asks].sort(
        (a, b) => Number.parseFloat(a.price) - Number.parseFloat(b.price)
      );

      const bestBidLevel = sortedBids.length > 0 ? sortedBids[0] : null;
      const bestAskLevel = sortedAsks.length > 0 ? sortedAsks[0] : null;

      const tickSizeValue = orderBookData.tick_size
        ? Number.parseFloat(orderBookData.tick_size)
        : 0.01;
      const bookMinOrderSizeValue = orderBookData.min_order_size
        ? Number.parseFloat(orderBookData.min_order_size)
        : 1;

      const minOrderSizeValue = Math.max(
        marketMinOrderSize,
        bookMinOrderSizeValue
      );

      return {
        bestBid: bestBidLevel
          ? Number.parseFloat(bestBidLevel.price)
          : undefined,
        bestAsk: bestAskLevel
          ? Number.parseFloat(bestAskLevel.price)
          : undefined,
        tickSize: tickSizeValue,
        minOrderSize: minOrderSizeValue,
        orderBook: { bids, asks },
      };
    }, [storeOrderBook, orderBookData, selectedMarket]);

  // Build closed market data for display (memoized to avoid recomputation)
  const closedMarketData = useMemo(
    () =>
      closedMarkets.map((market) => {
        const parsedMarket = getGammaYesNoMarketFields(market);
        const yesPrice = parsedMarket.yesPrice;
        const noPrice = parsedMarket.noPrice;

        const yesProbability = yesPrice
          ? Number.parseFloat((Number.parseFloat(yesPrice) * 100).toFixed(0))
          : 0;

        return {
          id: market.id,
          conditionId: market.conditionId || "",
          groupItemTitle: getMarketShortLabel(market, event?.title),
          yesProbability,
          yesPrice: yesPrice || "0",
          noPrice: noPrice || "0",
          yesTokenId: parsedMarket.yesTokenId,
          noTokenId: parsedMarket.noTokenId,
          change: 0,
          volume: market.volume || "0",
          closed: true,
        };
      }),
    [closedMarkets, event?.title]
  );

  // Loading state - AFTER all hooks
  if (loading) {
    return (
      <div className="kw-app min-h-screen bg-(--kwm-bg) relative overflow-x-clip selection:bg-(--kwm-ink)/15">
        <Navbar />
        <ChromeHeader />
        <main className="relative z-10 px-4 md:px-6 lg:px-8 py-8 space-y-8">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-96 w-full" />
        </main>
      </div>
    );
  }

  // Error state - AFTER all hooks
  if (error || !event) {
    return (
      <div className="kw-app min-h-screen bg-(--kwm-bg) relative overflow-x-clip selection:bg-(--kwm-ink)/15">
        <Navbar />
        <ChromeHeader />
        <main className="relative z-10 px-4 md:px-6 lg:px-8 py-6 space-y-8">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground flex-wrap">
            <button
              type="button"
              onClick={() => router.push("/markets")}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Markets</span>
            </button>
          </div>

          <div className="py-16 border-y border-border/40">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-4">
              §&nbsp;&nbsp;Not Found
            </p>
            <p className="kw-editorial italic text-2xl md:text-3xl leading-snug text-foreground max-w-xl mb-3">
              This event couldn&apos;t be loaded.
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80 mb-8">
              {error?.message || "Unable to load event"}
            </p>
            <button
              type="button"
              onClick={() => router.push("/markets")}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border hover:decoration-foreground/60"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Back to Markets</span>
            </button>
          </div>
        </main>
      </div>
    );
  }

  // sortedMarketData is already computed in the useMemo above

  // closedMarketData is now memoized above the early returns

  // Chart + ticker behavior:
  // - Single-market event: YES line (primary). NO is the secondary series
  //   that's revealed when the "Both" toggle is on.
  // - Sports matchup event (event.teams.length === 2): chart is locked to
  //   the moneyline market — two lines, one per team, colored with each
  //   team's brand color. Other markets (Toss Winner, Most Sixes, …) are
  //   reachable via the outcomes table below; they don't get plotted because
  //   their negRisk children would crowd the chart with unrelated YES/NO
  //   pairs.
  // - Multi-outcome non-sports event: top-5 candidate YES lines (primary),
  //   each in its own palette color so they're individually identifiable.
  //   Toggling "Both" adds the corresponding NO lines. The currently-selected
  //   candidate renders thicker than the rest so it stays findable. Capping
  //   at 5 keeps the chart legend readable and matches the ticker —
  //   lower-ranked markets stay visible in the outcomes table below.
  const chartMarket = selectedMarket ?? sortedMarketData[0];
  const topChartMarkets = sortedMarketData.slice(0, 5);
  const matchupChartColors = ensureReadableSeriesColors(
    [
      event.teams?.[0]?.color || CANDIDATE_PALETTE[0],
      "hsl(35, 92%, 50%)",
      event.teams?.[1]?.color || CANDIDATE_PALETTE[1],
    ],
    CANDIDATE_PALETTE
  );

  // Sports matchup detection — gated strictly on `event.teams` so non-sports
  // events fall through to the existing single/multi-candidate behavior.
  const matchupTeams = isTeamMatchupEvent(event.teams) ? event.teams : null;
  const isMatchup = !!matchupTeams;
  const matchupMoneylineMarkets = isMatchup
    ? sortedMarketData
        .filter((m) => (m.sportsMarketType ?? "").toLowerCase() === "moneyline")
        .sort(
          (a, b) =>
            matchupMoneylineRank(a.groupItemTitle, matchupTeams) -
            matchupMoneylineRank(b.groupItemTitle, matchupTeams)
        )
    : [];
  // Find the moneyline market for matchup events. Prefer the explicit
  // `sportsMarketType === "moneyline"` signal; fall back to whichever market
  // has the event title verbatim as its question (Polymarket's moneyline
  // markets share the parent event title without a " - " suffix).
  const moneylineMarket = isMatchup
    ? (matchupMoneylineMarkets[0] ??
      sortedMarketData.find((m) => m.sportsMarketType === "moneyline") ??
      sortedMarketData.find((m) => m.question === event.title) ??
      null)
    : null;
  const chartLockedToMoneyline = isMatchup && !!moneylineMarket;
  const chartUsesGroupedMoneyline =
    chartLockedToMoneyline && matchupMoneylineMarkets.length > 1;

  const marketTitles = chartLockedToMoneyline
    ? chartUsesGroupedMoneyline
      ? matchupMoneylineMarkets.map((m) =>
          matchupMoneylineLabel(m.groupItemTitle, matchupTeams)
        )
      : [
          event.teams?.[0]?.name.trim() ?? "Yes",
          event.teams?.[1]?.name.trim() ?? "No",
        ]
    : isSingleMarketEvent
      ? ["Yes", "No"]
      : topChartMarkets.map((m) => m.groupItemTitle);

  const yesProb = chartLockedToMoneyline
    ? chartUsesGroupedMoneyline
      ? matchupMoneylineMarkets.map((m) => m.yesPrice || "0")
      : [moneylineMarket?.yesPrice || "0", moneylineMarket?.noPrice || "0"]
    : isSingleMarketEvent
      ? [chartMarket?.yesPrice || "0", chartMarket?.noPrice || "0"]
      : topChartMarkets.map((m) => m.yesPrice);

  // Matchup events: both teams are PRIMARY lines (no secondary, no "Both"
  // toggle). The chart's secondary slot is normally for the NO mirror of a
  // YES line — but for moneyline the two outcomes already sum to ~100% so
  // they're independently meaningful, not a YES/NO mirror.
  const chartTokens = chartLockedToMoneyline
    ? chartUsesGroupedMoneyline
      ? matchupMoneylineMarkets.map((market, idx) => {
          const rank = matchupMoneylineRank(
            market.groupItemTitle,
            matchupTeams
          );
          return {
            tokenId: market.yesTokenId || "",
            name: matchupMoneylineLabel(market.groupItemTitle, matchupTeams),
            color:
              rank === 0
                ? matchupChartColors[0]
                : rank === 1
                  ? matchupChartColors[1]
                  : rank === 2
                    ? matchupChartColors[2]
                    : CANDIDATE_PALETTE[idx % CANDIDATE_PALETTE.length],
          };
        })
      : [
          {
            tokenId: moneylineMarket?.yesTokenId || "",
            name: event.teams?.[0]?.name.trim() ?? "Team A",
            // Use team brand color when available; fall back to the palette so
            // we never render a transparent line if upstream data is missing.
            color: matchupChartColors[0],
          },
          {
            tokenId: moneylineMarket?.noTokenId || "",
            name: event.teams?.[1]?.name.trim() ?? "Team B",
            color: matchupChartColors[2],
          },
        ]
    : isSingleMarketEvent
      ? [
          {
            tokenId: chartMarket?.yesTokenId || "",
            name: "Yes",
            color: "hsl(142, 76%, 36%)",
          },
        ]
      : topChartMarkets.map((m, idx) => ({
          tokenId: m.yesTokenId,
          name: m.groupItemTitle,
          color: CANDIDATE_PALETTE[idx % CANDIDATE_PALETTE.length],
        }));

  const chartSecondaryTokens = chartLockedToMoneyline
    ? []
    : isSingleMarketEvent
      ? [
          {
            tokenId: chartMarket?.noTokenId || "",
            name: "No",
            color: "hsl(0, 84%, 60%)",
          },
        ]
      : topChartMarkets.map((m, idx) => ({
          tokenId: m.noTokenId,
          name: `${m.groupItemTitle} · No`,
          // Dim the NO lines to a muted variant of the YES hue so they
          // visually group with their YES counterpart without competing.
          color: CANDIDATE_PALETTE[idx % CANDIDATE_PALETTE.length]
            .replace("hsl(", "hsla(")
            .replace(/%\)$/, "%, 0.45)"),
        }));

  const chartActiveTokenId = chartLockedToMoneyline
    ? chartUsesGroupedMoneyline
      ? (matchupMoneylineMarkets.find((m) => m.id === selectedMarketId)
          ?.yesTokenId ?? moneylineMarket?.yesTokenId)
      : moneylineMarket?.yesTokenId
    : isSingleMarketEvent
      ? chartMarket?.yesTokenId
      : chartMarket?.yesTokenId;
  const sportsRailActiveSlug = isTeamMatchupEvent(event.teams)
    ? getSportsRailActiveSlug(event)
    : undefined;
  const showSportsRail = Boolean(sportsRailActiveSlug);

  return (
    <div className="kw-app min-h-screen bg-(--kwm-bg) relative selection:bg-(--kwm-ink)/15">
      <Navbar />
      <ChromeHeader />
      <main className="relative z-10 px-4 md:px-6 lg:px-8 py-6 min-h-screen">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
              } else {
                router.push("/markets");
              }
            }}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Back</span>
          </button>
          <span>/</span>
          <span className="text-foreground font-medium truncate max-w-[200px] sm:max-w-none">
            {event.title}
          </span>
        </div>

        {showSportsRail && (
          <div className="mb-4 lg:hidden">
            <LeagueRailMobile activeSlug={sportsRailActiveSlug} />
          </div>
        )}

        <div
          className={
            showSportsRail
              ? "grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]"
              : undefined
          }
        >
          {showSportsRail && (
            <div className="hidden lg:block">
              <div className="sticky top-4 self-start">
                <LeagueRail activeSlug={sportsRailActiveSlug} />
              </div>
            </div>
          )}

          <div className={showSportsRail ? "min-w-0" : undefined}>
            {/* Header Section */}
            <HeaderSection
              event={event}
              kickoffAt={kickoffAt}
              isScrolled={isScrolled}
              formatVolume={formatVolume}
              totalMarketsCount={totalMarketsCount}
              openMarkets={openMarkets}
              closedMarkets={closedMarkets}
            />

            {/* Main Content: Chart + Trading Panel */}
            <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3 lg:items-start">
              {/* Left Column: Chart + Outcomes Table */}
              <div className="lg:col-span-2 space-y-4 sm:space-y-6">
                {/* Team-vs-team matchup hero — sports events only. Lives inside
                the chart column (not the page-wide HeaderSection) so the
                sticky trading panel on the right can rise to its
                `lg:top-20` slot instead of being shoved down by a
                full-width hero. */}
                {isTeamMatchupEvent(event.teams) && (
                  <TeamMatchupHero
                    teams={event.teams}
                    kickoffAt={kickoffAt}
                    score={displayLiveGame?.score ?? event.score}
                    period={displayLiveGame?.period ?? event.period}
                    elapsed={displayLiveGame?.elapsed ?? event.elapsed}
                  />
                )}

                {/* Multi-outcome only: horizontal candidate ticker. Clicking a
                candidate selects that market and re-renders the chart /
                trading panel / stats strip below.
                Hidden for sports matchup events because the chart is locked
                to the moneyline and a candidate-driven chart selector would
                no longer match what the chart actually shows. The outcomes
                table below still drives trading-panel selection. */}
                {!isSingleMarketEvent &&
                  !chartLockedToMoneyline &&
                  (topChartMarkets.length >= 3 ? (
                    /* New: Field tiles — only when the event has enough
                       contenders for the grid to read as a "field". We
                       re-assign palette colors here based on the
                       *displayed* (post-sort) rank so a tile's color
                       matches its chart-line color, which the chart
                       also picks by post-sort index. */
                    <FieldTiles
                      markets={topChartMarkets.map((m, idx) => ({
                        ...m,
                        color:
                          CANDIDATE_PALETTE[idx % CANDIDATE_PALETTE.length],
                      }))}
                      selectedMarketId={selectedMarket?.id ?? ""}
                      onSelectMarket={setSelectedMarketId}
                      totalOutcomes={openMarkets.length}
                      isLive={isConnected}
                    />
                  ) : (
                    /* Fall back to the horizontal candidate ticker for 2-
                       outcome non-binary events, where a 2-tile grid
                       would look sparse. */
                    <CandidateTicker
                      markets={topChartMarkets}
                      selectedMarketId={selectedMarket?.id ?? ""}
                      onSelectMarket={setSelectedMarketId}
                    />
                  ))}

                {/* Chart */}
                <Card>
                  {/* Legend is now rendered as a floating overlay inside the
                  MarketPriceChart itself — dropping the CardHeader saves
                  the ~48px of vertical padding that used to sit above the
                  plot. */}
                  <CardContent className="py-3">
                    <ErrorBoundary name="Market Price Chart">
                      <MarketPriceChart
                        tokens={chartTokens}
                        secondaryTokens={chartSecondaryTokens}
                        activeTokenId={chartActiveTokenId}
                        outcomes={marketTitles}
                        outcomePrices={yesProb}
                        startDate={earliestCreatedAt}
                        timeRange={chartTimeRange}
                        onTimeRangeChange={handleChartTimeRangeChange}
                        // Matchup events plot both team lines as primaries, so
                        // the "Both" toggle has nothing to reveal.
                        hideBothToggle={chartLockedToMoneyline}
                      />
                    </ErrorBoundary>
                  </CardContent>
                </Card>

                <ErrorBoundary name="Outcomes Table">
                  {isMatchup && event.teams ? (
                    // Sports matchup events get the Polymarket-style grouped
                    // outcomes layout. Other event shapes fall through to the
                    // generic flat-row OutcomesTable below — gating on `isMatchup`
                    // ensures non-sports markets are never rendered with team
                    // assumptions baked in.
                    <MatchupOutcomes
                      markets={matchupMarketDataWithDisplayQuotes}
                      teams={
                        event.teams as [
                          (typeof event.teams)[0],
                          (typeof event.teams)[1],
                        ]
                      }
                      eventTitle={event.title}
                      selectedMarketId={selectedMarketId}
                      selectedOutcomeIndex={selectedOutcomeIndex}
                      onSelect={(marketId, outcomeIndex) => {
                        setSelectedMarketId(marketId);
                        setSelectedOutcomeIndex(outcomeIndex);
                      }}
                    />
                  ) : (
                    <OutcomesTable
                      sortedMarketData={sortedMarketDataWithChartRangeChange}
                      closedMarkets={closedMarketData}
                      changeLabel={chartTimeRange}
                      isOutcomeTableExpanded={isOutcomeTableExpanded}
                      setIsOutcomeTableExpanded={setIsOutcomeTableExpanded}
                      isConnected={isConnected}
                      connectionState={connectionState}
                      expandedOrderBookMarketId={expandedOrderBookMarketId}
                      setExpandedOrderBookMarketId={
                        setExpandedOrderBookMarketId
                      }
                      selectedMarketId={selectedMarketId}
                      setSelectedMarketId={setSelectedMarketId}
                      selectedOutcomeIndex={selectedOutcomeIndex}
                      setSelectedOutcomeIndex={setSelectedOutcomeIndex}
                      preloadOrderBook={preloadOrderBook}
                      getMarketPositions={getMarketPositions}
                      handlePriceClick={handlePriceClick}
                      isSingleMarketEvent={isSingleMarketEvent}
                      onSellSuccess={handleSellSuccess}
                    />
                  )}
                </ErrorBoundary>
              </div>

              {/* Trading Panel - Sticky on desktop, spans both rows so it sticks alongside comments too */}
              <div className="lg:col-span-1 lg:row-span-2 lg:sticky lg:top-20 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
                {selectedMarket && tradingOutcomes.length > 0 && (
                  <ErrorBoundary name="Trading Form">
                    <TradingForm
                      marketTitle={
                        selectedMarket.sportsMarketType === "moneyline"
                          ? event.title
                          : selectedMarket.groupItemTitle || event.title
                      }
                      tokenId={
                        tradingOutcomes[selectedOutcomeIndex]?.tokenId || ""
                      }
                      outcomes={tradingOutcomes}
                      selectedOutcomeIndex={selectedOutcomeIndex}
                      onOutcomeChange={setSelectedOutcomeIndex}
                      negRisk={resolveNegRisk(selectedMarket, event)}
                      tickSize={tickSize}
                      minOrderSize={minOrderSize}
                      bestBid={bestBid}
                      bestAsk={bestAsk}
                      orderBook={orderBook}
                      maxSlippagePercent={2}
                      onOrderSuccess={handleOrderSuccess}
                      onOrderError={handleOrderError}
                      marketImage={event?.image}
                      yesProbability={
                        isMatchup ? undefined : selectedMarket.yesProbability
                      }
                      isLiveData={isConnected}
                      initialSide={initialSide}
                      initialShares={initialShares}
                      conditionId={selectedMarket.conditionId}
                      disableSticky
                    />
                  </ErrorBoundary>
                )}
              </div>

              {/* Comments Section - appears after trading form on mobile, below outcomes on desktop */}
              {event?.id && (
                <div className="lg:col-span-2">
                  <ErrorBoundary name="Comments Section">
                    <CommentsSection
                      eventId={Number.parseInt(event.id, 10)}
                      variant="card"
                      tokenMarketMap={tokenMarketMap}
                    />
                  </ErrorBoundary>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
