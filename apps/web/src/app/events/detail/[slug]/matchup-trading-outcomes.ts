import type { EventTeam } from "@/hooks/use-event-detail";
import type { OutcomeData } from "@/types/market";

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

export function compactMatchupOutcomeName(
  rawName: string,
  teams: readonly EventTeam[] | undefined
): string {
  const team = matchTeam(rawName, teams);
  if (team) return teamShortName(team);

  return rawName.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function compactMatchupTradingOutcomes(
  outcomes: readonly OutcomeData[],
  teams?: readonly EventTeam[]
): OutcomeData[] {
  return outcomes.map((outcome) => ({
    ...outcome,
    name: compactMatchupOutcomeName(outcome.name, teams),
  }));
}
