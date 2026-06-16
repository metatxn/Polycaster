"use client";

import Image from "next/image";
import { useMemo } from "react";
import type { Position } from "@/hooks/use-user-positions";
import { formatDateHeading, getGameStartTime, getLocalDateKey } from "./dates";
import { CompactEventRow, SportEventRow } from "./event-rows";
import { leagueDisplayName } from "./league-region";
import type { EventMarket, LiveEvent, LiveGameState } from "./types";

// ── LeagueSection ─────────────────────────────────────────────────────

export function LeagueSection({
  league,
  events,
  eventGameMap,
  expandedMarketId,
  onToggleExpand,
  onOpenExpand,
  onMarketSelect,
  getLivePrice,
  getMarketPositions,
  tradingAddress,
  selectedOutcomeTokenId,
}: {
  league: string;
  events: LiveEvent[];
  eventGameMap: Map<string, LiveGameState | null>;
  expandedMarketId: string | null;
  onToggleExpand: (marketId: string) => void;
  onOpenExpand: (marketId: string) => void;
  onMarketSelect: (
    event: LiveEvent,
    market: EventMarket,
    outcomeIndex: number
  ) => void;
  getLivePrice: (
    market: EventMarket | null,
    outcomeIndex: number,
    fallbackPrice: number
  ) => number;
  getMarketPositions: (market: EventMarket) => Position[];
  tradingAddress?: string;
  selectedOutcomeTokenId?: string;
}) {
  const leagueIcon = events[0]?.image;
  const isTennis = league === "tennis";

  return (
    <div className="space-y-1.5">
      <div className="flex items-end justify-between pb-1.5">
        <div className="flex items-center gap-2.5 min-w-0">
          {leagueIcon && (
            <Image
              src={leagueIcon}
              alt={leagueDisplayName(league)}
              width={22}
              height={22}
              className="rounded-full object-cover bg-(--kwm-bg-3) border border-(--kwm-hl)"
            />
          )}
          <h3 className="font-(family-name:--font-geist) text-[15px] font-semibold tracking-tight text-(--kwm-ink) leading-none truncate">
            {leagueDisplayName(league)}
          </h3>
          <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-sm bg-(--kwm-bg-3) border border-(--kwm-hl) font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) tabular-nums">
            {events.length}
          </span>
        </div>
      </div>
      {isTennis ? (
        <div className="event-grid-scheduled hidden md:grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-2 border-y border-(--kwm-hl) bg-(--kwm-bg-2) font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-2)">
          <span className="w-7" />
          <span>Player</span>
          <span className="w-[106px] text-center">Moneyline</span>
          <span className="hidden 3xl:inline w-[132px] text-center">
            Spread
          </span>
          <span className="hidden 3xl:inline w-[122px] text-center">Total</span>
        </div>
      ) : (
        <div className="event-grid-live hidden md:grid grid-cols-[auto_auto_1fr_auto] gap-3 px-4 py-2 border-y border-(--kwm-hl) bg-(--kwm-bg-2) font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-2)">
          <span className="w-6 text-center">Score</span>
          <span className="w-7" />
          <span>Team</span>
          <span className="w-[106px] text-center">Moneyline</span>
          <span className="hidden 3xl:inline w-[132px] text-center">
            Spread
          </span>
          <span className="hidden 3xl:inline w-[122px] text-center">Total</span>
        </div>
      )}
      <div className="-mt-px">
        {events.map((event) => {
          const game = eventGameMap.get(event.id) ?? null;
          return (
            <div key={event.id} className="-mt-px">
              <div className="hidden md:block">
                <SportEventRow
                  variant="live"
                  event={event}
                  game={game}
                  isTennis={isTennis}
                  expandedMarketId={expandedMarketId}
                  onToggleExpand={onToggleExpand}
                  onOpenExpand={onOpenExpand}
                  getLivePrice={getLivePrice}
                  getMarketPositions={getMarketPositions}
                  tradingAddress={tradingAddress}
                  selectedOutcomeTokenId={selectedOutcomeTokenId}
                  onMarketSelect={(market, idx) =>
                    onMarketSelect(event, market, idx)
                  }
                />
              </div>
              <div className="md:hidden">
                <CompactEventRow
                  event={event}
                  game={game}
                  isTennis={isTennis}
                  expandedMarketId={expandedMarketId}
                  onToggleExpand={onToggleExpand}
                  onOpenExpand={onOpenExpand}
                  getLivePrice={getLivePrice}
                  getMarketPositions={getMarketPositions}
                  tradingAddress={tradingAddress}
                  selectedOutcomeTokenId={selectedOutcomeTokenId}
                  onMarketSelect={(market, idx) =>
                    onMarketSelect(event, market, idx)
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ScheduledLeagueSection ────────────────────────────────────────────

export function ScheduledLeagueSection({
  league,
  events,
  eventGameMap,
  expandedMarketId,
  onToggleExpand,
  onOpenExpand,
  onMarketSelect,
  getLivePrice,
  getMarketPositions,
  tradingAddress,
  selectedOutcomeTokenId,
}: {
  league: string;
  events: LiveEvent[];
  eventGameMap: Map<string, LiveGameState | null>;
  expandedMarketId: string | null;
  onToggleExpand: (marketId: string) => void;
  onOpenExpand: (marketId: string) => void;
  onMarketSelect: (
    event: LiveEvent,
    market: EventMarket,
    outcomeIndex: number
  ) => void;
  getLivePrice: (
    market: EventMarket | null,
    outcomeIndex: number,
    fallbackPrice: number
  ) => number;
  getMarketPositions: (market: EventMarket) => Position[];
  tradingAddress?: string;
  selectedOutcomeTokenId?: string;
}) {
  const leagueIcon = events[0]?.image;
  const groupedByDate = useMemo(() => {
    const groups = new Map<string, { label: string; events: LiveEvent[] }>();
    for (const event of events) {
      const start = getGameStartTime(event);
      const key = start ? getLocalDateKey(start) : "unscheduled";
      const label = start ? formatDateHeading(start) : "Scheduled";
      const group = groups.get(key) ?? { label, events: [] };
      group.events.push(event);
      groups.set(key, group);
    }
    return Array.from(groups.entries()).map(([key, group]) => ({
      key,
      ...group,
    }));
  }, [events]);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between pb-1">
        <div className="flex items-center gap-2.5">
          {leagueIcon && (
            <Image
              src={leagueIcon}
              alt={leagueDisplayName(league)}
              width={20}
              height={20}
              className="rounded-full object-cover bg-(--kwm-bg-3)"
            />
          )}
          <h3 className="font-mono text-[12px] uppercase tracking-[0.08em] text-(--kwm-ink)">
            {leagueDisplayName(league)}
          </h3>
          <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-(--kwm-ink-3) tabular-nums">
            · {events.length}
          </span>
        </div>
      </div>
      <div className="event-grid-scheduled hidden md:grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-2 border-y border-(--kwm-hl) font-mono text-[12px] uppercase tracking-[0.08em] text-(--kwm-ink-3)">
        <span className="w-7" />
        <span>Team</span>
        <span className="w-[106px] text-center">Moneyline</span>
        <span className="hidden 3xl:inline w-[132px] text-center">Spread</span>
        <span className="hidden 3xl:inline w-[122px] text-center">Total</span>
      </div>
      <div className="-mt-px space-y-3">
        {groupedByDate.map((group) => (
          <div key={group.key} className="-mt-px">
            {/* Day separator — deliberately heavier than the mono column
                header above so a long multi-day list reads as distinct days
                rather than one undifferentiated stream. */}
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-y border-(--kwm-hl-2) bg-(--kwm-bg-2)">
              <span
                className="h-3 w-[3px] shrink-0 rounded-full bg-(--kwm-ink-3)"
                aria-hidden="true"
              />
              <span className="font-(family-name:--font-geist) text-[13px] font-semibold uppercase tracking-[0.1em] text-(--kwm-ink)">
                {group.label}
              </span>
            </div>
            {group.events.map((event) => {
              const game = eventGameMap.get(event.id) ?? null;
              return (
                <div key={event.id} className="-mt-px">
                  <div className="hidden md:block">
                    <SportEventRow
                      variant="scheduled"
                      event={event}
                      game={game}
                      expandedMarketId={expandedMarketId}
                      onToggleExpand={onToggleExpand}
                      onOpenExpand={onOpenExpand}
                      getLivePrice={getLivePrice}
                      getMarketPositions={getMarketPositions}
                      tradingAddress={tradingAddress}
                      selectedOutcomeTokenId={selectedOutcomeTokenId}
                      onMarketSelect={(market, idx) =>
                        onMarketSelect(event, market, idx)
                      }
                    />
                  </div>
                  <div className="md:hidden">
                    <CompactEventRow
                      event={event}
                      game={game}
                      variant="scheduled"
                      expandedMarketId={expandedMarketId}
                      onToggleExpand={onToggleExpand}
                      onOpenExpand={onOpenExpand}
                      getLivePrice={getLivePrice}
                      getMarketPositions={getMarketPositions}
                      tradingAddress={tradingAddress}
                      selectedOutcomeTokenId={selectedOutcomeTokenId}
                      onMarketSelect={(market, idx) =>
                        onMarketSelect(event, market, idx)
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
