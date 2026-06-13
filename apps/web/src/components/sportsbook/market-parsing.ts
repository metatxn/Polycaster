import {
  parseGammaNumberArray,
  parseGammaStringArray,
  resolveNegRisk,
} from "@knoww/shared-types/polymarket";
import type {
  EventMarket,
  LiveEvent,
  LiveGameState,
  MoneylineChoice,
  MoneylineDisplayData,
  ParsedBettingLine,
  SelectedMarketInfo,
} from "./types";

// ── Market parsing helpers ─────────────────────────────────────────

export function parseMarketOutcomes(json: string | undefined): string[] {
  return parseGammaStringArray(json);
}

export function parseMarketPrices(json: string | undefined): number[] {
  return parseGammaNumberArray(json);
}

function isResolvedPrice(prices: number[]): boolean {
  // Polymarket resolved markets consistently report 0.9995/0.0005.
  // Active markets with strong favorites can reach 0.9950, so the
  // threshold must sit between those two values.
  return prices.every((p) => p <= 0.001 || p >= 0.999);
}

export function isYesNoOutcomes(outcomes: string[]): boolean {
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
  const outcomes = parseMarketOutcomes(market.outcomes);
  const prices = parseMarketPrices(market.outcomePrices);
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

export function buildMoneylineDisplayData(
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
        const idx = isYesNoOutcomes(
          parseMarketOutcomes(drawLine.market.outcomes)
        )
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

export function resolveOutcomeTokenIds(market: EventMarket): Array<{
  name: string;
  tokenId: string;
  price: number;
  originalIndex: number;
}> {
  if (!market.conditionId) return [];

  const outcomes = parseMarketOutcomes(market.outcomes);
  const prices = parseMarketPrices(market.outcomePrices);
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

export function findMoneyline(
  markets: EventMarket[]
): ParsedBettingLine | null {
  const explicitMoneyline = markets.find(
    (m) => m.sportsMarketType === "moneyline"
  );
  if (explicitMoneyline) {
    const line = parseBettingLine(explicitMoneyline);
    if (line) return line;
  }

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
        !q.includes(" - ") &&
        !q.includes("points") &&
        !q.includes("rebounds") &&
        !q.includes("assists") &&
        !q.includes("map") &&
        !q.includes("1h ") &&
        q.includes(" vs"));
    if (!isMatch) continue;
    const outcomes = parseMarketOutcomes(m.outcomes);
    const prices = parseMarketPrices(m.outcomePrices);
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

export function findSpread(
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

    const outcomes = parseMarketOutcomes(m.outcomes);
    const prices = parseMarketPrices(m.outcomePrices);
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
  const outcomes = parseMarketOutcomes(m.outcomes);
  const prices = parseMarketPrices(m.outcomePrices);
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

export function findTotal(markets: EventMarket[]): ParsedBettingLine | null {
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

export function teamAbbr(name: string): string {
  if (name.length <= 3) return name.toUpperCase();
  const words = name.split(/\s+/);
  if (words.length >= 2)
    return words
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 3);
  return name.slice(0, 3).toUpperCase();
}

export function parseTeamsFromTitle(title: string): [string, string] | null {
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

export function getSeriesInfo(title: string): string | null {
  const boMatch = title.match(/\(BO(\d+)\)/i);
  return boMatch ? `Best of ${boMatch[1]}` : null;
}

export function getTournamentInfo(title: string): string | null {
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
      negRisk: resolveNegRisk(market, event),
    },
    mapRawIndex: (raw: number) => rawToFiltered.get(raw) ?? 0,
  };
}
