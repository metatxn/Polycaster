"use client";

import { Calendar } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useOrderBookStore } from "@/hooks/use-orderbook-store";
import { useOrderBookWebSocket } from "@/hooks/use-shared-websocket";
import { getGameStartTime } from "./sportsbook/dates";
import { resolveLivePrice } from "./sportsbook/format";
import {
  getLeagueFromTags,
  sortLeagueEntriesForRegion,
  useInferredCountryCode,
} from "./sportsbook/league-region";
import { buildSelectedMarket } from "./sportsbook/market-parsing";
import { LeagueSection, ScheduledLeagueSection } from "./sportsbook/sections";
import type {
  EventMarket,
  LiveEvent,
  LiveGameState,
  SelectedMarketInfo,
} from "./sportsbook/types";
import { useMarketPositionLookup } from "./sportsbook/use-market-position-lookup";

// ── Public re-export surface (consumers import from this module) ────
export {
  buildSelectedMarket,
  findMoneyline,
  mapOutcomeNames,
} from "./sportsbook/market-parsing";
export type { LiveEvent, SelectedMarketInfo } from "./sportsbook/types";

// ── Props ──────────────────────────────────────────────────────────

export interface LiveSportsbookProps {
  events: LiveEvent[];
  eventGameMap: Map<string, LiveGameState | null>;
  onMarketSelect?: (market: SelectedMarketInfo, outcomeIndex: number) => void;
  selectedMarketId?: string;
  selectedOutcomeTokenId?: string;
}

export type ScheduledSportsbookProps = LiveSportsbookProps;

// ── Main exports ─────────────────────────────────────────────────────

export function LiveSportsbook({
  events,
  eventGameMap,
  onMarketSelect,
  selectedMarketId: _selectedMarketId,
  selectedOutcomeTokenId,
}: LiveSportsbookProps) {
  const [expandedMarketId, setExpandedMarketId] = useState<string | null>(null);
  const countryCode = useInferredCountryCode();
  const orderBooks = useOrderBookStore((s) => s.orderBooks);
  const lastTrades = useOrderBookStore((s) => s.lastTrades);
  const { tradingAddress, getMarketPositions } = useMarketPositionLookup();

  const handleToggleExpand = useCallback((marketId: string) => {
    setExpandedMarketId((prev) => (prev === marketId ? null : marketId));
  }, []);
  const handleOpenExpand = useCallback((marketId: string) => {
    setExpandedMarketId(marketId);
  }, []);

  const handleMarketSelect = useCallback(
    (event: LiveEvent, market: EventMarket, outcomeIndex: number) => {
      if (!onMarketSelect) return;
      const { info, mapRawIndex } = buildSelectedMarket(event, market);
      onMarketSelect(info, mapRawIndex(outcomeIndex));
    },
    [onMarketSelect]
  );

  const groupedByLeague = useMemo(() => {
    const groups = new Map<string, LiveEvent[]>();
    for (const event of events) {
      const league = getLeagueFromTags(event.tags, event.title);
      const existing = groups.get(league) || [];
      existing.push(event);
      groups.set(league, existing);
    }
    return groups;
  }, [events]);

  const orderedLeagueEntries = useMemo(
    () => sortLeagueEntriesForRegion(Array.from(groupedByLeague), countryCode),
    [countryCode, groupedByLeague]
  );

  const rowTokenIds = useMemo(() => {
    const ids = new Set<string>();
    for (const event of events) {
      for (const market of event.markets || []) {
        for (const tokenId of market.clobTokenIds || []) {
          if (tokenId) ids.add(tokenId);
        }
      }
    }
    return Array.from(ids);
  }, [events]);

  useOrderBookWebSocket(rowTokenIds);

  const getLivePrice = useCallback(
    (
      market: EventMarket | null,
      outcomeIndex: number,
      fallbackPrice: number
    ) => {
      if (!market) return fallbackPrice;
      const tokenId = market.clobTokenIds?.[outcomeIndex];
      return resolveLivePrice(tokenId, fallbackPrice, orderBooks, lastTrades);
    },
    [orderBooks, lastTrades]
  );

  if (events.length === 0) return null;

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4 pb-3 border-b border-(--kwm-hl)">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="relative inline-flex h-2 w-2 translate-y-[-2px] shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-(--kwm-up)/60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-(--kwm-up)" />
          </span>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-(--kwm-up)">
            Live
          </h2>
          <span className="text-(--kwm-ink-dim)">·</span>
          <span className="font-(family-name:--font-geist) text-[18px] font-semibold tracking-tight text-(--kwm-ink) tabular-nums leading-none">
            {events.length}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) translate-y-[-2px]">
            in progress
          </span>
        </div>
      </header>

      <div className="space-y-8">
        {orderedLeagueEntries.map(([league, leagueEvents]) => (
          <LeagueSection
            key={league}
            league={league}
            events={leagueEvents}
            eventGameMap={eventGameMap}
            expandedMarketId={expandedMarketId}
            onToggleExpand={handleToggleExpand}
            onOpenExpand={handleOpenExpand}
            onMarketSelect={handleMarketSelect}
            getLivePrice={getLivePrice}
            getMarketPositions={getMarketPositions}
            tradingAddress={tradingAddress}
            selectedOutcomeTokenId={selectedOutcomeTokenId}
          />
        ))}
      </div>
    </section>
  );
}

export function ScheduledSportsbook({
  events,
  eventGameMap,
  onMarketSelect,
  selectedMarketId: _selectedMarketId,
  selectedOutcomeTokenId,
}: ScheduledSportsbookProps) {
  const [expandedMarketId, setExpandedMarketId] = useState<string | null>(null);
  const countryCode = useInferredCountryCode();
  const orderBooks = useOrderBookStore((s) => s.orderBooks);
  const lastTrades = useOrderBookStore((s) => s.lastTrades);
  const { tradingAddress, getMarketPositions } = useMarketPositionLookup();

  const handleToggleExpand = useCallback((marketId: string) => {
    setExpandedMarketId((prev) => (prev === marketId ? null : marketId));
  }, []);
  const handleOpenExpand = useCallback((marketId: string) => {
    setExpandedMarketId(marketId);
  }, []);

  const handleMarketSelect = useCallback(
    (event: LiveEvent, market: EventMarket, outcomeIndex: number) => {
      if (!onMarketSelect) return;
      const { info, mapRawIndex } = buildSelectedMarket(event, market);
      onMarketSelect(info, mapRawIndex(outcomeIndex));
    },
    [onMarketSelect]
  );

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const aTime = getGameStartTime(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = getGameStartTime(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }, [events]);

  const groupedByLeague = useMemo(() => {
    const groups = new Map<string, LiveEvent[]>();
    for (const event of sortedEvents) {
      const league = getLeagueFromTags(event.tags, event.title);
      const existing = groups.get(league) || [];
      existing.push(event);
      groups.set(league, existing);
    }
    return groups;
  }, [sortedEvents]);

  const orderedLeagueEntries = useMemo(
    () => sortLeagueEntriesForRegion(Array.from(groupedByLeague), countryCode),
    [countryCode, groupedByLeague]
  );

  const getLivePrice = useCallback(
    (
      market: EventMarket | null,
      outcomeIndex: number,
      fallbackPrice: number
    ) => {
      if (!market) return fallbackPrice;
      const tokenId = market.clobTokenIds?.[outcomeIndex];
      return resolveLivePrice(tokenId, fallbackPrice, orderBooks, lastTrades);
    },
    [orderBooks, lastTrades]
  );

  if (events.length === 0) return null;

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between gap-4 pb-3 border-b border-(--kwm-hl)">
        <div className="flex items-baseline gap-3">
          <Calendar className="h-3 w-3 text-(--kwm-ink-3) translate-y-px" />
          <h2 className="font-mono text-[12px] uppercase tracking-[0.08em] text-(--kwm-ink)">
            Upcoming
          </h2>
          <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-(--kwm-ink-3) tabular-nums">
            · {events.length} scheduled
          </span>
        </div>
      </header>

      <div className="space-y-8">
        {orderedLeagueEntries.map(([league, leagueEvents]) => (
          <ScheduledLeagueSection
            key={league}
            league={league}
            events={leagueEvents}
            eventGameMap={eventGameMap}
            expandedMarketId={expandedMarketId}
            onToggleExpand={handleToggleExpand}
            onOpenExpand={handleOpenExpand}
            onMarketSelect={handleMarketSelect}
            getLivePrice={getLivePrice}
            getMarketPositions={getMarketPositions}
            tradingAddress={tradingAddress}
            selectedOutcomeTokenId={selectedOutcomeTokenId}
          />
        ))}
      </div>
    </section>
  );
}
