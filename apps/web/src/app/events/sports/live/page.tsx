"use client";

import {
  parseGammaStringArray,
  resolveNegRisk,
} from "@knoww/shared-types/polymarket";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChromeHeader } from "@/components/app-layout";
import { EditorialFooter } from "@/components/editorial-footer";
import {
  EditorialHero,
  HeroLiveDot,
  HeroRefreshButton,
} from "@/components/editorial-hero";
import { ErrorBoundary } from "@/components/error-boundary";
import { LeagueRail, LeagueRailMobile } from "@/components/league-rail";
import {
  buildSelectedMarket,
  findMoneyline,
  LiveSportsbook,
  ScheduledSportsbook,
  type SelectedMarketInfo,
} from "@/components/live-sportsbook";
import { MarketSearch } from "@/components/market-search";
import { Navbar } from "@/components/navbar";
import { Skeleton } from "@/components/ui/skeleton";
import { useBestPrices, useOrderBookStore } from "@/hooks/use-orderbook-store";
import { usePaginatedEvents } from "@/hooks/use-paginated-events";
import { useOrderBookWebSocket } from "@/hooks/use-shared-websocket";
import {
  type LiveGameState,
  useSportsWebSocket,
} from "@/hooks/use-sports-websocket";
import { SPORT_GROUPS } from "@/lib/sport-categories";
import { getSportRailOpenGroupSlugsFromEvents } from "@/lib/sport-rail-open-groups";
import {
  getInitialCompanionMarketSlugs,
  shouldFetchScheduledSportsFallback,
} from "@/lib/sports-live-request-plan";

const TradingForm = dynamic(
  () =>
    import("@/components/trading-form").then((mod) => ({
      default: mod.TradingForm,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full">
        <Skeleton className="h-[350px] w-full" />
      </div>
    ),
  }
);

interface EventWithDates {
  id: string;
  title: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  live?: boolean;
  ended?: boolean;
  startDate?: string;
  startTime?: string;
  markets?: Array<{
    gameStartTime?: string;
    groupItemTitle?: string;
    question?: string;
    sportsMarketType?: string;
  }>;
}

const MAX_INITIAL_COMPANION_MARKET_FETCHES = 0;
const AUTO_SELECT_INITIAL_MARKET = false;
const LIVE_MARKET_REFETCH_INTERVAL_MS = 30_000;
const RECENTLY_STARTED_EVENT_WINDOW_MS = 8 * 60 * 60 * 1000;

// ── Event-to-game matching ──────────────────────────────────────────

function extractDateFromGameSlug(slug: string): string | null {
  const match = slug.match(/(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : null;
}

function areDatesClose(date1: string, date2: string): boolean {
  const d1 = new Date(date1).getTime();
  const d2 = new Date(date2).getTime();
  if (Number.isNaN(d1) || Number.isNaN(d2)) return false;
  return Math.abs(d1 - d2) <= 86_400_000;
}

function parseGammaDate(input?: string): Date | null {
  if (!input) return null;
  const normalized =
    input.includes("T") || input.endsWith("Z")
      ? input
      : input.replace(" ", "T");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getEventKickoffMs(event: EventWithDates): number {
  const eventKickoff = parseGammaDate(event.startTime);
  if (eventKickoff) return eventKickoff.getTime();

  let earliest: number | null = null;
  for (const market of event.markets ?? []) {
    const marketKickoff = parseGammaDate(market.gameStartTime);
    if (!marketKickoff) continue;
    if (earliest === null || marketKickoff.getTime() < earliest) {
      earliest = marketKickoff.getTime();
    }
  }
  if (earliest !== null) return earliest;

  return parseGammaDate(event.startDate)?.getTime() ?? Number.NaN;
}

function extractDateOnly(input?: string): string | null {
  if (!input) return null;
  return input.split(/[T ]/)[0] || null;
}

function getEventKickoffDate(event: EventWithDates): string | null {
  const eventDate = extractDateOnly(event.startTime);
  if (eventDate) return eventDate;

  for (const market of event.markets ?? []) {
    const marketDate = extractDateOnly(market.gameStartTime);
    if (marketDate) return marketDate;
  }

  return extractDateOnly(event.startDate);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function teamsFoundIn(text: string, home: string, away: string): boolean {
  const t = text.toLowerCase();
  const check = (team: string) => {
    const lc = team.toLowerCase();
    return lc.length <= 3
      ? new RegExp(`\\b${escapeRegExp(lc)}\\b`).test(t)
      : t.includes(lc);
  };
  return check(home) && check(away);
}

function matchEventToGame(
  event: EventWithDates,
  games: Map<string, LiveGameState>
): LiveGameState | null {
  if (games.size === 0) return null;
  const titleLower = (event.title || "").toLowerCase();
  const slugLower = (event.slug || "").toLowerCase();
  const eventDate = getEventKickoffDate(event);

  let bestMatch: LiveGameState | null = null;
  let bestScore = -1;

  for (const game of games.values()) {
    if (!game.homeTeam || !game.awayTeam) continue;
    const inTitle = teamsFoundIn(titleLower, game.homeTeam, game.awayTeam);
    const inSlug = teamsFoundIn(slugLower, game.homeTeam, game.awayTeam);
    if (!inTitle && !inSlug) continue;

    const league = game.leagueAbbreviation?.toLowerCase();
    const gameDate =
      extractDateFromGameSlug(game.slug ?? "") ??
      game.updatedAt?.split("T")[0] ??
      null;
    const dateMatch =
      gameDate && eventDate && areDatesClose(gameDate, eventDate);
    if (gameDate && eventDate && !dateMatch) continue;

    const leagueMatch =
      league && (titleLower.includes(league) || slugLower.includes(league));

    let score = 0;
    if (dateMatch) score += 10;
    if (leagueMatch) score += 5;
    if (inTitle && inSlug) score += 3;
    else if (inTitle) score += 2;
    else score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = game;
    }
  }
  return bestMatch;
}

function timeAgo(ts: number | null): string {
  if (!ts) return "";
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function parseStringArray(input?: string): string[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizePrice(price: number): number {
  if (!Number.isFinite(price)) return 0;
  return Math.max(0, Math.min(1, price));
}

export default function LiveMarketsPage() {
  const [selectedMarket, setSelectedMarket] =
    useState<SelectedMarketInfo | null>(null);
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState(0);

  const { connectionState, isConnected, games, lastMessageAt, reconnect } =
    useSportsWebSocket({
      enabled: true,
    });

  const {
    data: paginatedData,
    error,
    isLoading,
  } = usePaginatedEvents({
    limit: 50,
    order: "volume24hr",
    ascending: false,
    closed: false,
    tagSlug: "sports",
    filters: { live: true },
    refetchInterval: LIVE_MARKET_REFETCH_INTERVAL_MS,
    fullMarkets: true,
  });

  const rawEventsBase = useMemo(
    () => paginatedData?.pages.flatMap((page) => page.events || page) || [],
    [paginatedData]
  );

  const shouldFetchScheduledSports = shouldFetchScheduledSportsFallback({
    liveQueryLoading: isLoading,
    liveEventCount: rawEventsBase.length,
  });

  const {
    data: scheduledData,
    error: scheduledError,
    isLoading: scheduledLoading,
  } = usePaginatedEvents({
    limit: 50,
    order: "volume24hr",
    ascending: false,
    closed: false,
    tagSlug: "sports",
    enabled: shouldFetchScheduledSports,
    fullMarkets: true,
  });

  const allSportsEventsBase = useMemo(
    () => scheduledData?.pages.flatMap((page) => page.events || page) || [],
    [scheduledData]
  );

  const recentlyStartedEventsBase = useMemo(() => {
    const now = Date.now();
    const liveIds = new Set(rawEventsBase.map((e) => e.id));

    return allSportsEventsBase.filter((event) => {
      if (liveIds.has(event.id)) return false;
      if (event.closed || event.live || event.ended) return false;

      const startMs = getEventKickoffMs(event);
      if (Number.isNaN(startMs)) return false;

      const elapsedMs = now - startMs;
      return elapsedMs >= 0 && elapsedMs < RECENTLY_STARTED_EVENT_WINDOW_MS;
    });
  }, [allSportsEventsBase, rawEventsBase]);

  const scheduledEventsBase = useMemo(() => {
    const now = Date.now();
    const liveIds = new Set([
      ...rawEventsBase.map((e) => e.id),
      ...recentlyStartedEventsBase.map((e) => e.id),
    ]);
    return allSportsEventsBase.filter((event) => {
      if (liveIds.has(event.id)) return false;
      if (event.closed || event.live || event.ended) return false;

      const startMs = getEventKickoffMs(event);
      if (Number.isNaN(startMs)) return false;
      return startMs > now && startMs - now < 48 * 60 * 60 * 1000;
    });
  }, [allSportsEventsBase, rawEventsBase, recentlyStartedEventsBase]);

  // ── Companion "More Markets" enrichment ─────────────────────────
  const companionSlugs = useMemo(() => {
    const all = [...rawEventsBase, ...scheduledEventsBase];
    return getInitialCompanionMarketSlugs(
      all,
      MAX_INITIAL_COMPANION_MARKET_FETCHES
    );
  }, [rawEventsBase, scheduledEventsBase]);

  const stableCompanionKey = useMemo(
    () => companionSlugs.slice().sort().join(","),
    [companionSlugs]
  );

  const { data: companionMarketMap } = useQuery({
    queryKey: ["companion-markets", stableCompanionKey],
    queryFn: async () => {
      if (!companionSlugs.length) return {};
      const results = await Promise.allSettled(
        companionSlugs.map(async (slug) => {
          const res = await fetch(`/api/events/${slug}`);
          if (!res.ok) return null;
          const data = (await res.json()) as {
            success: boolean;
            event?: { markets?: Array<Record<string, unknown>> };
          };
          if (!data.success || !data.event?.markets) return null;
          return {
            slug,
            markets: data.event.markets.map((m) => ({
              id: m.id as string,
              question: m.question as string | undefined,
              outcomes:
                typeof m.outcomes === "string"
                  ? m.outcomes
                  : JSON.stringify(m.outcomes ?? []),
              outcomePrices:
                typeof m.outcomePrices === "string"
                  ? m.outcomePrices
                  : JSON.stringify(m.outcomePrices ?? []),
              groupItemTitle: m.groupItemTitle as string | undefined,
              image: m.image as string | undefined,
              icon: m.icon as string | undefined,
              clobTokenIds: parseGammaStringArray(
                m.clobTokenIds as string | string[] | undefined
              ),
              conditionId: m.conditionId as string | undefined,
              gameStartTime: m.gameStartTime as string | undefined,
            })),
          };
        })
      );
      const map: Record<string, (typeof rawEventsBase)[0]["markets"]> = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          const parentSlug = r.value.slug.replace("-more-markets", "");
          map[parentSlug] = r.value.markets;
        }
      }
      return map;
    },
    enabled: companionSlugs.length > 0,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });

  const rawEvents = useMemo(() => {
    const seen = new Set<string>();
    const base = [...rawEventsBase, ...recentlyStartedEventsBase].filter(
      (e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return !e.title.toLowerCase().includes("more markets");
      }
    );
    if (!companionMarketMap) return base;
    return base.map((e) => {
      const extra = e.slug ? companionMarketMap[e.slug] : undefined;
      if (!extra?.length) return e;
      const tagged = extra.map((m) => ({
        ...m,
        _companionSlug: `${e.slug}-more-markets`,
      }));
      return { ...e, markets: [...(e.markets || []), ...tagged] };
    });
  }, [rawEventsBase, companionMarketMap, recentlyStartedEventsBase]);

  const scheduledEvents = useMemo(() => {
    const base = scheduledEventsBase.filter(
      (e) => !e.title.toLowerCase().includes("more markets")
    );
    if (!companionMarketMap) return base;
    return base.map((e) => {
      const extra = e.slug ? companionMarketMap[e.slug] : undefined;
      if (!extra?.length) return e;
      const tagged = extra.map((m) => ({
        ...m,
        _companionSlug: `${e.slug}-more-markets`,
      }));
      return { ...e, markets: [...(e.markets || []), ...tagged] };
    });
  }, [scheduledEventsBase, companionMarketMap]);

  const eventGameMap = useMemo(() => {
    const map = new Map<string, LiveGameState | null>();
    for (const event of rawEvents) {
      map.set(event.id, matchEventToGame(event, games));
    }
    for (const event of scheduledEvents) {
      map.set(event.id, matchEventToGame(event, games));
    }
    return map;
  }, [rawEvents, scheduledEvents, games]);

  const liveEventCount = rawEvents.length;
  const scheduledEventCount = scheduledEvents.length;
  const liveRailOpenGroupSlugs = useMemo(
    () => getSportRailOpenGroupSlugsFromEvents(rawEvents, SPORT_GROUPS),
    [rawEvents]
  );

  const selectedTokenIds = useMemo(() => {
    if (!selectedMarket) return [];
    return selectedMarket.outcomes.map((o) => o.tokenId).filter(Boolean);
  }, [selectedMarket]);

  useOrderBookWebSocket(selectedTokenIds);

  const selectedTokenId =
    selectedMarket?.outcomes[selectedOutcomeIndex]?.tokenId || "";
  const { bestBid, bestAsk } = useBestPrices(selectedTokenId || undefined);
  const orderBooks = useOrderBookStore((s) => s.orderBooks);
  const lastTrades = useOrderBookStore((s) => s.lastTrades);

  const userClosedPanel = useRef(false);

  const handleMarketSelect = useCallback(
    (market: SelectedMarketInfo, outcomeIndex: number) => {
      userClosedPanel.current = false;
      setSelectedMarket(market);
      setSelectedOutcomeIndex(outcomeIndex);
    },
    []
  );

  const handleCloseTradePanel = useCallback(() => {
    userClosedPanel.current = true;
    setSelectedMarket(null);
  }, []);

  useEffect(() => {
    if (!AUTO_SELECT_INITIAL_MARKET) return;
    if (selectedMarket || userClosedPanel.current) return;
    const firstEvent = rawEvents[0] || scheduledEvents[0];
    if (!firstEvent?.markets?.length) return;
    const moneyline = findMoneyline(firstEvent.markets);
    const targetMarket = moneyline?.market ?? firstEvent.markets[0];
    const { info } = buildSelectedMarket(firstEvent, targetMarket);
    if (info.outcomes.length >= 2 && info.outcomes.some((o) => o.tokenId)) {
      setSelectedMarket(info);
      setSelectedOutcomeIndex(0);
    }
  }, [rawEvents, scheduledEvents, selectedMarket]);

  useEffect(() => {
    if (!selectedMarket) return;

    const allEvents = [...rawEvents, ...scheduledEvents];
    const event = allEvents.find((e) => e.id === selectedMarket.eventId);
    if (!event) return;

    const market = event.markets?.find((m) => m.id === selectedMarket.marketId);
    if (!market) return;

    const rawOutcomeNames = parseStringArray(market.outcomes);
    const outcomePrices = parseStringArray(market.outcomePrices).map(Number);
    const tokenIds = market.clobTokenIds || [];

    const refreshedOutcomes = rawOutcomeNames
      .map((name, i) => ({
        name,
        tokenId: tokenIds[i] || "",
        price: outcomePrices[i] ?? 0,
        probability: Math.round((outcomePrices[i] ?? 0) * 100),
      }))
      .filter((o) => o.tokenId);

    const companionSlug =
      "_companionSlug" in market
        ? (market as { _companionSlug: string })._companionSlug
        : undefined;

    const nextSelectedMarket: SelectedMarketInfo = {
      ...selectedMarket,
      eventSlug: companionSlug || event.slug,
      eventTitle: event.title,
      marketTitle: market.groupItemTitle || market.question || event.title,
      marketImage: market.image ?? market.icon ?? event.image,
      outcomes: refreshedOutcomes,
      conditionId: market.conditionId,
      negRisk: resolveNegRisk(event),
    };

    const isSame =
      (nextSelectedMarket.eventSlug ?? "") ===
        (selectedMarket.eventSlug ?? "") &&
      nextSelectedMarket.marketTitle === selectedMarket.marketTitle &&
      nextSelectedMarket.marketImage === selectedMarket.marketImage &&
      nextSelectedMarket.conditionId === selectedMarket.conditionId &&
      nextSelectedMarket.negRisk === selectedMarket.negRisk &&
      nextSelectedMarket.outcomes.length === selectedMarket.outcomes.length &&
      nextSelectedMarket.outcomes.every((outcome, idx) => {
        const current = selectedMarket.outcomes[idx];
        return (
          outcome.name === current?.name &&
          outcome.tokenId === current?.tokenId &&
          outcome.price === current?.price &&
          outcome.probability === current?.probability
        );
      });

    if (!isSame) {
      setSelectedMarket(nextSelectedMarket);
    }
  }, [rawEvents, scheduledEvents, selectedMarket]);

  const tradingOutcomes = useMemo(() => {
    if (!selectedMarket) return [];
    return selectedMarket.outcomes.map((o) => {
      const lastTrade = lastTrades.get(o.tokenId);
      const orderBook = orderBooks.get(o.tokenId);
      const livePrice =
        lastTrade?.price ??
        orderBook?.midpoint ??
        orderBook?.bestBid ??
        orderBook?.bestAsk;
      const price = normalizePrice(livePrice ?? o.price);
      return {
        name: o.name,
        tokenId: o.tokenId,
        price,
        probability: Math.round(price * 100),
      };
    });
  }, [selectedMarket, orderBooks, lastTrades]);

  const feedLabel = isConnected
    ? "Live Feed"
    : connectionState === "reconnecting"
      ? "Reconnecting"
      : "Offline";

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-x-clip selection:bg-foreground/15">
      <Navbar />
      <ChromeHeader />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-24 xl:pb-12">
        <EditorialHero
          breadcrumbs={[
            { label: "Markets", href: "/markets" },
            { label: "Live" },
          ]}
          title="Sports Live"
          belowSlot={
            <div className="mt-5 flex items-center gap-3">
              <MarketSearch
                className="w-full sm:max-w-sm"
                tagSlug="sports"
                tagLabel="Sports"
                placeholder="Search sports..."
              />
            </div>
          }
          rightSlot={
            <>
              <HeroLiveDot
                isLive={isConnected}
                liveLabel={feedLabel}
                offlineLabel={feedLabel}
              />
              {lastMessageAt && (
                <span className="text-muted-foreground tabular-nums">
                  · {timeAgo(lastMessageAt)}
                </span>
              )}
              <HeroRefreshButton
                onRefresh={reconnect}
                isFetching={connectionState === "reconnecting"}
                label="Reconnect"
              />
            </>
          }
        />

        {/* Mobile-only league picker — full rail lives in the left column at lg+ */}
        <div className="lg:hidden mb-4">
          <LeagueRailMobile />
        </div>

        {/* Three-column layout at lg+: Rail | Sportsbook | Trade Panel.
            On smaller widths the rail collapses to the dropdown above. */}
        <div className="grid min-w-0 items-start gap-6 lg:gap-6 lg:grid-cols-[220px_minmax(0,1fr)_400px] xl:gap-8 xl:grid-cols-[240px_minmax(0,1fr)_440px]">
          {/* Left: League rail (sticky under header) */}
          <div className="hidden lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
            <LeagueRail
              defaultOpenGroupSlugs={liveRailOpenGroupSlugs}
              countsEnabled={false}
            />
          </div>

          {/* Left: Sportsbook */}
          <AnimatePresence mode="wait">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="min-w-0"
            >
              {/* Error */}
              {error && (
                <div className="border-l-2 border-red-600 dark:border-red-400 pl-3 py-2 mb-6">
                  <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-red-600 dark:text-red-400 mb-1">
                    Feed Error
                  </p>
                  <p className="text-sm text-foreground leading-snug">
                    {error?.message || "Unable to load live markets"}
                  </p>
                </div>
              )}

              {/* Loading skeleton */}
              {!error && isLoading && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Skeleton className="w-8 h-8" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              )}

              {/* Live events */}
              {!error && !isLoading && liveEventCount > 0 && (
                <LiveSportsbook
                  events={rawEvents}
                  eventGameMap={eventGameMap}
                  onMarketSelect={handleMarketSelect}
                  selectedMarketId={selectedMarket?.marketId}
                  selectedOutcomeTokenId={selectedTokenId || undefined}
                />
              )}

              {/* No live events */}
              {!error && !isLoading && liveEventCount === 0 && (
                <div className="py-16 text-center border-y border-border/40">
                  <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted-foreground/90 mb-3">
                    No Live Events
                  </p>
                  <p className="font-editorial italic text-xl text-foreground max-w-md mx-auto leading-snug">
                    Nothing live right now.
                  </p>
                  <p className="text-sm text-muted-foreground mt-3 max-w-md mx-auto">
                    Check back when games tip off, or browse the upcoming
                    schedule below.
                  </p>
                </div>
              )}

              {/* Scheduled section */}
              {!scheduledError && scheduledLoading && !isLoading && (
                <div className="mt-8 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              )}

              {!scheduledError &&
                !scheduledLoading &&
                scheduledEventCount > 0 && (
                  <div className="mt-10">
                    <ScheduledSportsbook
                      events={scheduledEvents}
                      eventGameMap={eventGameMap}
                      onMarketSelect={handleMarketSelect}
                      selectedMarketId={selectedMarket?.marketId}
                      selectedOutcomeTokenId={selectedTokenId || undefined}
                    />
                  </div>
                )}
            </motion.div>
          </AnimatePresence>

          {/* Right: Trade Panel — sticky sidebar */}
          <div className="hidden min-w-0 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
            {selectedMarket && tradingOutcomes.length > 0 ? (
              <ErrorBoundary name="Trading Form">
                <TradingForm
                  marketTitle={selectedMarket.marketTitle}
                  tokenId={tradingOutcomes[selectedOutcomeIndex]?.tokenId || ""}
                  outcomes={tradingOutcomes}
                  selectedOutcomeIndex={selectedOutcomeIndex}
                  onOutcomeChange={setSelectedOutcomeIndex}
                  conditionId={selectedMarket.conditionId}
                  marketImage={selectedMarket.marketImage}
                  yesProbability={tradingOutcomes[0]?.probability}
                  bestBid={bestBid ?? undefined}
                  bestAsk={bestAsk ?? undefined}
                  orderBook={
                    selectedTokenId
                      ? (orderBooks.get(selectedTokenId) ?? undefined)
                      : undefined
                  }
                  negRisk={selectedMarket.negRisk}
                  isLiveData={isConnected}
                  maxSlippagePercent={2}
                  disableSticky
                />
              </ErrorBoundary>
            ) : (
              <div className="border-y border-border/40 py-10 text-center">
                <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted-foreground/90 mb-2">
                  Trade Panel
                </p>
                <p className="font-editorial italic text-lg text-foreground max-w-[260px] mx-auto leading-snug">
                  Pick a market to open the ticket.
                </p>
                <p className="text-xs text-muted-foreground mt-2 max-w-[240px] mx-auto">
                  Tap any event or price on the left and the order book opens
                  here.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Mobile: bottom sheet trade bar */}
        {selectedMarket && tradingOutcomes.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-md border-t border-border/60 lg:hidden z-50">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted-foreground/90">
                  {tradingOutcomes[selectedOutcomeIndex]?.name} ·{" "}
                  {Math.round(
                    (tradingOutcomes[selectedOutcomeIndex]?.price ?? 0) * 100
                  )}
                  ¢
                </p>
                <p className="text-sm font-medium text-foreground truncate mt-0.5">
                  {selectedMarket.marketTitle}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <button
                  type="button"
                  onClick={handleCloseTradePanel}
                  className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted-foreground/90 hover:text-foreground transition-colors underline underline-offset-4 decoration-border"
                >
                  Dismiss
                </button>
                <a
                  href={`/events/detail/${selectedMarket.eventSlug || selectedMarket.eventId}`}
                  className="inline-flex items-center h-10 px-4 bg-foreground text-background font-mono text-[12px] uppercase tracking-[0.08em] hover:bg-foreground/90 transition-colors"
                >
                  Trade
                </a>
              </div>
            </div>
          </div>
        )}
      </main>

      <EditorialFooter context="Live Sports" />
    </div>
  );
}
