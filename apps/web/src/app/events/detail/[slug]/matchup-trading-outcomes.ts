import Decimal from "decimal.js";
import type { EventTeam } from "@/hooks/use-event-detail";
import type { OutcomeData } from "@/types/market";

export interface MatchupTradingMarket {
  id: string;
  groupItemTitle: string;
  yesTokenId: string;
  yesPrice: string;
  displayYesPrice?: string;
}

export interface MatchupTradingOutcome extends OutcomeData {
  marketId: string;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamShortName(team: EventTeam): string {
  const explicit = team.abbreviation?.trim();
  if (explicit) return explicit.toUpperCase();
  const firstWord = team.name.trim().split(/\s+/)[0] || team.name;
  return firstWord.slice(0, 3).toUpperCase();
}

function matchTeam(
  rawValue: string | undefined,
  teams: readonly EventTeam[] | undefined
): EventTeam | undefined {
  const normalized = normalizeText(rawValue ?? "");
  if (!normalized || !teams) return undefined;

  return teams.find((team) => {
    const teamName = normalizeText(team.name);
    const abbr = normalizeText(team.abbreviation ?? "");
    const alias = normalizeText(team.alias ?? "");

    return [teamName, abbr, alias].some(
      (candidate) =>
        candidate &&
        (normalized === candidate ||
          normalized.includes(candidate) ||
          candidate.includes(normalized))
    );
  });
}

function outcomeLabel(
  market: MatchupTradingMarket,
  teams: readonly EventTeam[] | undefined
): string {
  return compactMatchupOutcomeName(market.groupItemTitle, teams) || "YES";
}

export function compactMatchupOutcomeName(
  rawName: string,
  teams: readonly EventTeam[] | undefined
): string {
  const team = matchTeam(rawName, teams);
  if (team) return teamShortName(team);

  return rawName.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function parsePrice(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.5;
}

export function buildMatchupTradingOutcomes(
  markets: readonly MatchupTradingMarket[],
  teams?: readonly EventTeam[]
): MatchupTradingOutcome[] {
  return markets.map((market) => {
    const price = parsePrice(market.displayYesPrice ?? market.yesPrice);

    return {
      marketId: market.id,
      name: outcomeLabel(market, teams),
      tokenId: market.yesTokenId,
      price,
      probability: new Decimal(price).mul(100).round().toNumber(),
    };
  });
}
