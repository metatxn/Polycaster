"use client";

import { resolveNegRisk } from "@knoww/shared-types/polymarket";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProChromeHeader } from "@/components/app-pro-layout";
import { EditorialFooter } from "@/components/editorial-footer";
import {
  EditorialHero,
  HeroLiveDot,
  HeroRefreshButton,
} from "@/components/editorial-hero";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  buildSelectedMarket,
  findMoneyline,
  LiveSportsbook,
  ScheduledSportsbook,
  type SelectedMarketInfo,
} from "@/components/live-sportsbook";
import { Navbar } from "@/components/navbar";
import { PullStat, PullStatGrid } from "@/components/pull-stat";
import { Skeleton } from "@/components/ui/skeleton";
import { useBestPrices, useOrderBookStore } from "@/hooks/use-orderbook-store";
import { usePaginatedEvents } from "@/hooks/use-paginated-events";
import { useOrderBookWebSocket } from "@/hooks/use-shared-websocket";
import {
  type LiveGameState,
  useSportsWebSocket,
} from "@/hooks/use-sports-websocket";
import { cn } from "@/lib/utils";

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

const LEAGUE_FILTERS = [
  { label: "All", value: "", tagSlug: "" },
  { label: "NFL", value: "nfl", tagSlug: "nfl" },
  { label: "NBA", value: "nba", tagSlug: "nba" },
  { label: "MLB", value: "mlb", tagSlug: "mlb" },
  { label: "NHL", value: "nhl", tagSlug: "nhl" },
  { label: "Soccer", value: "soccer", tagSlug: "soccer" },
  { label: "CFB", value: "ncaaf", tagSlug: "college-football" },
  { label: "CBB", value: "ncaab", tagSlug: "college-basketball" },
  { label: "Esports", value: "cs2", tagSlug: "esports" },
  { label: "Tennis", value: "tennis", tagSlug: "tennis" },
] as const;

interface EventWithDates {
  id: string;
  title: string;
  slug?: string;
  startDate?: string;
}

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
  const eventDate = event.startDate?.split("T")[0] ?? null;

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
  const [leagueFilter, setLeagueFilter] = useState("");
  const [selectedMarket, setSelectedMarket] =
    useState<SelectedMarketInfo | null>(null);
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState(0);

  const selectedLeague = LEAGUE_FILTERS.find((l) => l.value === leagueFilter);
  const leagueTagSlug = selectedLeague?.tagSlug || "";

  const {
    connectionState,
    isConnected,
    games,
    liveGames,
    lastMessageAt,
    reconnect,
  } = useSportsWebSocket({
    enabled: true,
    leagues: leagueFilter ? [leagueFilter] : undefined,
  });

  const effectiveTagSlug = leagueTagSlug || "sports";

  const {
    data: paginatedData,
    error,
    isLoading,
  } = usePaginatedEvents({
    limit: 50,
    order: "volume24hr",
    ascending: false,
    closed: false,
    tagSlug: effectiveTagSlug,
    filters: { live: true },
    refetchInterval: 10_000,
    fullMarkets: true,
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
    tagSlug: effectiveTagSlug,
    fullMarkets: true,
  });

  const rawEventsBase = useMemo(
    () => paginatedData?.pages.flatMap((page) => page.events || page) || [],
    [paginatedData]
  );

  const scheduledEventsBase = useMemo(() => {
    const all =
      scheduledData?.pages.flatMap((page) => page.events || page) || [];
    const now = Date.now();
    const liveIds = new Set(rawEventsBase.map((e) => e.id));
    return all.filter((event) => {
      if (liveIds.has(event.id)) return false;
      if (event.live || event.ended) return false;

      let startMs = Number.NaN;
      if (event.startDate) {
        startMs = new Date(event.startDate).getTime();
      }
      if (Number.isNaN(startMs) && event.markets) {
        for (const m of event.markets) {
          if (!m.gameStartTime) continue;
          const ms = new Date(m.gameStartTime).getTime();
          if (!Number.isNaN(ms) && (Number.isNaN(startMs) || ms < startMs)) {
            startMs = ms;
          }
        }
      }
      if (Number.isNaN(startMs)) return false;
      return startMs > now && startMs - now < 48 * 60 * 60 * 1000;
    });
  }, [scheduledData, rawEventsBase]);

  // ── Companion "More Markets" enrichment ─────────────────────────
  const companionSlugs = useMemo(() => {
    const all = [...rawEventsBase, ...scheduledEventsBase];
    return all
      .filter(
        (e) =>
          e.slug &&
          !e.title.toLowerCase().includes("more markets") &&
          e.slug.match(/-\d{4}-\d{2}-\d{2}$/)
      )
      .map((e) => `${e.slug}-more-markets`);
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
              clobTokenIds:
                typeof m.clobTokenIds === "string"
                  ? (() => {
                      try {
                        return JSON.parse(m.clobTokenIds as string);
                      } catch {
                        return [];
                      }
                    })()
                  : ((m.clobTokenIds as string[]) ?? []),
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
    const base = rawEventsBase.filter(
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
  }, [rawEventsBase, companionMarketMap]);

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
    <div className="min-h-screen flex flex-col bg-background relative overflow-x-hidden selection:bg-foreground/15">
      <Navbar />
      <ProChromeHeader />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-24 xl:pb-12">
        <EditorialHero
          breadcrumbs={[
            { label: "Markets", href: "/markets" },
            { label: "Live" },
          ]}
          title={
            <span>
              Live<span className="mx-3 text-muted-foreground/60">·</span>
              <span className="italic">Sports</span>
            </span>
          }
          subtitle="Real-time odds, live order books and one-tap trading. Matches update as games move."
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

        {/* Live metrics — pull-number grid */}
        <PullStatGrid cols={4} className="mb-8">
          <PullStat
            label="Live Now"
            value={liveEventCount}
            caption={liveEventCount === 1 ? "Event" : "Events"}
            isLoading={isLoading}
          />
          <PullStat
            label="Upcoming"
            value={scheduledEventCount}
            caption="Next 48h"
            isLoading={scheduledLoading && !isLoading}
          />
          <PullStat
            label="Feed Status"
            value={isConnected ? "Live" : "Offline"}
            caption={
              connectionState === "reconnecting" ? "Reconnecting…" : feedLabel
            }
            valueClassName={
              isConnected ? "text-emerald-600" : "text-muted-foreground"
            }
          />
          <PullStat
            label="Last Update"
            value={timeAgo(lastMessageAt) || "—"}
            caption={isConnected ? "Streaming" : "Disconnected"}
          />
        </PullStatGrid>

        {/* League filter — editorial category row (italic active + mono default) */}
        <div className="flex items-baseline gap-5 sm:gap-6 overflow-x-auto scrollbar-hide mb-6 pb-3 border-b border-border/40">
          {LEAGUE_FILTERS.map((league) => {
            const isActive = leagueFilter === league.value;
            const liveCount = liveGames.filter(
              (g) =>
                !league.value ||
                g.leagueAbbreviation?.toLowerCase() === league.value
            ).length;

            return (
              <button
                key={league.value}
                type="button"
                onClick={() => setLeagueFilter(league.value)}
                className={cn(
                  "shrink-0 whitespace-nowrap transition-colors inline-flex items-baseline gap-1.5",
                  isActive
                    ? "font-editorial italic text-lg sm:text-xl leading-none text-foreground"
                    : "font-mono text-[11px] uppercase tracking-[0.14em] leading-none text-muted-foreground hover:text-foreground"
                )}
              >
                <span>{league.label}</span>
                {liveCount > 0 && (
                  <span
                    className={cn(
                      "tabular-nums",
                      isActive
                        ? "font-mono text-[10px] text-muted-foreground not-italic"
                        : "text-emerald-600 font-mono text-[10px]"
                    )}
                  >
                    {liveCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Two-column layout: Sportsbook + Trade Panel */}
        <div className="grid gap-6 lg:gap-8 lg:grid-cols-[1fr_400px] xl:grid-cols-[1fr_440px]">
          {/* Left: Sportsbook */}
          <AnimatePresence mode="wait">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Error */}
              {error && (
                <div className="border-l-2 border-red-600 dark:border-red-400 pl-3 py-2 mb-6">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-600 dark:text-red-400 mb-1">
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
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
                    No Live Events
                  </p>
                  <p className="font-editorial italic text-xl text-foreground max-w-md mx-auto leading-snug">
                    {selectedLeague?.value
                      ? `Nothing live in ${selectedLeague.label} right now.`
                      : "Nothing live right now."}
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
          <div className="hidden lg:block">
            <div className="sticky top-4 self-start">
              {selectedMarket && tradingOutcomes.length > 0 ? (
                <ErrorBoundary name="Trading Form">
                  <TradingForm
                    marketTitle={selectedMarket.marketTitle}
                    tokenId={
                      tradingOutcomes[selectedOutcomeIndex]?.tokenId || ""
                    }
                    outcomes={tradingOutcomes}
                    selectedOutcomeIndex={selectedOutcomeIndex}
                    onOutcomeChange={setSelectedOutcomeIndex}
                    conditionId={selectedMarket.conditionId}
                    marketImage={selectedMarket.marketImage}
                    yesProbability={tradingOutcomes[0]?.probability}
                    bestBid={bestBid ?? undefined}
                    bestAsk={bestAsk ?? undefined}
                    isLiveData={isConnected}
                    maxSlippagePercent={2}
                    disableSticky
                  />
                </ErrorBoundary>
              ) : (
                <div className="border-y border-border/40 py-10 text-center">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
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
        </div>

        {/* Mobile: bottom sheet trade bar */}
        {selectedMarket && tradingOutcomes.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-md border-t border-border/60 lg:hidden z-50">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border"
                >
                  Dismiss
                </button>
                <a
                  href={`/events/detail/${selectedMarket.eventSlug || selectedMarket.eventId}`}
                  className="inline-flex items-center h-10 px-4 bg-foreground text-background font-mono text-[11px] uppercase tracking-[0.18em] hover:bg-foreground/90 transition-colors"
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
