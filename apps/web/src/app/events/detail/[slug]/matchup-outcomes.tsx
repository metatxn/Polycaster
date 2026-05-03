"use client";

import { BookOpen, Info, LineChart } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EventTeam } from "@/hooks/use-event-detail";
import { formatVolume } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * Polymarket-style grouped outcomes for live sports matchup events.
 *
 * Sports events use tabs and market-specific rows to mirror Polymarket:
 * Game Lines, Goalscorers, Exact Score, Halftime Result, Corners, and a
 * fallback tab for any unsupported sports market types.
 *
 * Gated entirely on `event.teams.length === 2` upstream so non-sports events
 * never reach this code path.
 */

const MarketPriceChart = dynamic(
  () =>
    import("@/components/market-price-chart").then((mod) => ({
      default: mod.MarketPriceChart,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[260px] w-full rounded-md" />,
  }
);

const OrderBook = dynamic(
  () =>
    import("@/components/order-book").then((mod) => ({
      default: mod.OrderBook,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[320px] w-full rounded-md" />,
  }
);

export interface MatchupMarketRow {
  id: string;
  conditionId: string;
  question: string;
  groupItemTitle: string;
  yesPrice: string;
  noPrice: string;
  displayYesPrice?: string;
  displayNoPrice?: string;
  yesTokenId: string;
  noTokenId: string;
  volume: string | number;
  negRisk?: boolean;
  sportsMarketType?: string;
  parentEventId?: string;
  parentEventTitle?: string;
  rawOutcomes?: string[];
  description?: string;
  endDate?: string;
  createdAt?: string;
  resolutionSource?: string;
  resolvedBy?: string;
}

interface MatchupOutcomesProps {
  markets: MatchupMarketRow[];
  teams: [EventTeam, EventTeam];
  /** Currently selected market id (highlights the active button). */
  selectedMarketId: string;
  /** 0 = YES side, 1 = NO side. */
  selectedOutcomeIndex: number;
  /** Sets the trading panel's market and which side (YES or NO) is active. */
  onSelect: (marketId: string, outcomeIndex: 0 | 1) => void;
}

type MatchupTabId =
  | "game-lines"
  | "goalscorers"
  | "exact-score"
  | "halftime-result"
  | "corners"
  | "more";

interface OutcomeButton {
  key: string;
  marketId: string;
  outcomeIndex: 0 | 1;
  label: string;
  price: string;
  accent?: string;
}

interface MarketRow {
  id: string;
  title: string;
  volume: number;
  buttons: OutcomeButton[];
}

interface MarketSection {
  id: string;
  title: string;
  volume: number;
  rows: MarketRow[];
}

type SportsCard =
  | { kind: "row"; row: MarketRow }
  | { kind: "section"; section: MarketSection };

type MarketDetailTab = "orderbook" | "graph" | "about";

interface SportsTab {
  id: MatchupTabId;
  label: string;
  cards: SportsCard[];
}

const TAB_ORDER: Array<{ id: MatchupTabId; label: string }> = [
  { id: "game-lines", label: "Game Lines" },
  { id: "goalscorers", label: "Goalscorers" },
  { id: "exact-score", label: "Exact Score" },
  { id: "halftime-result", label: "Halftime Result" },
  { id: "corners", label: "Corners" },
  { id: "more", label: "More" },
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.\s+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketVolume(market: MatchupMarketRow): number {
  const parsed = Number.parseFloat(String(market.volume ?? 0));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumVolume(markets: MatchupMarketRow[]): number {
  return markets.reduce((sum, market) => sum + marketVolume(market), 0);
}

function formatPriceCents(priceStr: string): string {
  const n = Number.parseFloat(priceStr);
  if (!Number.isFinite(n)) return "—";
  const cents = n * 100;
  if (cents < 1 && cents > 0) return `${cents.toFixed(1)}¢`;
  return `${Math.round(cents)}¢`;
}

function teamShortName(team: EventTeam): string {
  const explicit = team.abbreviation?.trim();
  if (explicit) return explicit.toUpperCase();
  const firstWord = team.name.trim().split(/\s+/)[0] || team.name;
  return firstWord.slice(0, 3).toUpperCase();
}

function matchTeam(
  rawValue: string | undefined,
  teams: [EventTeam, EventTeam]
): EventTeam | undefined {
  const normalized = normalizeText(rawValue ?? "");
  if (!normalized) return undefined;
  return teams.find((team) => {
    const teamName = normalizeText(team.name);
    const abbr = normalizeText(team.abbreviation ?? "");
    return (
      normalized === teamName ||
      teamName.includes(normalized) ||
      normalized.includes(teamName) ||
      (!!abbr && normalized === abbr)
    );
  });
}

function labelForTeamOrText(
  rawValue: string | undefined,
  teams: [EventTeam, EventTeam],
  options: { compactTeam?: boolean } = {}
): string {
  const raw = (rawValue ?? "").trim();
  if (!raw) return "";
  if (normalizeText(raw).startsWith("draw")) return "DRAW";
  const team = matchTeam(raw, teams);
  if (team) return options.compactTeam ? teamShortName(team) : team.name;
  return raw.length > 28 ? raw.slice(0, 28).trim() : raw;
}

function accentForLabel(
  rawValue: string | undefined,
  teams: [EventTeam, EventTeam]
): string | undefined {
  return matchTeam(rawValue, teams)?.color;
}

function makeButton(
  market: MatchupMarketRow,
  outcomeIndex: 0 | 1,
  label: string,
  price: string,
  accent?: string
): OutcomeButton {
  return {
    key: `${market.id}-${outcomeIndex}`,
    marketId: market.id,
    outcomeIndex,
    label,
    price,
    accent,
  };
}

function displayedPrice(
  market: MatchupMarketRow,
  outcomeIndex: 0 | 1,
  fallbackPrice: string
): string {
  return (
    (outcomeIndex === 0 ? market.displayYesPrice : market.displayNoPrice) ??
    fallbackPrice
  );
}

function binaryButtons(
  market: MatchupMarketRow,
  teams: [EventTeam, EventTeam],
  labels?: [string, string]
): OutcomeButton[] {
  const outcomes = market.rawOutcomes ?? [];
  const yesLabel =
    labels?.[0] ??
    labelForTeamOrText(outcomes[0] ?? "YES", teams, { compactTeam: true }) ??
    "YES";
  const noLabel =
    labels?.[1] ??
    labelForTeamOrText(outcomes[1] ?? "NO", teams, { compactTeam: true }) ??
    "NO";
  return [
    makeButton(
      market,
      0,
      yesLabel,
      displayedPrice(market, 0, market.yesPrice),
      accentForLabel(outcomes[0], teams)
    ),
    makeButton(
      market,
      1,
      noLabel,
      displayedPrice(market, 1, market.noPrice),
      accentForLabel(outcomes[1], teams)
    ),
  ];
}

function titleForMarket(market: MatchupMarketRow): string {
  return market.groupItemTitle.replace(/\s*\([^)]*vs\.[^)]*\)\s*$/i, "").trim();
}

function extractLine(value: string | undefined): string {
  const match = (value ?? "").match(/([+-]?\d+(?:\.\d+)?)/);
  return match?.[1] ?? "";
}

function invertLine(line: string): string {
  if (!line) return "";
  if (line.startsWith("-")) return `+${line.slice(1)}`;
  if (line.startsWith("+")) return `-${line.slice(1)}`;
  return `-${line}`;
}

function formatSpreadButtons(
  market: MatchupMarketRow,
  teams: [EventTeam, EventTeam]
): OutcomeButton[] {
  const line = extractLine(market.groupItemTitle || market.question);
  const outcomes = market.rawOutcomes ?? [];
  const firstLabel = [
    labelForTeamOrText(outcomes[0], teams, { compactTeam: true }),
    line,
  ]
    .filter(Boolean)
    .join(" ");
  const secondLabel = [
    labelForTeamOrText(outcomes[1], teams, { compactTeam: true }),
    invertLine(line),
  ]
    .filter(Boolean)
    .join(" ");
  return [
    makeButton(
      market,
      0,
      firstLabel || "YES",
      displayedPrice(market, 0, market.yesPrice),
      accentForLabel(outcomes[0], teams)
    ),
    makeButton(
      market,
      1,
      secondLabel || "NO",
      displayedPrice(market, 1, market.noPrice),
      accentForLabel(outcomes[1], teams)
    ),
  ];
}

function formatTotalButtons(market: MatchupMarketRow): OutcomeButton[] {
  const line = extractLine(market.groupItemTitle || market.question);
  const outcomes = market.rawOutcomes ?? [];
  const labelFor = (raw: string | undefined, fallback: string) => {
    const normalized = normalizeText(raw ?? "");
    if (normalized.startsWith("over"))
      return ["O", line].filter(Boolean).join(" ");
    if (normalized.startsWith("under"))
      return ["U", line].filter(Boolean).join(" ");
    return [fallback, line].filter(Boolean).join(" ");
  };
  return [
    makeButton(
      market,
      0,
      labelFor(outcomes[0], "O"),
      displayedPrice(market, 0, market.yesPrice)
    ),
    makeButton(
      market,
      1,
      labelFor(outcomes[1], "U"),
      displayedPrice(market, 1, market.noPrice)
    ),
  ];
}

function moneylineRank(label: string, teams: [EventTeam, EventTeam]): number {
  const normalized = normalizeText(label);
  if (normalized.startsWith("draw")) return 1;
  if (matchTeam(label, [teams[0], teams[0]])) return 0;
  if (matchTeam(label, [teams[1], teams[1]])) return 2;
  return 3;
}

function buildMoneylineRow(
  moneylineMarkets: MatchupMarketRow[],
  teams: [EventTeam, EventTeam]
): MarketRow | null {
  if (moneylineMarkets.length === 0) return null;
  const sorted = [...moneylineMarkets].sort(
    (a, b) =>
      moneylineRank(a.groupItemTitle, teams) -
      moneylineRank(b.groupItemTitle, teams)
  );
  if (sorted.length === 1) {
    const market = sorted[0];
    return {
      id: "moneyline",
      title: "Moneyline",
      volume: marketVolume(market),
      buttons: binaryButtons(market, teams),
    };
  }
  return {
    id: "moneyline",
    title: "Moneyline",
    volume: sumVolume(sorted),
    buttons: sorted.map((market) => {
      const label = labelForTeamOrText(market.groupItemTitle, teams, {
        compactTeam: true,
      });
      return makeButton(
        market,
        0,
        label || "YES",
        displayedPrice(market, 0, market.yesPrice),
        accentForLabel(market.groupItemTitle, teams)
      );
    }),
  };
}

function buildCombinedYesRow(
  id: string,
  title: string,
  markets: MatchupMarketRow[],
  teams: [EventTeam, EventTeam]
): MarketRow | null {
  if (markets.length === 0) return null;
  const sorted = [...markets].sort(
    (a, b) =>
      moneylineRank(a.groupItemTitle, teams) -
      moneylineRank(b.groupItemTitle, teams)
  );
  return {
    id,
    title,
    volume: sumVolume(sorted),
    buttons: sorted.map((market) =>
      makeButton(
        market,
        0,
        labelForTeamOrText(market.groupItemTitle, teams, {
          compactTeam: true,
        }) || "YES",
        displayedPrice(market, 0, market.yesPrice),
        accentForLabel(market.groupItemTitle, teams)
      )
    ),
  };
}

function sectionFromMarkets(
  id: string,
  title: string,
  markets: MatchupMarketRow[],
  teams: [EventTeam, EventTeam],
  buttonsForMarket: (
    market: MatchupMarketRow,
    teams: [EventTeam, EventTeam]
  ) => OutcomeButton[]
): MarketSection | null {
  if (markets.length === 0) return null;
  return {
    id,
    title,
    volume: sumVolume(markets),
    rows: markets.map((market) => ({
      id: market.id,
      title: titleForMarket(market),
      volume: marketVolume(market),
      buttons: buttonsForMarket(market, teams),
    })),
  };
}

function rowFromMarket(
  market: MatchupMarketRow,
  teams: [EventTeam, EventTeam],
  options: { useRawOutcomeLabels?: boolean } = {}
): MarketRow {
  return {
    id: market.id,
    title: titleForMarket(market),
    volume: marketVolume(market),
    buttons: options.useRawOutcomeLabels
      ? binaryButtons(market, teams)
      : binaryButtons(market, teams, ["YES", "NO"]),
  };
}

function tabIdForMarket(market: MatchupMarketRow): MatchupTabId {
  const type = (market.sportsMarketType ?? "").toLowerCase();
  const label = normalizeText(`${market.groupItemTitle} ${market.question}`);
  if (type === "moneyline" || type === "spreads" || type === "totals")
    return "game-lines";
  if (type === "both_teams_to_score") return "game-lines";
  if (type.includes("goalscorer") || label.includes("goalscorer"))
    return "goalscorers";
  if (type.includes("exact_score") || label.includes("exact score"))
    return "exact-score";
  if (type.includes("halftime") || label.includes("halftime"))
    return "halftime-result";
  if (type.includes("corner") || label.includes("corner")) return "corners";
  return "more";
}

function sortLineMarkets(markets: MatchupMarketRow[]): MatchupMarketRow[] {
  return [...markets].sort((a, b) => {
    const aLine = Math.abs(Number.parseFloat(extractLine(a.groupItemTitle)));
    const bLine = Math.abs(Number.parseFloat(extractLine(b.groupItemTitle)));
    if (Number.isFinite(aLine) && Number.isFinite(bLine) && aLine !== bLine) {
      return aLine - bLine;
    }
    return marketVolume(b) - marketVolume(a);
  });
}

function buildSportsTabs(
  markets: MatchupMarketRow[],
  teams: [EventTeam, EventTeam]
): SportsTab[] {
  const cardsByTab = new Map<MatchupTabId, SportsCard[]>();
  const usedMarketIds = new Set<string>();
  const addCard = (tabId: MatchupTabId, card: SportsCard) => {
    const cards = cardsByTab.get(tabId) ?? [];
    cards.push(card);
    cardsByTab.set(tabId, cards);
  };
  const markUsed = (items: MatchupMarketRow[]) => {
    for (const item of items) usedMarketIds.add(item.id);
  };

  const moneylineMarkets = markets.filter(
    (market) => (market.sportsMarketType ?? "").toLowerCase() === "moneyline"
  );
  const moneyline = buildMoneylineRow(moneylineMarkets, teams);
  if (moneyline) {
    addCard("game-lines", { kind: "row", row: moneyline });
    markUsed(moneylineMarkets);
  }

  const cricketTopBatter = markets.filter(
    (market) =>
      (market.sportsMarketType ?? "").toLowerCase() ===
      "cricket_team_top_batter"
  );
  const topBatter = buildCombinedYesRow(
    "cricket-team-top-batter",
    "Team Top Batter",
    cricketTopBatter,
    teams
  );
  if (topBatter) {
    addCard("game-lines", { kind: "row", row: topBatter });
    markUsed(cricketTopBatter);
  }

  const cricketMostSixes = markets.filter(
    (market) =>
      (market.sportsMarketType ?? "").toLowerCase() === "cricket_most_sixes"
  );
  const mostSixes = buildCombinedYesRow(
    "cricket-most-sixes",
    "Most Sixes",
    cricketMostSixes,
    teams
  );
  if (mostSixes) {
    addCard("game-lines", { kind: "row", row: mostSixes });
    markUsed(cricketMostSixes);
  }

  const cricketTossDouble = markets.filter(
    (market) =>
      (market.sportsMarketType ?? "").toLowerCase() ===
      "cricket_toss_match_double"
  );
  const tossDouble = buildCombinedYesRow(
    "cricket-toss-match-double",
    "Toss Match Double",
    cricketTossDouble,
    teams
  );
  if (tossDouble) {
    addCard("game-lines", { kind: "row", row: tossDouble });
    markUsed(cricketTossDouble);
  }

  const cricketTossWinner = markets.filter(
    (market) =>
      (market.sportsMarketType ?? "").toLowerCase() === "cricket_toss_winner"
  );
  for (const market of cricketTossWinner) {
    addCard("game-lines", {
      kind: "row",
      row: rowFromMarket(market, teams, { useRawOutcomeLabels: true }),
    });
  }
  markUsed(cricketTossWinner);

  const cricketCompletedMatch = markets.filter(
    (market) =>
      (market.sportsMarketType ?? "").toLowerCase() ===
      "cricket_completed_match"
  );
  for (const market of cricketCompletedMatch) {
    addCard("game-lines", { kind: "row", row: rowFromMarket(market, teams) });
  }
  markUsed(cricketCompletedMatch);

  const spreadMarkets = sortLineMarkets(
    markets.filter(
      (market) => (market.sportsMarketType ?? "").toLowerCase() === "spreads"
    )
  );
  const spreads = sectionFromMarkets(
    "spreads",
    "Spreads",
    spreadMarkets,
    teams,
    formatSpreadButtons
  );
  if (spreads) {
    addCard("game-lines", { kind: "section", section: spreads });
    markUsed(spreadMarkets);
  }

  const totalMarkets = sortLineMarkets(
    markets.filter(
      (market) => (market.sportsMarketType ?? "").toLowerCase() === "totals"
    )
  );
  const totals = sectionFromMarkets(
    "totals",
    "Totals",
    totalMarkets,
    teams,
    (market) => formatTotalButtons(market)
  );
  if (totals) {
    addCard("game-lines", { kind: "section", section: totals });
    markUsed(totalMarkets);
  }

  const bothTeamsToScore = markets.filter(
    (market) =>
      (market.sportsMarketType ?? "").toLowerCase() === "both_teams_to_score"
  );
  for (const market of bothTeamsToScore) {
    addCard("game-lines", { kind: "row", row: rowFromMarket(market, teams) });
  }
  markUsed(bothTeamsToScore);

  const halftimeMarkets = markets.filter(
    (market) => tabIdForMarket(market) === "halftime-result"
  );
  const halftime = buildCombinedYesRow(
    "halftime-result",
    "Halftime Result",
    halftimeMarkets,
    teams
  );
  if (halftime) {
    addCard("halftime-result", { kind: "row", row: halftime });
    markUsed(halftimeMarkets);
  }

  const cornerMarkets = sortLineMarkets(
    markets.filter((market) => tabIdForMarket(market) === "corners")
  );
  const corners = sectionFromMarkets(
    "corners",
    "Total Corners",
    cornerMarkets,
    teams,
    (market) => formatTotalButtons(market)
  );
  if (corners) {
    addCard("corners", { kind: "section", section: corners });
    markUsed(cornerMarkets);
  }

  for (const market of markets) {
    if (usedMarketIds.has(market.id)) continue;
    const tabId = tabIdForMarket(market);
    addCard(tabId, { kind: "row", row: rowFromMarket(market, teams) });
    usedMarketIds.add(market.id);
  }

  return TAB_ORDER.map((tab) => ({
    ...tab,
    cards: cardsByTab.get(tab.id) ?? [],
  })).filter((tab) => tab.cards.length > 0);
}

function cardContainsMarket(card: SportsCard, marketId: string): boolean {
  if (card.kind === "row") {
    return card.row.buttons.some((button) => button.marketId === marketId);
  }
  return card.section.rows.some((row) =>
    row.buttons.some((button) => button.marketId === marketId)
  );
}

function buttonForRowSelection(
  row: MarketRow,
  selectedMarketId: string,
  selectedOutcomeIndex: number
): OutcomeButton | undefined {
  return (
    row.buttons.find(
      (button) =>
        button.marketId === selectedMarketId &&
        button.outcomeIndex === selectedOutcomeIndex
    ) ??
    row.buttons.find((button) => button.marketId === selectedMarketId) ??
    row.buttons[0]
  );
}

function MarketPriceButton({
  button,
  selected,
  onSelect,
}: {
  button: OutcomeButton;
  selected: boolean;
  onSelect: (button: OutcomeButton) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(button)}
      className={cn(
        "flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border/60 bg-muted/20 hover:border-foreground/50 hover:bg-muted/40"
      )}
      style={
        button.accent && !selected
          ? { borderLeftColor: button.accent, borderLeftWidth: 3 }
          : undefined
      }
    >
      <span className="min-w-0 truncate font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">
        {button.label}
      </span>
      <span className="shrink-0 font-mono text-base font-semibold tabular-nums">
        {formatPriceCents(button.price)}
      </span>
    </button>
  );
}

function marketOutcomesForDetail(market: MatchupMarketRow) {
  const outcomes = market.rawOutcomes ?? ["Yes", "No"];
  return [
    {
      name: outcomes[0] || "Yes",
      tokenId: market.yesTokenId,
      price: Number.parseFloat(market.yesPrice) || 0.5,
    },
    {
      name: outcomes[1] || "No",
      tokenId: market.noTokenId,
      price: Number.parseFloat(market.noPrice) || 0.5,
    },
  ];
}

function formatDetailDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function MarketAboutContent({ market }: { market: MatchupMarketRow }) {
  const description = market.description?.trim();
  const openedAt = formatDetailDate(market.createdAt);
  const endDate = formatDetailDate(market.endDate);

  return (
    <div className="space-y-4 p-4 text-sm leading-relaxed text-muted-foreground">
      <div className="max-w-3xl space-y-3">
        {description ? (
          description
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((paragraph) => <p key={paragraph}>{paragraph}</p>)
        ) : (
          <p>Rules are not available for this market yet.</p>
        )}
      </div>

      {(openedAt ||
        endDate ||
        market.resolutionSource ||
        market.resolvedBy) && (
        <dl className="grid gap-3 border-t border-border/50 pt-4 font-mono text-[11px] uppercase tracking-[0.12em] sm:grid-cols-2">
          {openedAt && (
            <div>
              <dt className="text-muted-foreground/70">Market Opened</dt>
              <dd className="mt-1 text-foreground normal-case tracking-normal">
                {openedAt}
              </dd>
            </div>
          )}
          {endDate && (
            <div>
              <dt className="text-muted-foreground/70">End Date</dt>
              <dd className="mt-1 text-foreground normal-case tracking-normal">
                {endDate}
              </dd>
            </div>
          )}
          {market.resolutionSource && (
            <div>
              <dt className="text-muted-foreground/70">Resolution Source</dt>
              <dd className="mt-1 truncate text-foreground normal-case tracking-normal">
                {market.resolutionSource}
              </dd>
            </div>
          )}
          {market.resolvedBy && (
            <div>
              <dt className="text-muted-foreground/70">Resolver</dt>
              <dd className="mt-1 truncate text-foreground normal-case tracking-normal">
                {market.resolvedBy}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function MarketDetailPanel({
  market,
  teams,
  selectedOutcomeIndex,
  activeTab,
  onTabChange,
  onSelect,
}: {
  market: MatchupMarketRow;
  teams: [EventTeam, EventTeam];
  selectedOutcomeIndex: number;
  activeTab: MarketDetailTab;
  onTabChange: (tab: MarketDetailTab) => void;
  onSelect: (marketId: string, outcomeIndex: 0 | 1) => void;
}) {
  const outcomes = marketOutcomesForDetail(market);
  const tokens = outcomes.map((outcome, index) => ({
    tokenId: outcome.tokenId,
    name: labelForTeamOrText(outcome.name, teams) || outcome.name,
    color:
      accentForLabel(outcome.name, teams) ||
      (index === 0 ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)"),
  }));
  const activeTokenId = outcomes[selectedOutcomeIndex]?.tokenId;
  const tabTriggerClass =
    "h-auto flex-none rounded-none border-b-2 border-transparent bg-transparent px-3 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

  return (
    <div className="border-t border-border/50 bg-background/40">
      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(value as MarketDetailTab)}
        className="gap-0"
      >
        <TabsList className="h-auto w-full justify-start gap-0 overflow-x-auto rounded-none border-b border-border/50 bg-transparent p-0">
          <TabsTrigger value="orderbook" className={tabTriggerClass}>
            <BookOpen className="h-3.5 w-3.5" />
            Order Book
          </TabsTrigger>
          <TabsTrigger value="graph" className={tabTriggerClass}>
            <LineChart className="h-3.5 w-3.5" />
            Graph
          </TabsTrigger>
          <TabsTrigger value="about" className={tabTriggerClass}>
            <Info className="h-3.5 w-3.5" />
            About
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orderbook" className="m-0 p-4">
          <OrderBook
            outcomes={outcomes}
            defaultOutcomeIndex={selectedOutcomeIndex}
            onOutcomeChange={(index) =>
              onSelect(market.id, index === 1 ? 1 : 0)
            }
            embedded
            scrollable
          />
        </TabsContent>
        <TabsContent value="graph" className="m-0 p-4">
          <MarketPriceChart
            tokens={tokens}
            activeTokenId={activeTokenId}
            outcomes={outcomes.map((outcome) => outcome.name)}
            outcomePrices={[market.yesPrice, market.noPrice]}
            startDate={market.createdAt}
            hideBothToggle
          />
        </TabsContent>
        <TabsContent value="about" className="m-0">
          <MarketAboutContent market={market} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MarketRowCard({
  row,
  marketsById,
  selectedMarketId,
  selectedOutcomeIndex,
  expandedMarketId,
  teams,
  detailTab,
  onDetailTabChange,
  onSelect,
  onCollapse,
  compact = false,
}: {
  row: MarketRow;
  marketsById: Map<string, MatchupMarketRow>;
  selectedMarketId: string;
  selectedOutcomeIndex: number;
  expandedMarketId: string | null;
  teams: [EventTeam, EventTeam];
  detailTab: MarketDetailTab;
  onDetailTabChange: (tab: MarketDetailTab) => void;
  onSelect: (marketId: string, outcomeIndex: 0 | 1) => void;
  onCollapse: () => void;
  compact?: boolean;
}) {
  const expandedMarket = row.buttons.some(
    (button) => button.marketId === expandedMarketId
  )
    ? marketsById.get(expandedMarketId ?? "")
    : undefined;
  const rowSelectButton = buttonForRowSelection(
    row,
    selectedMarketId,
    selectedOutcomeIndex
  );

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-card/40",
        compact ? "px-3 py-3" : "px-4 py-4"
      )}
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(280px,auto)] md:items-center">
        <button
          type="button"
          className="min-w-0 rounded-sm text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none"
          disabled={!rowSelectButton}
          onClick={() => {
            if (expandedMarket) {
              onCollapse();
              return;
            }
            if (!rowSelectButton) return;
            onSelect(rowSelectButton.marketId, rowSelectButton.outcomeIndex);
          }}
        >
          <h3
            className={cn(
              "truncate font-editorial italic leading-tight text-foreground",
              compact ? "text-base" : "text-lg"
            )}
          >
            {row.title}
          </h3>
          <span className="mt-0.5 block whitespace-nowrap font-mono text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums">
            {formatVolume(row.volume)} Vol.
          </span>
        </button>
        <div
          className={cn(
            "grid gap-2",
            row.buttons.length >= 3
              ? "grid-cols-1 sm:grid-cols-3"
              : "grid-cols-2"
          )}
        >
          {row.buttons.map((button) => (
            <MarketPriceButton
              key={button.key}
              button={button}
              selected={
                selectedMarketId === button.marketId &&
                selectedOutcomeIndex === button.outcomeIndex
              }
              onSelect={(next) => onSelect(next.marketId, next.outcomeIndex)}
            />
          ))}
        </div>
      </div>
      {expandedMarket && (
        <div className={compact ? "mt-3" : "mt-4"}>
          <MarketDetailPanel
            market={expandedMarket}
            teams={teams}
            selectedOutcomeIndex={selectedOutcomeIndex}
            activeTab={detailTab}
            onTabChange={onDetailTabChange}
            onSelect={onSelect}
          />
        </div>
      )}
    </div>
  );
}

function MarketSectionCard({
  section,
  marketsById,
  selectedMarketId,
  selectedOutcomeIndex,
  expandedMarketId,
  teams,
  detailTab,
  onDetailTabChange,
  onSelect,
  onCollapse,
}: {
  section: MarketSection;
  marketsById: Map<string, MatchupMarketRow>;
  selectedMarketId: string;
  selectedOutcomeIndex: number;
  expandedMarketId: string | null;
  teams: [EventTeam, EventTeam];
  detailTab: MarketDetailTab;
  onDetailTabChange: (tab: MarketDetailTab) => void;
  onSelect: (marketId: string, outcomeIndex: 0 | 1) => void;
  onCollapse: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <div className="border-b border-border/50 px-4 py-3">
        <h3 className="font-editorial italic text-lg leading-tight text-foreground">
          {section.title}
        </h3>
        <span className="mt-0.5 block whitespace-nowrap font-mono text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums">
          {formatVolume(section.volume)} Vol.
        </span>
      </div>
      <div className="divide-y divide-border/40">
        {section.rows.map((row) => {
          const expandedMarket =
            expandedMarketId &&
            row.buttons.some((button) => button.marketId === expandedMarketId)
              ? marketsById.get(expandedMarketId)
              : undefined;
          const rowSelectButton = buttonForRowSelection(
            row,
            selectedMarketId,
            selectedOutcomeIndex
          );

          return (
            <div key={row.id} className="px-4 py-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(280px,auto)] md:items-center">
                <button
                  type="button"
                  className="min-w-0 rounded-sm text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none"
                  disabled={!rowSelectButton}
                  onClick={() => {
                    if (expandedMarket) {
                      onCollapse();
                      return;
                    }
                    if (!rowSelectButton) return;
                    onSelect(
                      rowSelectButton.marketId,
                      rowSelectButton.outcomeIndex
                    );
                  }}
                >
                  <p className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {row.title}
                  </p>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  {row.buttons.map((button) => (
                    <MarketPriceButton
                      key={button.key}
                      button={button}
                      selected={
                        selectedMarketId === button.marketId &&
                        selectedOutcomeIndex === button.outcomeIndex
                      }
                      onSelect={(next) =>
                        onSelect(next.marketId, next.outcomeIndex)
                      }
                    />
                  ))}
                </div>
              </div>
              {expandedMarket && (
                <div className="mt-3">
                  <MarketDetailPanel
                    market={expandedMarket}
                    teams={teams}
                    selectedOutcomeIndex={selectedOutcomeIndex}
                    activeTab={detailTab}
                    onTabChange={onDetailTabChange}
                    onSelect={onSelect}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SportsCardView({
  card,
  marketsById,
  selectedMarketId,
  selectedOutcomeIndex,
  expandedMarketId,
  teams,
  detailTab,
  onDetailTabChange,
  onSelect,
  onCollapse,
}: {
  card: SportsCard;
  marketsById: Map<string, MatchupMarketRow>;
  selectedMarketId: string;
  selectedOutcomeIndex: number;
  expandedMarketId: string | null;
  teams: [EventTeam, EventTeam];
  detailTab: MarketDetailTab;
  onDetailTabChange: (tab: MarketDetailTab) => void;
  onSelect: (marketId: string, outcomeIndex: 0 | 1) => void;
  onCollapse: () => void;
}) {
  if (card.kind === "section") {
    return (
      <MarketSectionCard
        section={card.section}
        marketsById={marketsById}
        selectedMarketId={selectedMarketId}
        selectedOutcomeIndex={selectedOutcomeIndex}
        expandedMarketId={expandedMarketId}
        teams={teams}
        detailTab={detailTab}
        onDetailTabChange={onDetailTabChange}
        onSelect={onSelect}
        onCollapse={onCollapse}
      />
    );
  }
  return (
    <MarketRowCard
      row={card.row}
      marketsById={marketsById}
      selectedMarketId={selectedMarketId}
      selectedOutcomeIndex={selectedOutcomeIndex}
      expandedMarketId={expandedMarketId}
      teams={teams}
      detailTab={detailTab}
      onDetailTabChange={onDetailTabChange}
      onSelect={onSelect}
      onCollapse={onCollapse}
      compact={card.row.buttons.length === 2}
    />
  );
}

export function MatchupOutcomes({
  markets,
  teams,
  selectedMarketId,
  selectedOutcomeIndex,
  onSelect,
}: MatchupOutcomesProps & { eventTitle: string }) {
  const tabs = useMemo(() => buildSportsTabs(markets, teams), [markets, teams]);
  const marketsById = useMemo(
    () => new Map(markets.map((market) => [market.id, market])),
    [markets]
  );
  const [activeTab, setActiveTab] = useState<MatchupTabId>("game-lines");
  const [detailTab, setDetailTab] = useState<MarketDetailTab>("orderbook");
  const [expandedMarketId, setExpandedMarketId] = useState<string | null>(null);
  const previousSelectedMarketIdRef = useRef<string | null>(null);

  const handleSelect = (marketId: string, outcomeIndex: 0 | 1) => {
    setDetailTab("orderbook");
    setExpandedMarketId(marketId);
    onSelect(marketId, outcomeIndex);
  };

  const selectedTabId = useMemo(() => {
    return tabs.find((tab) =>
      tab.cards.some((card) => cardContainsMarket(card, selectedMarketId))
    )?.id;
  }, [tabs, selectedMarketId]);

  useEffect(() => {
    if (tabs.length === 0) return;

    const selectedMarketChanged =
      previousSelectedMarketIdRef.current !== selectedMarketId;
    previousSelectedMarketIdRef.current = selectedMarketId;

    if (selectedMarketChanged && selectedTabId && activeTab !== selectedTabId) {
      setActiveTab(selectedTabId);
    }
  }, [activeTab, selectedMarketId, selectedTabId, tabs.length]);

  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [activeTab, tabs]);

  if (tabs.length === 0) return null;

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as MatchupTabId)}
      className="space-y-3"
    >
      <TabsList className="h-auto w-full justify-start gap-4 overflow-x-auto rounded-none border-b border-border/50 bg-transparent p-0">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className="relative h-auto shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-0 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className="m-0">
          <div className="space-y-3">
            {tab.cards.map((card) => (
              <SportsCardView
                key={
                  card.kind === "row" ? `row-${card.row.id}` : card.section.id
                }
                card={card}
                marketsById={marketsById}
                selectedMarketId={selectedMarketId}
                selectedOutcomeIndex={selectedOutcomeIndex}
                expandedMarketId={expandedMarketId}
                teams={teams}
                detailTab={detailTab}
                onDetailTabChange={setDetailTab}
                onSelect={handleSelect}
                onCollapse={() => setExpandedMarketId(null)}
              />
            ))}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
