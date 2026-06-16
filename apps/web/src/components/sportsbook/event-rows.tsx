"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Position } from "@/hooks/use-user-positions";
import { formatVolume } from "@/lib/formatters";
import { isTennisSetScore, parseSportsScore } from "@/lib/sports-score-format";
import { cn } from "@/lib/utils";
import { formatRelativeTime, formatStartTime, getGameStartTime } from "./dates";
import { tokenIdForOutcome } from "./format";
import { ExpandedMarketPanel, type MoneylineChartToken } from "./market-panel";
import {
  buildMoneylineDisplayData,
  findMoneyline,
  findSpread,
  findTotal,
  getSeriesInfo,
  getTournamentInfo,
  isYesNoOutcomes,
  parseMarketOutcomes,
  parseTeamsFromTitle,
  teamAbbr,
} from "./market-parsing";
import type {
  EventMarket,
  LiveEvent,
  LiveGameState,
  ParsedBettingLine,
} from "./types";
import {
  DrawButton,
  PriceButton,
  SpreadCell,
  TeamAvatar,
  TotalCell,
} from "./ui";

// ── Types ─────────────────────────────────────────────────────────

export type SportRowVariant = "live" | "scheduled";

// ── SportEventRow ──────────────────────────────────────────────────

export function SportEventRow({
  event,
  game,
  variant = "live",
  isTennis = false,
  expandedMarketId,
  onToggleExpand,
  onOpenExpand,
  onMarketSelect,
  getLivePrice,
  getMarketPositions,
  tradingAddress,
  selectedOutcomeTokenId,
}: {
  event: LiveEvent;
  game: LiveGameState | null;
  variant?: SportRowVariant;
  isTennis?: boolean;
  expandedMarketId: string | null;
  onToggleExpand: (marketId: string) => void;
  onOpenExpand: (marketId: string) => void;
  onMarketSelect: (market: EventMarket, outcomeIndex: number) => void;
  getLivePrice: (
    market: EventMarket | null,
    outcomeIndex: number,
    fallbackPrice: number
  ) => number;
  getMarketPositions: (market: EventMarket) => Position[];
  tradingAddress?: string;
  selectedOutcomeTokenId?: string;
}) {
  const isLive = variant === "live";
  const titleTeams = useMemo(
    () => parseTeamsFromTitle(event.title),
    [event.title]
  );
  const moneyline = useMemo(
    () => (event.markets ? findMoneyline(event.markets) : null),
    [event.markets]
  );
  const spread = useMemo(
    () => (event.markets ? findSpread(event.markets, titleTeams?.[0]) : null),
    [event.markets, titleTeams]
  );
  const total = useMemo(
    () => (event.markets ? findTotal(event.markets) : null),
    [event.markets]
  );

  const moneylineDisplay = useMemo(
    () => buildMoneylineDisplayData(event, game, moneyline),
    [event, game, moneyline]
  );
  const teamNames = moneylineDisplay.teamNames;
  const primaryMarket = moneylineDisplay.primaryLine ?? spread ?? total;

  const rawScore = game?.score || event.score;
  const [homeScore, awayScore] = parseSportsScore(rawScore);
  const showInlineScore = isTennis || isTennisSetScore(rawScore);

  const href = event.slug
    ? `/events/detail/${event.slug}`
    : `/events/detail/${event.id}`;
  const volume = event.volume24hr || event.volume;
  const marketCount = event.markets?.length ?? 0;
  const seriesInfo = getSeriesInfo(event.title);
  const tournament = getTournamentInfo(event.title);
  const homeAbbr = teamAbbr(teamNames[0]);
  const awayAbbr = teamAbbr(teamNames[1]);
  const homeFavored =
    moneylineDisplay.home && moneylineDisplay.away
      ? moneylineDisplay.home.price >= moneylineDisplay.away.price
      : true;
  const isSingleTeamEvent = !teamNames[1];
  const homeMoneylinePrice = moneylineDisplay.home
    ? getLivePrice(
        moneylineDisplay.home.line.market,
        moneylineDisplay.home.outcomeIndex,
        moneylineDisplay.home.price
      )
    : null;
  const awayMoneylinePrice = moneylineDisplay.away
    ? getLivePrice(
        moneylineDisplay.away.line.market,
        moneylineDisplay.away.outcomeIndex,
        moneylineDisplay.away.price
      )
    : null;
  const drawMoneylinePrice = moneylineDisplay.draw
    ? getLivePrice(
        moneylineDisplay.draw.line.market,
        moneylineDisplay.draw.outcomeIndex,
        moneylineDisplay.draw.price
      )
    : null;
  const homeSpreadPrice = spread
    ? getLivePrice(spread.market, spread.idx?.[0] ?? 0, spread.prices[0])
    : null;
  const awaySpreadPrice = spread
    ? getLivePrice(spread.market, spread.idx?.[1] ?? 1, spread.prices[1])
    : null;
  const homeTotalPrice = total
    ? getLivePrice(total.market, total.idx?.[0] ?? 0, total.prices[0])
    : null;
  const awayTotalPrice = total
    ? getLivePrice(total.market, total.idx?.[1] ?? 1, total.prices[1])
    : null;

  const gameStart = isLive ? null : getGameStartTime(event);

  const moneylineChartTokens = useMemo((): MoneylineChartToken[] => {
    const CHART_COLORS = [
      "hsl(221, 83%, 53%)",
      "hsl(142, 76%, 36%)",
      "hsl(35, 92%, 50%)",
      "hsl(280, 100%, 70%)",
    ];

    const ml = moneylineDisplay;
    if (!ml.primaryLine) return [];

    const primaryMarketObj = ml.primaryLine.market;
    const primaryOutcomes = parseMarketOutcomes(primaryMarketObj.outcomes);

    if (
      !isYesNoOutcomes(primaryOutcomes) &&
      primaryMarketObj.clobTokenIds?.length
    ) {
      return ml.primaryLine.outcomes
        .map((name, i) => {
          const tokenId = primaryMarketObj.clobTokenIds?.[i] || "";
          return tokenId
            ? { tokenId, name, color: CHART_COLORS[i % CHART_COLORS.length] }
            : null;
        })
        .filter((t): t is MoneylineChartToken => t !== null);
    }

    const tokens: MoneylineChartToken[] = [];
    let colorIdx = 0;
    if (ml.home) {
      const tid = tokenIdForOutcome(ml.home.line.market, ml.home.outcomeIndex);
      if (tid)
        tokens.push({
          tokenId: tid,
          name: ml.teamNames[0],
          color: CHART_COLORS[colorIdx++ % CHART_COLORS.length],
        });
    }
    if (ml.away) {
      const tid = tokenIdForOutcome(ml.away.line.market, ml.away.outcomeIndex);
      if (tid)
        tokens.push({
          tokenId: tid,
          name: ml.teamNames[1],
          color: CHART_COLORS[colorIdx++ % CHART_COLORS.length],
        });
    }
    if (ml.draw) {
      const tid = tokenIdForOutcome(ml.draw.line.market, ml.draw.outcomeIndex);
      if (tid)
        tokens.push({
          tokenId: tid,
          name: "Draw",
          color: CHART_COLORS[colorIdx % CHART_COLORS.length],
        });
    }

    return tokens;
  }, [moneylineDisplay]);

  const expandedMarket = useMemo(() => {
    if (!expandedMarketId) return null;
    return event.markets?.find((m) => m.id === expandedMarketId) ?? null;
  }, [event.markets, expandedMarketId]);
  const isExpanded = Boolean(expandedMarket);
  const expandedMarketPositions = useMemo(
    () => (expandedMarket ? getMarketPositions(expandedMarket) : []),
    [expandedMarket, getMarketPositions]
  );
  const [expandedOutcomeIndex, setExpandedOutcomeIndex] = useState(0);

  const handlePriceClick = (
    e: React.MouseEvent,
    line: ParsedBettingLine | null,
    outcomeIndex: number
  ) => {
    e.stopPropagation();
    if (!line) return;
    onMarketSelect(line.market, outcomeIndex);
    setExpandedOutcomeIndex(outcomeIndex);
    onOpenExpand(line.market.id);
  };

  const handleRowClick = () => {
    if (!primaryMarket) return;
    const displayedIndex =
      moneylineDisplay.home?.outcomeIndex ?? primaryMarket.idx?.[0] ?? 0;
    onMarketSelect(primaryMarket.market, displayedIndex);
    setExpandedOutcomeIndex(displayedIndex);
    onToggleExpand(primaryMarket.market.id);
  };

  const gridClass =
    isLive && !showInlineScore
      ? "event-grid-live grid grid-cols-[auto_auto_1fr_auto]"
      : "event-grid-scheduled grid grid-cols-[auto_1fr_auto]";

  return (
    /* biome-ignore lint/a11y/useSemanticElements: can't use <button> here — it contains child <button> and <a> elements */
    <div
      role="button"
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleRowClick();
      }}
      className={cn(
        "sportsbook-event-row border-y overflow-hidden transition-colors",
        isExpanded ? "border-(--kwm-ink)" : "border-(--kwm-hl)"
      )}
    >
      {/* Header bar — hairline, editorial */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-(--kwm-hl)">
        <div className="flex items-baseline gap-4 min-w-0 font-mono text-[12px] uppercase tracking-[0.08em] text-(--kwm-ink-3)">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 text-(--kwm-up) shrink-0">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-(--kwm-up)/60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-(--kwm-up)" />
              </span>
              <span>Live</span>
              {game?.period && (
                <span className="text-(--kwm-ink-3) ml-1">· {game.period}</span>
              )}
            </span>
          ) : (
            <span className="inline-flex items-baseline gap-1.5 text-(--kwm-ink) shrink-0">
              <span className="tabular-nums">
                {gameStart
                  ? formatStartTime(gameStart, { includeDay: false })
                  : "Scheduled"}
              </span>
              {gameStart && (
                <span className="text-(--kwm-ink-3)">
                  · {formatRelativeTime(gameStart)}
                </span>
              )}
            </span>
          )}
          {seriesInfo && (
            <span className="shrink-0 normal-case tracking-normal text-[12px] text-(--kwm-ink-3)">
              {seriesInfo}
            </span>
          )}
          {volume && (
            <span className="tabular-nums shrink-0">
              {formatVolume(volume)} Vol
            </span>
          )}
          {tournament && (
            <span className="truncate hidden lg:inline normal-case tracking-normal text-[12px]">
              · {tournament}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: propagation guard for Game View link */}
          <span role="presentation" onClick={(e) => e.stopPropagation()}>
            <Link
              href={href}
              className="inline-flex items-baseline gap-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-(--kwm-ink-3) hover:text-(--kwm-ink) transition-colors"
            >
              {marketCount > 0 && (
                <span className="tabular-nums text-(--kwm-ink)">
                  {marketCount}
                </span>
              )}
              <span>Game View</span>
              <ChevronRight className="h-3 w-3 translate-y-px" />
            </Link>
          </span>
        </div>
      </div>

      <div>
        {isSingleTeamEvent ? (
          <div className="px-4 py-3.5 flex items-center gap-3">
            <TeamAvatar name={teamNames[0] || event.title} />
            <span className="text-base font-semibold">{event.title}</span>
          </div>
        ) : (
          <div>
            {/* Home / Team 1 */}
            <div
              className={cn(
                gridClass,
                "items-center gap-3 px-4",
                moneylineDisplay.draw ? "pt-3 pb-1.5" : "py-3"
              )}
            >
              {isLive && !showInlineScore && (
                <span className="w-6 text-center text-base font-bold tabular-nums text-(--kwm-ink)">
                  {homeScore}
                </span>
              )}
              <TeamAvatar name={teamNames[0]} />
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate text-base font-semibold text-(--kwm-ink)">
                  {teamNames[0]}
                </span>
                {showInlineScore && homeScore && (
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-(--kwm-ink-2)">
                    {homeScore}
                  </span>
                )}
              </div>
              <div className="w-[106px] flex justify-center">
                {moneylineDisplay.home ? (
                  <PriceButton
                    abbr={homeAbbr}
                    price={homeMoneylinePrice ?? moneylineDisplay.home.price}
                    isFavored={homeFavored}
                    selected={
                      tokenIdForOutcome(
                        moneylineDisplay.home.line.market,
                        moneylineDisplay.home.outcomeIndex
                      ) === selectedOutcomeTokenId
                    }
                    onClick={(e) =>
                      handlePriceClick(
                        e,
                        moneylineDisplay.home?.line ?? null,
                        moneylineDisplay.home?.outcomeIndex ?? 0
                      )
                    }
                  />
                ) : (
                  <span className="text-sm text-(--kwm-ink-dim)">—</span>
                )}
              </div>
              <div className="hidden 3xl:flex w-[132px] justify-center">
                {spread ? (
                  <SpreadCell
                    abbr={homeAbbr}
                    handicap={spread.label || ""}
                    price={homeSpreadPrice ?? spread.prices[0]}
                    selected={
                      tokenIdForOutcome(spread.market, spread.idx?.[0] ?? 0) ===
                      selectedOutcomeTokenId
                    }
                    onClick={(e) =>
                      handlePriceClick(e, spread, spread?.idx?.[0] ?? 0)
                    }
                  />
                ) : (
                  <span className="text-sm text-(--kwm-ink-dim)">—</span>
                )}
              </div>
              <div className="hidden 3xl:flex w-[122px] justify-center">
                {total ? (
                  <TotalCell
                    label="O"
                    line={total.label || ""}
                    price={homeTotalPrice ?? total.prices[0]}
                    selected={
                      tokenIdForOutcome(total.market, total.idx?.[0] ?? 0) ===
                      selectedOutcomeTokenId
                    }
                    onClick={(e) =>
                      handlePriceClick(e, total, total?.idx?.[0] ?? 0)
                    }
                  />
                ) : (
                  <span className="text-sm text-(--kwm-ink-dim)">—</span>
                )}
              </div>
            </div>

            {/* Draw (soccer 3-way markets) */}
            {moneylineDisplay.draw && (
              <div className="flex justify-center px-4 py-0.5">
                <DrawButton
                  price={drawMoneylinePrice ?? moneylineDisplay.draw.price}
                  selected={
                    tokenIdForOutcome(
                      moneylineDisplay.draw.line.market,
                      moneylineDisplay.draw.outcomeIndex
                    ) === selectedOutcomeTokenId
                  }
                  onClick={(e) =>
                    handlePriceClick(
                      e,
                      moneylineDisplay.draw?.line ?? null,
                      moneylineDisplay.draw?.outcomeIndex ?? 0
                    )
                  }
                />
              </div>
            )}

            {/* Away / Team 2 */}
            <div
              className={cn(
                gridClass,
                "items-center gap-3 px-4",
                moneylineDisplay.draw ? "pt-1.5 pb-3" : "py-3"
              )}
            >
              {isLive && !showInlineScore && (
                <span className="w-6 text-center text-base font-bold tabular-nums text-(--kwm-ink)">
                  {awayScore}
                </span>
              )}
              <TeamAvatar name={teamNames[1]} />
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate text-base font-semibold text-(--kwm-ink)">
                  {teamNames[1]}
                </span>
                {showInlineScore && awayScore && (
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-(--kwm-ink-2)">
                    {awayScore}
                  </span>
                )}
              </div>
              <div className="w-[106px] flex justify-center">
                {moneylineDisplay.away ? (
                  <PriceButton
                    abbr={awayAbbr}
                    price={awayMoneylinePrice ?? moneylineDisplay.away.price}
                    isFavored={!homeFavored}
                    selected={
                      tokenIdForOutcome(
                        moneylineDisplay.away.line.market,
                        moneylineDisplay.away.outcomeIndex
                      ) === selectedOutcomeTokenId
                    }
                    onClick={(e) =>
                      handlePriceClick(
                        e,
                        moneylineDisplay.away?.line ?? null,
                        moneylineDisplay.away?.outcomeIndex ?? 0
                      )
                    }
                  />
                ) : (
                  <span className="text-sm text-(--kwm-ink-dim)">—</span>
                )}
              </div>
              <div className="hidden 3xl:flex w-[132px] justify-center">
                {spread ? (
                  <SpreadCell
                    abbr={awayAbbr}
                    handicap={
                      spread.label
                        ? spread.label.startsWith("-")
                          ? `+${spread.label.slice(1)}`
                          : `-${spread.label.replace("+", "")}`
                        : ""
                    }
                    price={awaySpreadPrice ?? spread.prices[1]}
                    selected={
                      tokenIdForOutcome(spread.market, spread.idx?.[1] ?? 1) ===
                      selectedOutcomeTokenId
                    }
                    onClick={(e) =>
                      handlePriceClick(e, spread, spread?.idx?.[1] ?? 1)
                    }
                  />
                ) : (
                  <span className="text-sm text-(--kwm-ink-dim)">—</span>
                )}
              </div>
              <div className="hidden 3xl:flex w-[122px] justify-center">
                {total ? (
                  <TotalCell
                    label="U"
                    line={total.label || ""}
                    price={awayTotalPrice ?? total.prices[1]}
                    selected={
                      tokenIdForOutcome(total.market, total.idx?.[1] ?? 1) ===
                      selectedOutcomeTokenId
                    }
                    onClick={(e) =>
                      handlePriceClick(e, total, total?.idx?.[1] ?? 1)
                    }
                  />
                ) : (
                  <span className="text-sm text-(--kwm-ink-dim)">—</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Expanded panel - stop click propagation so interacting inside doesn't collapse */}
      {expandedMarket && (
        // biome-ignore lint/a11y/noStaticElementInteractions: propagation guard for expanded panel
        <div role="presentation" onClick={(e) => e.stopPropagation()}>
          <ExpandedMarketPanel
            market={expandedMarket}
            isExpanded
            defaultOutcomeIndex={expandedOutcomeIndex}
            moneylineChartTokens={moneylineChartTokens}
            userPositions={expandedMarketPositions}
            tradingAddress={tradingAddress}
          />
        </div>
      )}
    </div>
  );
}

// ── CompactEventRow (mobile) ───────────────────────────────────────

export function CompactEventRow({
  event,
  game,
  onMarketSelect,
  expandedMarketId,
  onToggleExpand,
  onOpenExpand,
  getLivePrice,
  getMarketPositions,
  tradingAddress,
  selectedOutcomeTokenId,
  variant = "live",
  isTennis = false,
}: {
  event: LiveEvent;
  game: LiveGameState | null;
  onMarketSelect: (market: EventMarket, outcomeIndex: number) => void;
  expandedMarketId: string | null;
  onToggleExpand: (marketId: string) => void;
  onOpenExpand: (marketId: string) => void;
  getLivePrice: (
    market: EventMarket | null,
    outcomeIndex: number,
    fallbackPrice: number
  ) => number;
  getMarketPositions: (market: EventMarket) => Position[];
  tradingAddress?: string;
  selectedOutcomeTokenId?: string;
  variant?: SportRowVariant;
  isTennis?: boolean;
}) {
  const moneyline = useMemo(
    () => (event.markets ? findMoneyline(event.markets) : null),
    [event.markets]
  );
  const moneylineDisplay = useMemo(
    () => buildMoneylineDisplayData(event, game, moneyline),
    [event, game, moneyline]
  );
  const teamNames = moneylineDisplay.teamNames;

  const rawScore = game?.score || event.score;
  const [homeScore, awayScore] = parseSportsScore(rawScore);
  const showInlineScore = isTennis || isTennisSetScore(rawScore);
  const href = event.slug
    ? `/events/detail/${event.slug}`
    : `/events/detail/${event.id}`;
  const volume = event.volume24hr || event.volume;
  const homeAbbr = teamAbbr(teamNames[0]);
  const awayAbbr = teamAbbr(teamNames[1]);
  const homeFavored =
    moneylineDisplay.home && moneylineDisplay.away
      ? moneylineDisplay.home.price >= moneylineDisplay.away.price
      : true;
  const homeMoneylinePrice = moneylineDisplay.home
    ? getLivePrice(
        moneylineDisplay.home.line.market,
        moneylineDisplay.home.outcomeIndex,
        moneylineDisplay.home.price
      )
    : null;
  const awayMoneylinePrice = moneylineDisplay.away
    ? getLivePrice(
        moneylineDisplay.away.line.market,
        moneylineDisplay.away.outcomeIndex,
        moneylineDisplay.away.price
      )
    : null;
  const drawMoneylinePrice = moneylineDisplay.draw
    ? getLivePrice(
        moneylineDisplay.draw.line.market,
        moneylineDisplay.draw.outcomeIndex,
        moneylineDisplay.draw.price
      )
    : null;
  const expandedMarket = useMemo(() => {
    if (!expandedMarketId) return null;
    return event.markets?.find((m) => m.id === expandedMarketId) ?? null;
  }, [event.markets, expandedMarketId]);
  const expandedMarketPositions = useMemo(
    () => (expandedMarket ? getMarketPositions(expandedMarket) : []),
    [expandedMarket, getMarketPositions]
  );
  const [expandedOutcomeIndex, setExpandedOutcomeIndex] = useState(0);

  const moneylineChartTokens = useMemo((): MoneylineChartToken[] => {
    const CHART_COLORS = [
      "hsl(221, 83%, 53%)",
      "hsl(142, 76%, 36%)",
      "hsl(35, 92%, 50%)",
      "hsl(280, 100%, 70%)",
    ];
    const ml = moneylineDisplay;
    if (!ml.primaryLine) return [];
    const primaryMarketObj = ml.primaryLine.market;
    const primaryOutcomes = parseMarketOutcomes(primaryMarketObj.outcomes);
    if (
      !isYesNoOutcomes(primaryOutcomes) &&
      primaryMarketObj.clobTokenIds?.length
    ) {
      return ml.primaryLine.outcomes
        .map((name, i) => {
          const tokenId = primaryMarketObj.clobTokenIds?.[i] || "";
          return tokenId
            ? { tokenId, name, color: CHART_COLORS[i % CHART_COLORS.length] }
            : null;
        })
        .filter((t): t is MoneylineChartToken => t !== null);
    }
    const tokens: MoneylineChartToken[] = [];
    let colorIdx = 0;
    if (ml.home) {
      const tid = tokenIdForOutcome(ml.home.line.market, ml.home.outcomeIndex);
      if (tid)
        tokens.push({
          tokenId: tid,
          name: ml.teamNames[0],
          color: CHART_COLORS[colorIdx++ % CHART_COLORS.length],
        });
    }
    if (ml.away) {
      const tid = tokenIdForOutcome(ml.away.line.market, ml.away.outcomeIndex);
      if (tid)
        tokens.push({
          tokenId: tid,
          name: ml.teamNames[1],
          color: CHART_COLORS[colorIdx++ % CHART_COLORS.length],
        });
    }
    if (ml.draw) {
      const tid = tokenIdForOutcome(ml.draw.line.market, ml.draw.outcomeIndex);
      if (tid)
        tokens.push({
          tokenId: tid,
          name: "Draw",
          color: CHART_COLORS[colorIdx % CHART_COLORS.length],
        });
    }
    return tokens;
  }, [moneylineDisplay]);

  const primaryMarket = moneylineDisplay.primaryLine;

  const handleCardTap = () => {
    if (!primaryMarket) return;
    const displayedIndex =
      moneylineDisplay.home?.outcomeIndex ?? primaryMarket.idx?.[0] ?? 0;
    onMarketSelect(primaryMarket.market, displayedIndex);
    setExpandedOutcomeIndex(displayedIndex);
    onToggleExpand(primaryMarket.market.id);
  };

  const handlePriceClick = (
    e: React.MouseEvent,
    choice: { line: ParsedBettingLine; outcomeIndex: number } | null
  ) => {
    e.stopPropagation();
    if (!choice) return;
    onMarketSelect(choice.line.market, choice.outcomeIndex);
    setExpandedOutcomeIndex(choice.outcomeIndex);
    onOpenExpand(choice.line.market.id);
  };

  return (
    /* biome-ignore lint/a11y/useSemanticElements: can't use <button> — contains child <button> and <a> elements */
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardTap}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleCardTap();
      }}
      className={cn(
        "sportsbook-event-row border-y overflow-hidden transition-colors",
        expandedMarket ? "border-(--kwm-ink)" : "border-(--kwm-hl)"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-(--kwm-hl)">
        <div className="flex items-baseline gap-3 min-w-0 font-mono text-[12px] uppercase tracking-[0.08em] text-(--kwm-ink-3)">
          {variant === "live" ? (
            <span className="inline-flex items-center gap-1.5 text-(--kwm-up) shrink-0">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-(--kwm-up)/60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-(--kwm-up)" />
              </span>
              <span>Live</span>
              {game?.period && (
                <span className="text-(--kwm-ink-3) ml-1">· {game.period}</span>
              )}
            </span>
          ) : (
            (() => {
              const gameStart = getGameStartTime(event);
              return (
                <span className="text-(--kwm-ink) tabular-nums shrink-0">
                  {gameStart
                    ? formatStartTime(gameStart, { includeDay: false })
                    : "Scheduled"}
                </span>
              );
            })()
          )}
          {volume && (
            <span className="tabular-nums shrink-0">
              {formatVolume(volume)} Vol
            </span>
          )}
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: propagation guard */}
        <span role="presentation" onClick={(e) => e.stopPropagation()}>
          <Link
            href={href}
            className="inline-flex items-baseline gap-1 font-mono text-[12px] uppercase tracking-[0.08em] text-(--kwm-ink-3) hover:text-(--kwm-ink) transition-colors"
          >
            <span>Game View</span>
            <ChevronRight className="h-3 w-3 translate-y-px" />
          </Link>
        </span>
      </div>
      <div>
        <div
          className={cn(
            "flex items-center justify-between px-3",
            moneylineDisplay.draw ? "pt-2.5 pb-1" : "py-2.5"
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {!showInlineScore && (
              <span className="w-5 text-center text-sm font-bold tabular-nums">
                {homeScore}
              </span>
            )}
            <TeamAvatar name={teamNames[0]} size="sm" />
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate text-sm font-semibold">
                {teamNames[0]}
              </span>
              {showInlineScore && homeScore && (
                <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-(--kwm-ink-2)">
                  {homeScore}
                </span>
              )}
            </div>
          </div>
          {moneylineDisplay.home && (
            <PriceButton
              abbr={homeAbbr}
              price={homeMoneylinePrice ?? moneylineDisplay.home.price}
              isFavored={homeFavored}
              selected={
                tokenIdForOutcome(
                  moneylineDisplay.home.line.market,
                  moneylineDisplay.home.outcomeIndex
                ) === selectedOutcomeTokenId
              }
              className="text-xs px-2.5 py-1.5"
              onClick={(e) => {
                handlePriceClick(
                  e,
                  moneylineDisplay.home
                    ? {
                        line: moneylineDisplay.home.line,
                        outcomeIndex: moneylineDisplay.home.outcomeIndex,
                      }
                    : null
                );
              }}
            />
          )}
        </div>
        {moneylineDisplay.draw && (
          <div className="flex justify-center px-3 py-0.5">
            <DrawButton
              price={drawMoneylinePrice ?? moneylineDisplay.draw.price}
              selected={
                tokenIdForOutcome(
                  moneylineDisplay.draw.line.market,
                  moneylineDisplay.draw.outcomeIndex
                ) === selectedOutcomeTokenId
              }
              onClick={(e) => {
                handlePriceClick(
                  e,
                  moneylineDisplay.draw
                    ? {
                        line: moneylineDisplay.draw.line,
                        outcomeIndex: moneylineDisplay.draw.outcomeIndex,
                      }
                    : null
                );
              }}
            />
          </div>
        )}
        {teamNames[1] && (
          <div
            className={cn(
              "flex items-center justify-between px-3",
              moneylineDisplay.draw ? "pt-1 pb-2.5" : "py-2.5"
            )}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {!showInlineScore && (
                <span className="w-5 text-center text-sm font-bold tabular-nums">
                  {awayScore}
                </span>
              )}
              <TeamAvatar name={teamNames[1]} size="sm" />
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">
                  {teamNames[1]}
                </span>
                {showInlineScore && awayScore && (
                  <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-(--kwm-ink-2)">
                    {awayScore}
                  </span>
                )}
              </div>
            </div>
            {moneylineDisplay.away && (
              <PriceButton
                abbr={awayAbbr}
                price={awayMoneylinePrice ?? moneylineDisplay.away.price}
                isFavored={!homeFavored}
                selected={
                  tokenIdForOutcome(
                    moneylineDisplay.away.line.market,
                    moneylineDisplay.away.outcomeIndex
                  ) === selectedOutcomeTokenId
                }
                className="text-xs px-2.5 py-1.5"
                onClick={(e) => {
                  handlePriceClick(
                    e,
                    moneylineDisplay.away
                      ? {
                          line: moneylineDisplay.away.line,
                          outcomeIndex: moneylineDisplay.away.outcomeIndex,
                        }
                      : null
                  );
                }}
              />
            )}
          </div>
        )}
      </div>

      {expandedMarket && (
        // biome-ignore lint/a11y/noStaticElementInteractions: propagation guard for expanded panel
        <div role="presentation" onClick={(e) => e.stopPropagation()}>
          <ExpandedMarketPanel
            market={expandedMarket}
            isExpanded
            defaultOutcomeIndex={expandedOutcomeIndex}
            moneylineChartTokens={moneylineChartTokens}
            userPositions={expandedMarketPositions}
            tradingAddress={tradingAddress}
          />
        </div>
      )}
    </div>
  );
}
