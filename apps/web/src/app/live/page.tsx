"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { CircleDot, Radio, Sparkles, Wifi, WifiOff } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  buildSelectedMarket,
  findMoneyline,
  LiveSportsbook,
  ScheduledSportsbook,
  type SelectedMarketInfo,
} from "@/components/live-sportsbook";
import { Navbar } from "@/components/navbar";
import { PageBackground } from "@/components/page-background";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
        <Skeleton className="h-[350px] w-full rounded-xl" />
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
  if (seconds < 5) return "just now";
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
    active: true,
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
    active: true,
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

      // Use event.startDate first, then scan markets for earliest gameStartTime
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
          e.slug.match(/-\d{4}-\d{2}-\d{2}$/) // match slugs end with a date
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

  // CLOB WebSocket for the selected market's token IDs
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
      negRisk:
        event.negRisk ?? event.enableNegRisk ?? event.negRiskAugmented ?? false,
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

  return (
    <div className="min-h-screen bg-background relative selection:bg-purple-500/30">
      <PageBackground />
      <Navbar />

      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 xl:pb-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-between mb-4 sm:mb-6"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl animate-pulse" />
              <div className="relative flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                <Radio className="h-6 w-6 text-emerald-500" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight flex items-center gap-2">
                Live Sports
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Real-time games, order books & trading
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={reconnect}
            className={cn(
              "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all",
              isConnected
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                : connectionState === "reconnecting"
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400 animate-pulse"
                  : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
            )}
          >
            {isConnected ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
            {isConnected
              ? "Live Feed"
              : connectionState === "reconnecting"
                ? "Reconnecting…"
                : "Disconnected"}
            {isConnected && lastMessageAt && (
              <span className="text-[10px] font-normal text-muted-foreground">
                · {timeAgo(lastMessageAt)}
              </span>
            )}
          </button>
        </motion.div>

        {/* Live metrics */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.03 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mb-3"
        >
          <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Live Now
            </p>
            <p className="text-xl font-bold tabular-nums">{liveEventCount}</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Upcoming
            </p>
            <p className="text-xl font-bold tabular-nums">
              {scheduledEventCount}
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Feed Status
            </p>
            <p className="text-xl font-bold">
              {isConnected ? "Live" : "Offline"}
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Last Update
            </p>
            <p className="text-xl font-bold">{timeAgo(lastMessageAt) || "—"}</p>
          </div>
        </motion.div>

        {/* League Quick Filters */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="mb-1"
        >
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-3">
            {LEAGUE_FILTERS.map((league) => {
              const isActive = leagueFilter === league.value;
              const liveCount = liveGames.filter(
                (g) =>
                  !league.value ||
                  g.leagueAbbreviation?.toLowerCase() === league.value
              ).length;

              return (
                <button
                  type="button"
                  key={league.value}
                  onClick={() => setLeagueFilter(league.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-full border whitespace-nowrap transition-all active:scale-[0.97] shrink-0",
                    isActive
                      ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/15"
                      : "border-border/60 bg-background text-muted-foreground hover:border-border hover:bg-muted/50"
                  )}
                >
                  <span
                    className={cn("font-semibold", isActive && "text-primary")}
                  >
                    {league.label}
                  </span>
                  {liveCount > 0 && (
                    <span
                      className={cn(
                        "min-w-5 text-center px-1.5 py-0.5 text-[10px] font-bold rounded-full leading-none",
                        isActive
                          ? "bg-primary/20 text-primary"
                          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      )}
                    >
                      {liveCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Two-column layout: Sportsbook + Trade Panel */}
        <div className="grid gap-4 lg:gap-6 lg:grid-cols-[1fr_400px] xl:grid-cols-[1fr_440px]">
          {/* Left: Sportsbook */}
          <AnimatePresence mode="wait">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {error && (
                <Card className="border-destructive/50 bg-destructive/5 backdrop-blur-sm mb-6">
                  <CardHeader>
                    <CardTitle className="text-destructive flex items-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      Oops! Something went wrong
                    </CardTitle>
                    <CardDescription>
                      {error?.message || "Unable to load live markets"}
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}

              {/* Skeleton loading state */}
              {!error && isLoading && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-9 h-9 rounded-full" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-5 w-16" />
                      <Skeleton className="h-3.5 w-32" />
                    </div>
                  </div>
                  <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-28 w-full rounded-lg" />
                    ))}
                  </div>
                </div>
              )}

              {!error && !isLoading && liveEventCount > 0 && (
                <LiveSportsbook
                  events={rawEvents}
                  eventGameMap={eventGameMap}
                  onMarketSelect={handleMarketSelect}
                  selectedMarketId={selectedMarket?.marketId}
                  selectedOutcomeTokenId={selectedTokenId || undefined}
                />
              )}

              {!error && !isLoading && liveEventCount === 0 && (
                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardHeader className="text-center py-12">
                    <div className="mx-auto w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                      <CircleDot className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <CardTitle className="text-xl">
                      No Live Markets Right Now
                    </CardTitle>
                    <CardDescription className="max-w-md mx-auto">
                      {`No live markets right now${selectedLeague ? ` for ${selectedLeague.label}` : ""}. Check back when games are underway.`}
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}

              {/* Scheduled / Upcoming section */}
              {!scheduledError && scheduledLoading && !isLoading && (
                <div className="mt-6 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-24 w-full rounded-lg" />
                  ))}
                </div>
              )}

              {!scheduledError &&
                !scheduledLoading &&
                scheduledEventCount > 0 && (
                  <div className="mt-8">
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

          {/* Right: Trade Panel (sticky sidebar - always visible) */}
          <div className="hidden lg:block">
            <div className="sticky top-4 self-start space-y-3">
              {selectedMarket && tradingOutcomes.length > 0 ? (
                <>
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
                </>
              ) : (
                <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 text-center">
                  <div className="mx-auto w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                    <Radio className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <h3 className="text-sm font-bold text-foreground/80 mb-1">
                    Trade Panel
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Click on any market or price button to start trading
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile: Bottom sheet trade button */}
        {selectedMarket && tradingOutcomes.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 p-3 bg-background/95 backdrop-blur-md border-t border-border/50 lg:hidden z-50">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {selectedMarket.marketTitle}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tradingOutcomes[selectedOutcomeIndex]?.name} ·{" "}
                  {Math.round(
                    (tradingOutcomes[selectedOutcomeIndex]?.price ?? 0) * 100
                  )}
                  ¢
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCloseTradePanel}
                  className="px-3 py-2 text-xs font-semibold rounded-lg border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
                >
                  Dismiss
                </button>
                <a
                  href={`/events/detail/${selectedMarket.eventSlug || selectedMarket.eventId}`}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Trade
                </a>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
