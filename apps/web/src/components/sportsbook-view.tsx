"use client";

import {
  parseGammaStringArray,
  resolveNegRisk,
} from "@knoww/shared-types/polymarket";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useBestPrices, useOrderBookStore } from "@/hooks/use-orderbook-store";
import { usePaginatedEvents } from "@/hooks/use-paginated-events";
import { useOrderBookWebSocket } from "@/hooks/use-shared-websocket";
import {
  type LiveGameState,
  useSportsWebSocket,
} from "@/hooks/use-sports-websocket";

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

interface SportsbookViewProps {
  /** Polymarket Gamma tag slug for the league/sport (e.g. "premier-league-2025"). */
  tagSlug: string;
  /** Optional series_id — preferred over tagSlug when present. */
  seriesId?: number;
  /** League labels shown in empty/error states (e.g. "EPL"). */
  label?: string;
  /** Live-only feed: show only events with `live=true`. The /live page
   *  uses this; per-league pages don't (they show all upcoming). */
  liveOnly?: boolean;
  /** Cap how many events to fetch per page. */
  pageLimit?: number;
}

interface SportsEvent {
  id: string;
  slug?: string;
  title: string;
  image?: string;
  live?: boolean;
  ended?: boolean;
  parentEventId?: string | number | null;
  startDate?: string;
  startTime?: string;
  // NegRisk flags can appear on either of these fields depending on the
  // payload; pass-through to resolveNegRisk handles all variants.
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
  markets?: Array<{
    id: string;
    question?: string;
    outcomes?: string;
    outcomePrices?: string;
    groupItemTitle?: string;
    image?: string;
    icon?: string;
    clobTokenIds?: string[];
    conditionId?: string;
    gameStartTime?: string;
    sportsMarketType?: string;
    parentEventId?: string | number;
    parentEventTitle?: string;
  }>;
  tags?: Array<string | { id?: string; slug?: string; label?: string }>;
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

function extractDateOnly(input?: string): string | null {
  if (!input) return null;
  return input.split(/[T ]/)[0] || null;
}

function getEventKickoffDate(event: SportsEvent): string | null {
  const eventDate = extractDateOnly(event.startTime);
  if (eventDate) return eventDate;

  for (const market of event.markets ?? []) {
    const marketDate = extractDateOnly(market.gameStartTime);
    if (marketDate) return marketDate;
  }

  return extractDateOnly(event.startDate);
}

function eventIdKey(id: string | number | null | undefined): string | null {
  if (id === undefined || id === null) return null;
  const value = String(id);
  return value ? value : null;
}

function parentTitleFromChild(event: SportsEvent): string | null {
  const idx = event.title.indexOf(" - ");
  if (idx <= 0) return null;
  return event.title.slice(0, idx);
}

function buildParentIdByTitle(events: SportsEvent[]): Map<string, string> {
  const parentTitles = new Map<string, string>();
  for (const event of events) {
    if (parentTitleFromChild(event)) continue;
    parentTitles.set(event.title, event.id);
  }
  return parentTitles;
}

function getInferredParentId(
  event: SportsEvent,
  parentIdByTitle: Map<string, string>
): string | null {
  const explicitParentId = eventIdKey(event.parentEventId);
  if (explicitParentId) return explicitParentId;

  const parentTitle = parentTitleFromChild(event);
  return parentTitle ? (parentIdByTitle.get(parentTitle) ?? null) : null;
}

function buildChildEventsByParent(
  events: SportsEvent[],
  parentIdByTitle: Map<string, string>
): Map<string, SportsEvent[]> {
  const children = new Map<string, SportsEvent[]>();
  for (const event of events) {
    const parentId = getInferredParentId(event, parentIdByTitle);
    if (!parentId) continue;
    const bucket = children.get(parentId) ?? [];
    bucket.push(event);
    children.set(parentId, bucket);
  }
  return children;
}

function enrichWithChildMarkets(
  event: SportsEvent,
  childrenByParent: Map<string, SportsEvent[]>
): SportsEvent {
  const children = childrenByParent.get(event.id);
  if (!children?.length) return event;

  const seenMarketIds = new Set((event.markets ?? []).map((m) => m.id));
  const childMarkets = children.flatMap((child) =>
    (child.markets ?? [])
      .filter((market) => {
        if (seenMarketIds.has(market.id)) return false;
        seenMarketIds.add(market.id);
        return true;
      })
      .map((market) => ({
        ...market,
        parentEventId: child.id,
        parentEventTitle: child.title,
      }))
  );

  if (childMarkets.length === 0) return event;
  return { ...event, markets: [...(event.markets ?? []), ...childMarkets] };
}

function matchEventToGame(
  event: SportsEvent,
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

/**
 * Self-contained sportsbook layout: LiveSportsbook + ScheduledSportsbook
 * with a sticky trade panel on the right (3-column at lg+, single column
 * with mobile bottom-bar below). Used by both `/events/sports/live` and
 * the per-league pages.
 *
 * Owns:
 * - Live + scheduled events queries (filtered by tagSlug or seriesId)
 * - Companion "more-markets" enrichment (so spread/total markets render)
 * - Sports websocket for live game state matching
 * - Selected-market state + websocket subscription for trade-panel prices
 */
export function SportsbookView({
  tagSlug,
  seriesId,
  label,
  liveOnly = false,
  pageLimit = 50,
}: SportsbookViewProps) {
  const [selectedMarket, setSelectedMarket] =
    useState<SelectedMarketInfo | null>(null);
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState(0);

  const { isConnected, games } = useSportsWebSocket({ enabled: true });

  // Single fetch for the tag/series. Events are then bucketed client-side
  // into "live" (event.live === true) vs "scheduled" (everything else, capped
  // to the upcoming-window). This avoids the previous two-query setup, which
  // was prone to react-query cache-key collisions when both queries used
  // identical filter shapes.
  const {
    data: paginatedData,
    error: scheduledError,
    isLoading: scheduledLoading,
  } = usePaginatedEvents({
    limit: pageLimit,
    order: "volume24hr",
    ascending: false,
    closed: false,
    tagSlug,
    seriesId,
    filters: liveOnly ? { live: true } : undefined,
    refetchInterval: liveOnly ? 10_000 : 30_000,
    fullMarkets: true,
  });

  // No second query in either mode now. liveError/liveLoading kept as
  // null/false to preserve existing JSX guards below.
  const liveError = null;
  const liveLoading = false;

  const allFetchedEvents = useMemo(
    () =>
      (paginatedData?.pages.flatMap(
        (page) => page.events || page
      ) as SportsEvent[]) || [],
    [paginatedData]
  );

  const parentIdByTitle = useMemo(
    () => buildParentIdByTitle(allFetchedEvents),
    [allFetchedEvents]
  );

  const childEventsByParent = useMemo(
    () => buildChildEventsByParent(allFetchedEvents, parentIdByTitle),
    [allFetchedEvents, parentIdByTitle]
  );

  const liveEventsBase = useMemo(() => {
    const parentEvents = allFetchedEvents.filter(
      (event) => !getInferredParentId(event, parentIdByTitle)
    );
    if (liveOnly) {
      return parentEvents.map((event) =>
        enrichWithChildMarkets(event, childEventsByParent)
      );
    }
    // For league pages, only events explicitly marked live by Gamma show up
    // in the Live section. Most league events don't have live=true so this
    // bucket stays empty until kickoff.
    return parentEvents
      .filter((event) => event.live === true)
      .map((event) => enrichWithChildMarkets(event, childEventsByParent));
  }, [allFetchedEvents, childEventsByParent, liveOnly, parentIdByTitle]);

  const scheduledEventsBase = useMemo(() => {
    // In liveOnly mode the main query already filtered to live=true; the
    // /live page renders its own scheduled feed separately, so there is
    // nothing to bucket here.
    if (liveOnly) return [];

    // For league pages: every non-live, non-ended event is "scheduled".
    // Don't drop events without a startDate — futures markets ("La Liga
    // Winner", "EPL Top Scorer") don't carry per-game timestamps and we
    // still want them visible in the league view.
    const liveIds = new Set(liveEventsBase.map((e) => e.id));
    return allFetchedEvents
      .filter((event) => {
        if (getInferredParentId(event, parentIdByTitle)) return false;
        if (liveIds.has(event.id)) return false;
        if (event.live || event.ended) return false;
        return true;
      })
      .map((event) => enrichWithChildMarkets(event, childEventsByParent));
  }, [
    allFetchedEvents,
    childEventsByParent,
    liveEventsBase,
    liveOnly,
    parentIdByTitle,
  ]);

  // ── Companion "More Markets" enrichment ─────────────────────────
  const companionSlugs = useMemo(() => {
    const all = [...liveEventsBase, ...scheduledEventsBase];
    return all
      .filter(
        (e) =>
          e.slug &&
          !e.title.toLowerCase().includes("more markets") &&
          (e.markets?.length ?? 0) <= 3 &&
          !e.markets?.some((m) => m.parentEventId) &&
          e.slug.match(/-\d{4}-\d{2}-\d{2}$/)
      )
      .map((e) => `${e.slug}-more-markets`);
  }, [liveEventsBase, scheduledEventsBase]);

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
              sportsMarketType: m.sportsMarketType as string | undefined,
            })),
          };
        })
      );
      const map: Record<string, SportsEvent["markets"]> = {};
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

  const liveEvents = useMemo(() => {
    const base = liveEventsBase.filter(
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
  }, [liveEventsBase, companionMarketMap]);

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
    for (const event of liveEvents) {
      map.set(event.id, matchEventToGame(event, games));
    }
    for (const event of scheduledEvents) {
      map.set(event.id, matchEventToGame(event, games));
    }
    return map;
  }, [liveEvents, scheduledEvents, games]);

  const liveCount = liveEvents.length;
  const scheduledCount = scheduledEvents.length;

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

  // Auto-pick the first event's moneyline market on mount so the trade
  // panel is never empty when the page first renders.
  useEffect(() => {
    if (selectedMarket || userClosedPanel.current) return;
    const firstEvent = liveEvents[0] || scheduledEvents[0];
    if (!firstEvent?.markets?.length) return;
    const moneyline = findMoneyline(firstEvent.markets);
    const targetMarket = moneyline?.market ?? firstEvent.markets[0];
    const { info } = buildSelectedMarket(firstEvent, targetMarket);
    if (info.outcomes.length >= 2 && info.outcomes.some((o) => o.tokenId)) {
      setSelectedMarket(info);
      setSelectedOutcomeIndex(0);
    }
  }, [liveEvents, scheduledEvents, selectedMarket]);

  // Keep the selected-market price refs in sync with the latest fetch.
  useEffect(() => {
    if (!selectedMarket) return;
    const allEvents = [...liveEvents, ...scheduledEvents];
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

    const next: SelectedMarketInfo = {
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
      (next.eventSlug ?? "") === (selectedMarket.eventSlug ?? "") &&
      next.marketTitle === selectedMarket.marketTitle &&
      next.marketImage === selectedMarket.marketImage &&
      next.conditionId === selectedMarket.conditionId &&
      next.negRisk === selectedMarket.negRisk &&
      next.outcomes.length === selectedMarket.outcomes.length &&
      next.outcomes.every((o, i) => {
        const c = selectedMarket.outcomes[i];
        return (
          o.name === c?.name &&
          o.tokenId === c?.tokenId &&
          o.price === c?.price &&
          o.probability === c?.probability
        );
      });

    if (!isSame) setSelectedMarket(next);
  }, [liveEvents, scheduledEvents, selectedMarket]);

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

  const isLoading = liveLoading || scheduledLoading;
  const error = liveError || scheduledError;
  const labelText = label?.toLowerCase() ?? "sports";

  return (
    <>
      <div className="grid min-w-0 items-start gap-6 lg:gap-6 xl:gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Left: live + scheduled sportsbook */}
        <AnimatePresence mode="wait">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="min-w-0"
          >
            {error && (
              <div className="border-l-2 border-red-600 dark:border-red-400 pl-3 py-2 mb-6">
                <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-red-600 dark:text-red-400 mb-1">
                  Feed Error
                </p>
                <p className="text-sm text-foreground leading-snug">
                  {error?.message || "Unable to load markets"}
                </p>
              </div>
            )}

            {!error && isLoading && (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            )}

            {!error && !isLoading && liveCount > 0 && (
              <LiveSportsbook
                events={liveEvents}
                eventGameMap={eventGameMap}
                onMarketSelect={handleMarketSelect}
                selectedMarketId={selectedMarket?.marketId}
                selectedOutcomeTokenId={selectedTokenId || undefined}
              />
            )}

            {!error && !isLoading && scheduledCount > 0 && (
              <div className={liveCount > 0 ? "mt-10" : ""}>
                <ScheduledSportsbook
                  events={scheduledEvents}
                  eventGameMap={eventGameMap}
                  onMarketSelect={handleMarketSelect}
                  selectedMarketId={selectedMarket?.marketId}
                  selectedOutcomeTokenId={selectedTokenId || undefined}
                />
              </div>
            )}

            {!error &&
              !isLoading &&
              liveCount === 0 &&
              scheduledCount === 0 && (
                <div className="py-16 text-center border-y border-border/40">
                  <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted-foreground/90 mb-3">
                    No Markets
                  </p>
                  <p className="font-editorial italic text-xl text-foreground max-w-md mx-auto leading-snug">
                    No active {labelText} markets right now.
                  </p>
                  <p className="text-sm text-muted-foreground mt-3 max-w-md mx-auto">
                    Check back soon, or try a different league from the rail.
                  </p>
                </div>
              )}
          </motion.div>
        </AnimatePresence>

        {/* Right: trade panel — sticky sidebar */}
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
                Tap any price on the left and the order book opens here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile bottom-bar trade trigger */}
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
    </>
  );
}
