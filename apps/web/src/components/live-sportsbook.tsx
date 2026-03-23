"use client";

import {
  Calendar,
  ChevronRight,
  Clock,
  History,
  LineChart,
  Radio,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrderBookStore } from "@/hooks/use-orderbook-store";
import { useOrderBookWebSocket } from "@/hooks/use-shared-websocket";
import type { LiveGameState } from "@/hooks/use-sports-websocket";
import { formatPrice, formatVolume } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const OrderBook = dynamic(
  () =>
    import("@/components/order-book").then((mod) => ({
      default: mod.OrderBook,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[250px] w-full rounded-xl" />,
  }
);

const MarketPriceChart = dynamic(
  () =>
    import("@/components/market-price-chart").then((mod) => ({
      default: mod.MarketPriceChart,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[200px] w-full rounded-xl" />,
  }
);

// ── Types ──────────────────────────────────────────────────────────

interface EventMarket {
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
}

export interface LiveEvent {
  id: string;
  slug?: string;
  title: string;
  image?: string;
  volume?: string;
  volume24hr?: number | string;
  score?: string;
  live?: boolean;
  startDate?: string;
  markets?: EventMarket[];
  tags?: Array<string | { id?: string; slug?: string; label?: string }>;
}

interface ParsedBettingLine {
  outcomes: string[];
  prices: number[];
  label?: string;
  market: EventMarket;
  /** Maps display index to original market outcome index (e.g. [1,0] if swapped) */
  idx?: number[];
}

interface MoneylineChoice {
  line: ParsedBettingLine;
  outcomeIndex: number;
  price: number;
}

interface MoneylineDisplayData {
  teamNames: [string, string];
  home: MoneylineChoice | null;
  away: MoneylineChoice | null;
  draw: MoneylineChoice | null;
  primaryLine: ParsedBettingLine | null;
}

export interface SelectedMarketInfo {
  marketId: string;
  eventId: string;
  eventSlug?: string;
  eventTitle: string;
  marketTitle: string;
  marketImage?: string;
  outcomes: Array<{
    name: string;
    tokenId: string;
    price: number;
    probability: number;
  }>;
  conditionId?: string;
  negRisk?: boolean;
}

export interface LiveSportsbookProps {
  events: LiveEvent[];
  eventGameMap: Map<string, LiveGameState | null>;
  onMarketSelect?: (market: SelectedMarketInfo, outcomeIndex: number) => void;
  selectedMarketId?: string;
  selectedOutcomeTokenId?: string;
}

export type ScheduledSportsbookProps = LiveSportsbookProps;

// ── League helpers ─────────────────────────────────────────────────

const LEAGUE_DISPLAY: Record<string, string> = {
  nba: "NBA",
  nfl: "NFL",
  mlb: "MLB",
  nhl: "NHL",
  ncaab: "NCAAB",
  ncaaf: "NCAAF",
  "la-liga": "La Liga",
  "la-liga-2": "La Liga 2",
  bundesliga: "Bundesliga",
  "efl-championship": "EFL Championship",
  "scottish-premiership": "Scottish Premiership",
  "serie-a": "Serie A",
  "serie-b": "Serie B",
  "ligue-1": "Ligue 1",
  "ligue-2": "Ligue 2",
  epl: "Premier League",
  "premier-league": "Premier League",
  ere: "Eredivisie",
  eredivisie: "Eredivisie",
  rus: "Russian Premier League",
  mls: "MLS",
  "liga-mx": "Liga MX",
  ucl: "Champions League",
  "champions-league": "Champions League",
  "europa-league": "Europa League",
  "copa-libertadores": "Copa Libertadores",
  soccer: "Soccer",
  esports: "Esports",
  lol: "League of Legends",
  cs2: "Counter-Strike 2",
  "counter-strike": "Counter-Strike 2",
  dota2: "Dota 2",
  valorant: "Valorant",
  "honor-of-kings": "Honor of Kings",
  "call-of-duty": "Call of Duty",
  tennis: "Tennis",
  cricket: "Cricket",
  ufc: "UFC",
  boxing: "Boxing",
  rugby: "Rugby",
  golf: "Golf",
  f1: "Formula 1",
  lacrosse: "Lacrosse",
  wbc: "WBC",
  baseball: "Baseball",
  "table-tennis": "Table Tennis",
  chess: "Chess",
};

const GENERIC_TAGS = new Set([
  "sports",
  "esports",
  "soccer",
  "games",
  "live",
  "trending",
  "popular",
]);

function getLeagueFromTags(
  tags: Array<string | { slug?: string; label?: string }> | undefined,
  title: string
): string {
  if (!tags?.length) return guessLeagueFromTitle(title);
  const slugs = tags.map((t) => (typeof t === "string" ? t : t.slug || ""));
  const specific = slugs.find(
    (s) => s && !GENERIC_TAGS.has(s) && LEAGUE_DISPLAY[s]
  );
  if (specific) return specific;
  const nonGeneric = slugs.find((s) => s && !GENERIC_TAGS.has(s));
  if (nonGeneric) return nonGeneric;
  return guessLeagueFromTitle(title);
}

function guessLeagueFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.startsWith("lol:") || t.includes("league of legends")) return "lol";
  if (t.startsWith("counter-strike:") || t.startsWith("cs2:")) return "cs2";
  if (t.startsWith("dota 2:") || t.startsWith("dota2:")) return "dota2";
  if (t.startsWith("valorant:")) return "valorant";
  if (t.startsWith("honor of kings:")) return "honor-of-kings";
  if (t.includes("fc") || t.includes("united") || t.includes("city"))
    return "soccer";
  return "other";
}

function leagueDisplayName(slug: string): string {
  return LEAGUE_DISPLAY[slug] || slug.toUpperCase();
}

// ── Market parsing helpers ─────────────────────────────────────────

function safeParse<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function isResolvedPrice(prices: number[]): boolean {
  // Polymarket resolved markets consistently report 0.9995/0.0005.
  // Active markets with strong favorites can reach 0.9950, so the
  // threshold must sit between those two values.
  return prices.every((p) => p <= 0.001 || p >= 0.999);
}

function isYesNoOutcomes(outcomes: string[]): boolean {
  if (outcomes.length !== 2) return false;
  const normalized = outcomes.map((o) => o.trim().toLowerCase());
  return normalized.includes("yes") && normalized.includes("no");
}

function getOutcomeIndex(outcomes: string[], target: "yes" | "no"): number {
  const idx = outcomes.findIndex((o) => o.trim().toLowerCase() === target);
  return idx >= 0 ? idx : 0;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findDrawMarket(
  markets: EventMarket[] | undefined
): ParsedBettingLine | null {
  if (!markets?.length) return null;
  for (const market of markets) {
    const line = parseBettingLine(market);
    if (!line) continue;
    const git = normalizeText(market.groupItemTitle || "");
    const q = normalizeText(market.question || "");
    if (
      git === "draw" ||
      git.startsWith("draw") ||
      (q.includes("draw") && !q.includes("withdraw"))
    ) {
      return line;
    }
  }
  return null;
}

function parseBettingLine(market: EventMarket): ParsedBettingLine | null {
  const outcomes: string[] = safeParse(market.outcomes, []);
  const prices: number[] = safeParse(market.outcomePrices, []).map(Number);
  if (outcomes.length < 2 || prices.length < 2 || isResolvedPrice(prices)) {
    return null;
  }
  return { outcomes, prices, market };
}

function findYesNoLineForTeam(
  markets: EventMarket[] | undefined,
  teamName: string
): ParsedBettingLine | null {
  if (!markets?.length || !teamName) return null;
  const teamNormalized = normalizeText(teamName);
  if (!teamNormalized) return null;

  for (const market of markets) {
    const line = parseBettingLine(market);
    if (!line || !isYesNoOutcomes(line.outcomes)) continue;

    const titleNormalized = normalizeText(market.groupItemTitle || "");
    const questionNormalized = normalizeText(market.question || "");
    const drawMarket =
      titleNormalized.startsWith("draw") || questionNormalized.includes("draw");
    if (drawMarket) continue;

    const titleMatch =
      titleNormalized.length > 0 &&
      (titleNormalized.includes(teamNormalized) ||
        teamNormalized.includes(titleNormalized));
    const questionMatch = questionNormalized.includes(teamNormalized);

    if (titleMatch || questionMatch) {
      return line;
    }
  }

  return null;
}

function getFallbackTeamNames(
  eventTitle: string,
  game: LiveGameState | null
): [string, string] {
  if (game?.homeTeam && game?.awayTeam) {
    return [game.homeTeam, game.awayTeam];
  }
  return parseTeamsFromTitle(eventTitle) ?? [eventTitle, ""];
}

function buildMoneylineDisplayData(
  event: LiveEvent,
  game: LiveGameState | null,
  moneyline: ParsedBettingLine | null
): MoneylineDisplayData {
  const fallbackTeams = getFallbackTeamNames(event.title, game);

  // Non-yes/no moneyline with named outcomes (e.g. "Team A", "Draw", "Team B")
  if (moneyline && !isYesNoOutcomes(moneyline.outcomes)) {
    const drawIdx = moneyline.outcomes.findIndex(
      (o) => o.toLowerCase().trim() === "draw"
    );

    // 3-way market (soccer): extract draw separately
    if (drawIdx >= 0 && moneyline.outcomes.length >= 3) {
      const nonDraw = moneyline.outcomes
        .map((name, i) => ({ name, i }))
        .filter(({ i }) => i !== drawIdx);
      const homeOut = nonDraw[0];
      const awayOut = nonDraw[1];
      return {
        teamNames: [homeOut.name, awayOut?.name ?? ""],
        home: {
          line: moneyline,
          outcomeIndex: homeOut.i,
          price: moneyline.prices[homeOut.i] ?? 0,
        },
        away: awayOut
          ? {
              line: moneyline,
              outcomeIndex: awayOut.i,
              price: moneyline.prices[awayOut.i] ?? 0,
            }
          : null,
        draw: {
          line: moneyline,
          outcomeIndex: drawIdx,
          price: moneyline.prices[drawIdx] ?? 0,
        },
        primaryLine: moneyline,
      };
    }

    // 2-way named market (basketball, etc.)
    return {
      teamNames: [moneyline.outcomes[0], moneyline.outcomes[1]],
      home: {
        line: moneyline,
        outcomeIndex: 0,
        price: moneyline.prices[0] ?? 0,
      },
      away: {
        line: moneyline,
        outcomeIndex: 1,
        price: moneyline.prices[1] ?? 0,
      },
      draw: null,
      primaryLine: moneyline,
    };
  }

  // Yes/No per-team markets — look for each team + draw separately
  const [homeTeam, awayTeam] = fallbackTeams;
  const homeLine = findYesNoLineForTeam(event.markets, homeTeam);
  const awayLine = findYesNoLineForTeam(event.markets, awayTeam);
  const drawLine = findDrawMarket(event.markets);

  const homeChoice: MoneylineChoice | null = homeLine
    ? (() => {
        const idx = getOutcomeIndex(homeLine.outcomes, "yes");
        return {
          line: homeLine,
          outcomeIndex: idx,
          price: homeLine.prices[idx] ?? 0,
        };
      })()
    : null;
  const awayChoice: MoneylineChoice | null = awayLine
    ? (() => {
        const idx = getOutcomeIndex(awayLine.outcomes, "yes");
        return {
          line: awayLine,
          outcomeIndex: idx,
          price: awayLine.prices[idx] ?? 0,
        };
      })()
    : null;
  const drawChoice: MoneylineChoice | null = drawLine
    ? (() => {
        const idx = isYesNoOutcomes(safeParse(drawLine.market.outcomes, []))
          ? getOutcomeIndex(drawLine.outcomes, "yes")
          : 0;
        return {
          line: drawLine,
          outcomeIndex: idx,
          price: drawLine.prices[idx] ?? 0,
        };
      })()
    : null;

  if (homeChoice || awayChoice) {
    return {
      teamNames: fallbackTeams,
      home: homeChoice,
      away: awayChoice,
      draw: drawChoice,
      primaryLine: homeLine ?? awayLine,
    };
  }

  // Last resort: moneyline is a Yes/No market and we couldn't match
  // per-team lines. Only assign the "Yes" side to home — the "No" side
  // is NOT the opposing team's win probability, so leave away as null.
  if (moneyline) {
    const yesIdx = getOutcomeIndex(moneyline.outcomes, "yes");
    return {
      teamNames: fallbackTeams,
      home: {
        line: moneyline,
        outcomeIndex: yesIdx,
        price: moneyline.prices[yesIdx] ?? 0,
      },
      away: null,
      draw: drawChoice,
      primaryLine: moneyline,
    };
  }

  return {
    teamNames: fallbackTeams,
    home: null,
    away: null,
    draw: drawChoice,
    primaryLine: null,
  };
}

function resolveOutcomeTokenIds(market: EventMarket): Array<{
  name: string;
  tokenId: string;
  price: number;
  originalIndex: number;
}> {
  if (!market.conditionId) return [];

  const outcomes: string[] = safeParse(market.outcomes, []);
  const prices: number[] = safeParse(market.outcomePrices, []).map(Number);
  const tokenIds = market.clobTokenIds || [];

  return outcomes
    .map((name, i) => ({
      name,
      tokenId: tokenIds[i] || "",
      price: prices[i] ?? 0,
      originalIndex: i,
    }))
    .filter((o) => o.tokenId);
}

function normalizePrice(price: number): number {
  if (!Number.isFinite(price)) return 0;
  return Math.max(0, Math.min(1, price));
}

function resolveLivePrice(
  tokenId: string | undefined,
  fallbackPrice: number,
  orderBooks: Map<
    string,
    { midpoint: number | null; bestBid: number | null; bestAsk: number | null }
  >,
  lastTrades: Map<string, { price: number }>
): number {
  if (!tokenId) return fallbackPrice;
  const lastTrade = lastTrades.get(tokenId);
  const orderBook = orderBooks.get(tokenId);
  const livePrice =
    lastTrade?.price ??
    orderBook?.midpoint ??
    orderBook?.bestBid ??
    orderBook?.bestAsk;
  return normalizePrice(livePrice ?? fallbackPrice);
}

function tokenIdForOutcome(
  market: EventMarket | null,
  outcomeIndex: number
): string {
  if (!market) return "";
  return market.clobTokenIds?.[outcomeIndex] || "";
}

export function findMoneyline(
  markets: EventMarket[]
): ParsedBettingLine | null {
  for (const m of markets) {
    const git = (m.groupItemTitle || "").toLowerCase();
    const q = (m.question || "").toLowerCase();
    const isMatch =
      git === "match winner" ||
      git === "winner" ||
      (!q.includes("spread") &&
        !q.includes("handicap") &&
        !q.includes("o/u") &&
        !q.includes("total") &&
        !q.includes("points") &&
        !q.includes("rebounds") &&
        !q.includes("assists") &&
        !q.includes("map") &&
        !q.includes("1h ") &&
        q.includes(" vs"));
    if (!isMatch) continue;
    const outcomes: string[] = safeParse(m.outcomes, []);
    const prices: number[] = safeParse(m.outcomePrices, []).map(Number);
    if (
      outcomes.length >= 2 &&
      prices.length >= 2 &&
      !isResolvedPrice(prices)
    ) {
      return { outcomes, prices, market: m };
    }
  }
  return null;
}

function findSpread(
  markets: EventMarket[],
  homeTeam?: string
): ParsedBettingLine | null {
  let best: {
    m: EventMarket;
    outcomes: string[];
    prices: number[];
    label: string;
    balance: number;
  } | null = null;

  for (const m of markets) {
    const q = m.question || "";
    const qLower = q.toLowerCase();
    const git = (m.groupItemTitle || "").toLowerCase();
    if (qLower.includes("1h ")) continue;
    if (
      !(
        qLower.includes("spread") ||
        qLower.includes("handicap") ||
        git.includes("handicap") ||
        git.includes("spread")
      )
    )
      continue;

    const outcomes: string[] = safeParse(m.outcomes, []);
    const prices: number[] = safeParse(m.outcomePrices, []).map(Number);
    if (outcomes.length < 2 || prices.length < 2 || isResolvedPrice(prices))
      continue;

    const handicapMatch =
      q.match(/\(([^)]+)\)/) ||
      (m.groupItemTitle || "").match(/([+-]?\d+\.?\d*)/) ||
      q.match(/([+-]\d+\.?\d*)/);
    const rawLabel = handicapMatch ? handicapMatch[1] : "";
    const balance =
      Math.min(prices[0], prices[1]) / Math.max(prices[0], prices[1]);

    if (!best || balance > best.balance) {
      best = { m, outcomes, prices, label: rawLabel, balance };
    }
  }
  if (!best) return null;

  let finalOutcomes = best.outcomes;
  let finalPrices = best.prices;
  let finalLabel = best.label;
  let finalIdx = [0, 1];

  if (homeTeam) {
    const homeLower = homeTeam.toLowerCase();
    const o0 = best.outcomes[0].toLowerCase();
    const o1 = best.outcomes[1].toLowerCase();
    const isTeamNames =
      o0 !== "yes" && o0 !== "no" && o1 !== "yes" && o1 !== "no";

    if (isTeamNames) {
      const o0IsHome = o0.includes(homeLower) || homeLower.includes(o0);
      const o1IsHome = o1.includes(homeLower) || homeLower.includes(o1);

      if (o1IsHome && !o0IsHome) {
        finalOutcomes = [best.outcomes[1], best.outcomes[0]];
        finalPrices = [best.prices[1], best.prices[0]];
        finalIdx = [1, 0];
      }

      const titleTeam = (best.m.groupItemTitle || "")
        .replace(/\s*\([^)]*\)\s*$/, "")
        .trim()
        .toLowerCase();
      const titleIsHome =
        titleTeam.includes(homeLower) || homeLower.includes(titleTeam);
      if (!titleIsHome && finalLabel) {
        finalLabel = finalLabel.startsWith("-")
          ? `+${finalLabel.slice(1)}`
          : finalLabel.startsWith("+")
            ? `-${finalLabel.slice(1)}`
            : `+${finalLabel}`;
      }
    }
  }

  return {
    outcomes: finalOutcomes,
    prices: finalPrices,
    label: finalLabel,
    market: best.m,
    idx: finalIdx,
  };
}

function tryParseTotal(m: EventMarket): ParsedBettingLine | null {
  const outcomes: string[] = safeParse(m.outcomes, []);
  const prices: number[] = safeParse(m.outcomePrices, []).map(Number);
  if (outcomes.length < 2 || prices.length < 2 || isResolvedPrice(prices))
    return null;
  const q = m.question || "";
  const git = m.groupItemTitle || "";
  const lineMatch =
    q.match(/O\/U\s+([\d.]+)/i) ||
    git.match(/O\/U\s+([\d.]+)/i) ||
    q.match(/Over\/Under\s+([\d.]+)/i) ||
    git.match(/Over\/Under\s+([\d.]+)/i) ||
    q.match(/Total[:\s]+([\d.]+)/i);
  const label = lineMatch ? lineMatch[1] : "";
  return { outcomes, prices, label, market: m };
}

function findTotal(markets: EventMarket[]): ParsedBettingLine | null {
  const candidates: ParsedBettingLine[] = [];

  // Prefer series-level O/U (e.g. "Games Total: O/U 3.5") over per-game kill totals
  for (const m of markets) {
    const git = (m.groupItemTitle || "").toLowerCase();
    const qLower = (m.question || "").toLowerCase();
    if (qLower.includes("1h ")) continue;
    const isSeriesOU =
      (git.includes("o/u") && git.includes("game")) ||
      (qLower.includes("games total") && qLower.includes("o/u"));
    if (!isSeriesOU) continue;
    const line = tryParseTotal(m);
    if (line) return line;
  }
  // Fallback: any O/U or total market that isn't per-game kill totals
  for (const m of markets) {
    const qLower = (m.question || "").toLowerCase();
    const git = (m.groupItemTitle || "").toLowerCase();
    if (qLower.includes("1h ")) continue;
    if (qLower.includes("kill") || git.includes("kill")) continue;
    if (
      qLower.includes("o/u") ||
      git.includes("o/u") ||
      qLower.includes("over/under") ||
      git.includes("over/under") ||
      git === "totals" ||
      git === "total" ||
      git.startsWith("total goals") ||
      (qLower.includes("total") &&
        (git.includes("game") || git.includes("goal")))
    ) {
      const line = tryParseTotal(m);
      if (line) candidates.push(line);
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return normalizeTotal(candidates[0]);

  // Pick the line closest to 50/50
  let bestLine = candidates[0];
  let bestBalance = 0;
  for (const c of candidates) {
    const b =
      Math.min(c.prices[0], c.prices[1]) / Math.max(c.prices[0], c.prices[1]);
    if (b > bestBalance) {
      bestBalance = b;
      bestLine = c;
    }
  }
  return normalizeTotal(bestLine);
}

function normalizeTotal(line: ParsedBettingLine): ParsedBettingLine {
  const o0 = line.outcomes[0]?.toLowerCase() ?? "";
  if (o0 === "under") {
    return {
      outcomes: [line.outcomes[1], line.outcomes[0]],
      prices: [line.prices[1], line.prices[0]],
      label: line.label,
      market: line.market,
      idx: [1, 0],
    };
  }
  return { ...line, idx: line.idx ?? [0, 1] };
}

function teamAbbr(name: string): string {
  if (name.length <= 4) return name.toUpperCase();
  const words = name.split(/\s+/);
  if (words.length >= 2)
    return words
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 4);
  return name.slice(0, 3).toUpperCase();
}

function parseTeamsFromTitle(title: string): [string, string] | null {
  const cleaned = title
    .replace(
      /^(LoL|Counter-Strike|Dota 2|Valorant|Honor of Kings|CSA[^:]*|CS2)[:\s]+/i,
      ""
    )
    .replace(/\s*\(BO\d+\)\s*/i, "")
    .replace(/\s*-\s*[^-]+$/, "");
  const vsMatch = cleaned.split(/\s+vs\.?\s+/i);
  if (vsMatch.length >= 2) return [vsMatch[0].trim(), vsMatch[1].trim()];
  return null;
}

/**
 * Parse scores from Polymarket format.
 * Regular sports: "2-0" → ["2", "0"]
 * Esports (pipe-delimited): "000-000|1-0|Bo3" → ["1", "0"]
 *   The middle segment is the series score; first segment is round-level.
 */
function parseScore(raw: string | undefined): [string, string] {
  if (!raw) return ["", ""];
  if (raw.includes("|")) {
    const segments = raw.split("|");
    const seriesScore = segments[1];
    if (seriesScore) {
      const parts = seriesScore.split("-").map((s) => s.trim());
      return [parts[0] ?? "", parts[1] ?? ""];
    }
  }
  const parts = raw.split("-").map((s) => s.trim());
  return [parts[0] ?? "", parts[1] ?? ""];
}

function getSeriesInfo(title: string): string | null {
  const boMatch = title.match(/\(BO(\d+)\)/i);
  return boMatch ? `Best of ${boMatch[1]}` : null;
}

function getTournamentInfo(title: string): string | null {
  const dashMatch = title.match(/-\s+(.+)$/);
  return dashMatch ? dashMatch[1].trim() : null;
}

export function mapOutcomeNames(
  outcomes: string[],
  market: { groupItemTitle?: string; question?: string },
  eventTitle: string
): string[] {
  if (!isYesNoOutcomes(outcomes)) return outcomes;

  const teamFromMarket = (market.groupItemTitle || "").trim();
  if (!teamFromMarket) return outcomes;

  const teams = parseTeamsFromTitle(eventTitle);
  if (!teams) return outcomes;

  const teamNorm = normalizeText(teamFromMarket);
  const opposing = teams.find((t) => normalizeText(t) !== teamNorm) ?? teams[1];

  return outcomes.map((name) => {
    const lower = name.trim().toLowerCase();
    if (lower === "yes") return teamFromMarket;
    if (lower === "no") return opposing;
    return name;
  });
}

export function buildSelectedMarket(
  event: LiveEvent,
  market: EventMarket
): { info: SelectedMarketInfo; mapRawIndex: (raw: number) => number } {
  const resolved = resolveOutcomeTokenIds(market);
  const companionSlug =
    "_companionSlug" in market
      ? (market as { _companionSlug: string })._companionSlug
      : undefined;

  // Build a map from original market outcome index → filtered array index
  const rawToFiltered = new Map<number, number>();
  resolved.forEach((o, filteredIdx) => {
    rawToFiltered.set(o.originalIndex, filteredIdx);
  });

  return {
    info: {
      marketId: market.id,
      eventId: event.id,
      eventSlug: companionSlug || event.slug,
      eventTitle: event.title,
      marketTitle: market.groupItemTitle || market.question || event.title,
      marketImage: market.image ?? market.icon ?? event.image,
      outcomes: resolved.map((o) => ({
        name: o.name,
        tokenId: o.tokenId,
        price: o.price,
        probability: Math.round(o.price * 100),
      })),
      conditionId: market.conditionId,
    },
    mapRawIndex: (raw: number) => rawToFiltered.get(raw) ?? 0,
  };
}

// ── Components ──────────────────────────────────────────────────────

const TEAM_COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-violet-600",
  "bg-cyan-600",
  "bg-orange-600",
  "bg-teal-600",
  "bg-pink-600",
  "bg-indigo-600",
  "bg-lime-600",
  "bg-fuchsia-600",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function TeamAvatar({
  name,
  imageSrc,
  size = "md",
}: {
  name: string;
  imageSrc?: string;
  size?: "sm" | "md";
}) {
  const initial = name.charAt(0).toUpperCase();
  const colorClass = TEAM_COLORS[hashString(name) % TEAM_COLORS.length];
  const dim = size === "sm" ? 24 : 28;
  const sizeClasses = size === "sm" ? "w-6 h-6 text-[10px]" : "w-7 h-7 text-xs";

  if (imageSrc) {
    return (
      <Image
        src={imageSrc}
        alt={name}
        width={dim}
        height={dim}
        className={cn("rounded-full object-cover shrink-0", sizeClasses)}
        title={name}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full text-white font-bold shrink-0",
        colorClass,
        sizeClasses
      )}
      title={name}
    >
      {initial}
    </span>
  );
}

function PriceButton({
  abbr,
  price,
  isFavored,
  selected = false,
  className,
  onClick,
}: {
  abbr: string;
  price: number;
  isFavored: boolean;
  selected?: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-bold tabular-nums whitespace-nowrap transition-colors cursor-pointer",
        isFavored
          ? "bg-emerald-600/90 text-white hover:bg-emerald-600"
          : "bg-rose-800/70 text-white/90 hover:bg-rose-800/90",
        selected &&
          "ring-2 ring-white/90 dark:ring-white ring-offset-1 ring-offset-background",
        className
      )}
    >
      <span className="font-semibold">{abbr}</span>
      <span>{formatPrice(price)}</span>
    </button>
  );
}

function SpreadCell({
  abbr,
  handicap,
  price,
  selected = false,
  onClick,
}: {
  abbr: string;
  handicap: string;
  price: number;
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-bold tabular-nums whitespace-nowrap bg-muted/80 hover:bg-muted border border-border/50 transition-colors cursor-pointer",
        selected &&
          "border-white/80 dark:border-white ring-1 ring-white/50 dark:ring-white/60"
      )}
    >
      <span className="font-semibold text-foreground/80">
        {abbr} {handicap}
      </span>
      <span className="text-foreground">{formatPrice(price)}</span>
    </button>
  );
}

function TotalCell({
  label,
  line,
  price,
  selected = false,
  onClick,
}: {
  label: string;
  line: string;
  price: number;
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-bold tabular-nums whitespace-nowrap bg-muted/80 hover:bg-muted border border-border/50 transition-colors cursor-pointer",
        selected &&
          "border-white/80 dark:border-white ring-1 ring-white/50 dark:ring-white/60"
      )}
    >
      <span className="font-semibold text-foreground/80">
        {label} {line}
      </span>
      <span className="text-foreground">{formatPrice(price)}</span>
    </button>
  );
}

function DrawButton({
  price,
  selected = false,
  onClick,
}: {
  price: number;
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-bold tabular-nums whitespace-nowrap transition-colors cursor-pointer",
        "bg-amber-600 text-white hover:bg-amber-500 border border-amber-500/40",
        selected &&
          "ring-2 ring-white/90 dark:ring-white ring-offset-1 ring-offset-background"
      )}
    >
      <span className="font-semibold">DRAW</span>
      <span>{formatPrice(price)}</span>
    </button>
  );
}

// ── Expanded market panel (Order Book + Graph) ─────────────────────

interface MoneylineChartToken {
  tokenId: string;
  name: string;
  color: string;
}

function ExpandedMarketPanel({
  market,
  isExpanded,
  defaultOutcomeIndex = 0,
  moneylineChartTokens,
}: {
  market: EventMarket;
  isExpanded: boolean;
  defaultOutcomeIndex?: number;
  moneylineChartTokens?: MoneylineChartToken[];
}) {
  const [activeTab, setActiveTab] = useState("orderbook");
  const outcomeTokens = useMemo(() => resolveOutcomeTokenIds(market), [market]);
  const hasTokenIds = outcomeTokens.some((o) => o.tokenId);

  const chartTokens = useMemo(() => {
    if (moneylineChartTokens && moneylineChartTokens.length > 0) {
      return moneylineChartTokens;
    }
    const colors = [
      "hsl(142, 76%, 36%)",
      "hsl(0, 84%, 60%)",
      "hsl(280, 100%, 70%)",
      "hsl(221, 83%, 53%)",
    ];
    return outcomeTokens
      .filter((o) => o.tokenId)
      .map((o, i) => ({
        tokenId: o.tokenId,
        name: o.name,
        color: colors[i % colors.length],
      }));
  }, [outcomeTokens, moneylineChartTokens]);

  const outcomeNames = useMemo(
    () => chartTokens.map((o) => o.name),
    [chartTokens]
  );
  const outcomePriceStrs = useMemo(
    () => chartTokens.map(() => "0"),
    [chartTokens]
  );

  if (!isExpanded) return null;

  return (
    <div className="border-t border-border/30 bg-muted/10">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex items-center px-4 border-b border-border/30 overflow-x-auto no-scrollbar">
          <TabsList className="h-auto p-0 bg-transparent gap-0 shrink-0 flex">
            <TabsTrigger
              value="orderbook"
              className="h-auto flex-none px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm font-medium"
            >
              <History className="h-3.5 w-3.5 mr-2 inline-block" />
              Order Book
            </TabsTrigger>
            <TabsTrigger
              value="graph"
              className="h-auto flex-none px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm font-medium"
            >
              <LineChart className="h-3.5 w-3.5 mr-2 inline-block" />
              Graph
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="orderbook" className="m-0 p-4">
          {hasTokenIds ? (
            <OrderBook
              outcomes={outcomeTokens.map((o) => ({
                name: o.name,
                tokenId: o.tokenId,
                price: o.price,
              }))}
              defaultOutcomeIndex={defaultOutcomeIndex}
              useWebSocket
              embedded
              maxLevels={8}
            />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              Order book data unavailable for this market.
            </p>
          )}
        </TabsContent>

        <TabsContent value="graph" className="m-0 p-4">
          {chartTokens.length > 0 ? (
            <div className="space-y-3">
              {chartTokens.length > 1 && (
                <div className="flex items-center justify-center gap-4 flex-wrap">
                  {chartTokens.map((token) => (
                    <div
                      key={token.tokenId}
                      className="flex items-center gap-1.5"
                    >
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: token.color }}
                      />
                      <span className="text-sm font-medium text-foreground/80">
                        {token.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <MarketPriceChart
                tokens={chartTokens}
                outcomes={outcomeNames}
                outcomePrices={outcomePriceStrs}
                defaultTimeRange="1D"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              Chart data unavailable for this market.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Event rows ──────────────────────────────────────────────────────

type SportRowVariant = "live" | "scheduled";

function SportEventRow({
  event,
  game,
  variant = "live",
  expandedMarketId,
  onToggleExpand,
  onOpenExpand,
  onMarketSelect,
  getLivePrice,
  selectedOutcomeTokenId,
}: {
  event: LiveEvent;
  game: LiveGameState | null;
  variant?: SportRowVariant;
  expandedMarketId: string | null;
  onToggleExpand: (marketId: string) => void;
  onOpenExpand: (marketId: string) => void;
  onMarketSelect: (market: EventMarket, outcomeIndex: number) => void;
  getLivePrice: (
    market: EventMarket | null,
    outcomeIndex: number,
    fallbackPrice: number
  ) => number;
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

  const [homeScore, awayScore] = parseScore(game?.score || event.score);

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
  const avatarSrc =
    event.markets?.find((m) => m.image)?.image ??
    event.markets?.find((m) => m.icon)?.icon ??
    event.image;

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
    const primaryOutcomes: string[] = safeParse(primaryMarketObj.outcomes, []);

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

  const gridClass = isLive
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
        "border rounded-lg bg-card/50 backdrop-blur-sm overflow-hidden transition-colors cursor-pointer",
        isExpanded ? "border-primary/30" : "border-border/40"
      )}
    >
      {/* Header bar */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-2.5 border-b border-border/30",
          isLive ? "bg-muted/30" : "bg-muted/20"
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          {isLive ? (
            <>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-red-600/90 text-white shrink-0">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                </span>
                <span className="text-xs font-bold uppercase tracking-wider">
                  LIVE
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
                {game?.period && (
                  <span className="font-semibold text-foreground/80 shrink-0">
                    {game.period}
                  </span>
                )}
                {game?.period && seriesInfo && <span>•</span>}
                {seriesInfo && <span className="shrink-0">{seriesInfo}</span>}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-sky-600/80 text-white shrink-0">
                <Clock className="h-3 w-3" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  {gameStart ? formatStartTime(gameStart) : "Scheduled"}
                </span>
              </div>
              {gameStart && (
                <span className="text-xs text-muted-foreground font-medium shrink-0">
                  {formatRelativeTime(gameStart)}
                </span>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
                {seriesInfo && <span className="shrink-0">{seriesInfo}</span>}
              </div>
            </>
          )}
          {volume && (
            <span className="text-xs text-muted-foreground font-medium shrink-0">
              {formatVolume(volume)} Vol.
            </span>
          )}
          {tournament && (
            <span className="text-xs text-muted-foreground truncate hidden lg:inline">
              · {tournament}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: propagation guard for Game View link */}
          <span role="presentation" onClick={(e) => e.stopPropagation()}>
            <Link
              href={href}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              {marketCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold tabular-nums rounded bg-muted/60 leading-none translate-y-px">
                  {marketCount}
                </span>
              )}
              <span>Game View</span>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </span>
        </div>
      </div>

      <div>
        {isSingleTeamEvent ? (
          <div className="px-4 py-3.5 flex items-center gap-3">
            <TeamAvatar
              name={teamNames[0] || event.title}
              imageSrc={avatarSrc}
            />
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
              {isLive && (
                <span className="w-6 text-center text-base font-bold tabular-nums text-foreground">
                  {homeScore}
                </span>
              )}
              <TeamAvatar name={teamNames[0]} imageSrc={avatarSrc} />
              <span className="text-base font-semibold text-foreground truncate">
                {teamNames[0]}
              </span>
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
                  <span className="text-sm text-muted-foreground/50">—</span>
                )}
              </div>
              <div className="hidden lg:flex w-[132px] justify-center">
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
                  <span className="text-sm text-muted-foreground/50">—</span>
                )}
              </div>
              <div className="hidden lg:flex w-[122px] justify-center">
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
                  <span className="text-sm text-muted-foreground/50">—</span>
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
              {isLive && (
                <span className="w-6 text-center text-base font-bold tabular-nums text-foreground">
                  {awayScore}
                </span>
              )}
              <TeamAvatar name={teamNames[1]} imageSrc={avatarSrc} />
              <span className="text-base font-semibold text-foreground truncate">
                {teamNames[1]}
              </span>
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
                  <span className="text-sm text-muted-foreground/50">—</span>
                )}
              </div>
              <div className="hidden lg:flex w-[132px] justify-center">
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
                  <span className="text-sm text-muted-foreground/50">—</span>
                )}
              </div>
              <div className="hidden lg:flex w-[122px] justify-center">
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
                  <span className="text-sm text-muted-foreground/50">—</span>
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
          />
        </div>
      )}
    </div>
  );
}

// Mobile compact row
function CompactEventRow({
  event,
  game,
  onMarketSelect,
  expandedMarketId,
  onToggleExpand,
  onOpenExpand,
  variant = "live",
}: {
  event: LiveEvent;
  game: LiveGameState | null;
  onMarketSelect: (market: EventMarket, outcomeIndex: number) => void;
  expandedMarketId: string | null;
  onToggleExpand: (marketId: string) => void;
  onOpenExpand: (marketId: string) => void;
  variant?: "live" | "scheduled";
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

  const [homeScore, awayScore] = parseScore(game?.score || event.score);
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
  const avatarSrc =
    event.markets?.find((m) => m.image)?.image ??
    event.markets?.find((m) => m.icon)?.icon ??
    event.image;

  const expandedMarket = useMemo(() => {
    if (!expandedMarketId) return null;
    return event.markets?.find((m) => m.id === expandedMarketId) ?? null;
  }, [event.markets, expandedMarketId]);
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
    const primaryOutcomes: string[] = safeParse(primaryMarketObj.outcomes, []);
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
        "border rounded-lg bg-card/50 backdrop-blur-sm overflow-hidden cursor-pointer transition-colors",
        expandedMarket ? "border-primary/30" : "border-border/40"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/30">
        <div className="flex items-center gap-2">
          {variant === "live" ? (
            <>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-600/90 text-white">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                </span>
                <span className="text-xs font-bold uppercase">LIVE</span>
              </div>
              {game?.period && (
                <span className="text-xs font-semibold text-foreground/70">
                  {game.period}
                </span>
              )}
            </>
          ) : (
            (() => {
              const gameStart = getGameStartTime(event);
              return (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-sky-600/80 text-white">
                  <Clock className="h-3 w-3" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {gameStart ? formatStartTime(gameStart) : "Scheduled"}
                  </span>
                </div>
              );
            })()
          )}
          {volume && (
            <span className="text-xs text-muted-foreground">
              {formatVolume(volume)} Vol.
            </span>
          )}
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: propagation guard */}
        <span role="presentation" onClick={(e) => e.stopPropagation()}>
          <Link
            href={href}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-0.5"
          >
            Game View
            <ChevronRight className="h-3.5 w-3.5" />
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
          <div className="flex items-center gap-2.5">
            <span className="w-5 text-center text-sm font-bold tabular-nums">
              {homeScore}
            </span>
            <TeamAvatar name={teamNames[0]} imageSrc={avatarSrc} size="sm" />
            <span className="text-sm font-semibold truncate max-w-[160px]">
              {teamNames[0]}
            </span>
          </div>
          {moneylineDisplay.home && (
            <PriceButton
              abbr={homeAbbr}
              price={moneylineDisplay.home.price}
              isFavored={homeFavored}
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
              price={moneylineDisplay.draw.price}
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
            <div className="flex items-center gap-2.5">
              <span className="w-5 text-center text-sm font-bold tabular-nums">
                {awayScore}
              </span>
              <TeamAvatar name={teamNames[1]} imageSrc={avatarSrc} size="sm" />
              <span className="text-sm font-semibold truncate max-w-[160px]">
                {teamNames[1]}
              </span>
            </div>
            {moneylineDisplay.away && (
              <PriceButton
                abbr={awayAbbr}
                price={moneylineDisplay.away.price}
                isFavored={!homeFavored}
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
          />
        </div>
      )}
    </div>
  );
}

function LeagueSection({
  league,
  events,
  eventGameMap,
  expandedMarketId,
  onToggleExpand,
  onOpenExpand,
  onMarketSelect,
  getLivePrice,
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
  selectedOutcomeTokenId?: string;
}) {
  const leagueIcon = events[0]?.image;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center">
        <div className="flex items-center gap-2.5">
          {leagueIcon && (
            <Image
              src={leagueIcon}
              alt={leagueDisplayName(league)}
              width={24}
              height={24}
              className="rounded object-contain"
            />
          )}
          <h3 className="text-base font-bold text-foreground/90 tracking-wide">
            {leagueDisplayName(league)}
          </h3>
        </div>
      </div>
      <div className="event-grid-live hidden md:grid grid-cols-[auto_auto_1fr_auto] gap-3 border border-transparent px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <span className="w-6 text-center">Score</span>
        <span className="w-7" />
        <span>Team</span>
        <span className="w-[106px] text-center">Moneyline</span>
        <span className="hidden lg:inline w-[132px] text-center">Spread</span>
        <span className="hidden lg:inline w-[122px] text-center">Total</span>
      </div>
      <div className="space-y-2.5">
        {events.map((event) => {
          const game = eventGameMap.get(event.id) ?? null;
          return (
            <div key={event.id}>
              <div className="hidden md:block">
                <SportEventRow
                  variant="live"
                  event={event}
                  game={game}
                  expandedMarketId={expandedMarketId}
                  onToggleExpand={onToggleExpand}
                  onOpenExpand={onOpenExpand}
                  getLivePrice={getLivePrice}
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
                  expandedMarketId={expandedMarketId}
                  onToggleExpand={onToggleExpand}
                  onOpenExpand={onOpenExpand}
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

// ── Time formatting for scheduled events ────────────────────────────

function getGameStartTime(event: LiveEvent): Date | null {
  // Prefer event-level startDate
  if (event.startDate) {
    const d = new Date(event.startDate);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // Scan all markets for the earliest valid gameStartTime
  if (event.markets) {
    let earliest: Date | null = null;
    for (const m of event.markets) {
      if (!m.gameStartTime) continue;
      const d = new Date(m.gameStartTime);
      if (Number.isNaN(d.getTime())) continue;
      if (!earliest || d.getTime() < earliest.getTime()) earliest = d;
    }
    if (earliest) return earliest;
  }

  return null;
}

function formatStartTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (diffHours < 0) return timeStr;
  if (diffHours < 24) {
    const isToday = date.toDateString() === now.toDateString();
    return isToday ? `Today ${timeStr}` : `Tomorrow ${timeStr}`;
  }
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${dateStr} ${timeStr}`;
}

function formatRelativeTime(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  if (diffMs < 0) return "Starting soon";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

function ScheduledLeagueSection({
  league,
  events,
  eventGameMap,
  expandedMarketId,
  onToggleExpand,
  onOpenExpand,
  onMarketSelect,
  getLivePrice,
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
  selectedOutcomeTokenId?: string;
}) {
  const leagueIcon = events[0]?.image;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center">
        <div className="flex items-center gap-2.5">
          {leagueIcon && (
            <Image
              src={leagueIcon}
              alt={leagueDisplayName(league)}
              width={24}
              height={24}
              className="rounded object-contain"
            />
          )}
          <h3 className="text-base font-bold text-foreground/90 tracking-wide">
            {leagueDisplayName(league)}
          </h3>
        </div>
      </div>
      <div className="event-grid-scheduled hidden md:grid grid-cols-[auto_1fr_auto] gap-3 border border-transparent px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <span className="w-7" />
        <span>Team</span>
        <span className="w-[106px] text-center">Moneyline</span>
        <span className="hidden lg:inline w-[132px] text-center">Spread</span>
        <span className="hidden lg:inline w-[122px] text-center">Total</span>
      </div>
      <div className="space-y-2.5">
        {events.map((event) => {
          const game = eventGameMap.get(event.id) ?? null;
          return (
            <div key={event.id}>
              <div className="hidden md:block">
                <SportEventRow
                  variant="scheduled"
                  event={event}
                  game={game}
                  expandedMarketId={expandedMarketId}
                  onToggleExpand={onToggleExpand}
                  onOpenExpand={onOpenExpand}
                  getLivePrice={getLivePrice}
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

// ── Main exports ─────────────────────────────────────────────────────

export function LiveSportsbook({
  events,
  eventGameMap,
  onMarketSelect,
  selectedMarketId: _selectedMarketId,
  selectedOutcomeTokenId,
}: LiveSportsbookProps) {
  const [expandedMarketId, setExpandedMarketId] = useState<string | null>(null);
  const orderBooks = useOrderBookStore((s) => s.orderBooks);
  const lastTrades = useOrderBookStore((s) => s.lastTrades);

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
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-red-600/10 border border-red-600/20">
          <Radio className="h-4.5 w-4.5 text-red-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Live</h2>
          <p className="text-sm text-muted-foreground">
            {events.length} market{events.length !== 1 ? "s" : ""} in progress
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {Array.from(groupedByLeague.entries()).map(([league, leagueEvents]) => (
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
            selectedOutcomeTokenId={selectedOutcomeTokenId}
          />
        ))}
      </div>
    </div>
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
  const orderBooks = useOrderBookStore((s) => s.orderBooks);
  const lastTrades = useOrderBookStore((s) => s.lastTrades);

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
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-sky-600/10 border border-sky-600/20">
          <Calendar className="h-4.5 w-4.5 text-sky-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Upcoming</h2>
          <p className="text-sm text-muted-foreground">
            {events.length} game{events.length !== 1 ? "s" : ""} scheduled
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {Array.from(groupedByLeague.entries()).map(([league, leagueEvents]) => (
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
            selectedOutcomeTokenId={selectedOutcomeTokenId}
          />
        ))}
      </div>
    </div>
  );
}
