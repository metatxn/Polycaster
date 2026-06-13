import type { Event } from "@/hooks/use-event-detail";
import { SPORT_GROUPS } from "@/lib/sport-categories";
import type { OutcomeData } from "@/types/market";

export function normalizeOutcomeName(value: unknown): string {
  if (value == null) return "";

  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getSportsRailActiveSlug(
  event: Event | null | undefined
): string {
  if (!event) return "sports";

  const searchableValues = [
    event.slug,
    event.title,
    ...(event.tags ?? []),
    ...(event.markets ?? []).flatMap((market) => [
      market.slug,
      market.question,
      market.groupItemTitle,
      market.parentEventTitle,
      market.sportsMarketType,
    ]),
    ...(event.teams ?? []).flatMap((team) => [
      team.name,
      team.abbreviation,
      team.alias,
      team.league,
    ]),
  ]
    .map(normalizeOutcomeName)
    .filter(Boolean);

  for (const group of SPORT_GROUPS) {
    for (const league of group.leagues) {
      const leagueCandidates = [league.slug, league.label, league.tagSlug].map(
        normalizeOutcomeName
      );

      if (
        leagueCandidates.some((candidate) =>
          searchableValues.some((value) => value.includes(candidate))
        )
      ) {
        return league.slug;
      }
    }

    const groupCandidates = [group.slug, group.label, group.tagSlug].map(
      normalizeOutcomeName
    );
    if (
      groupCandidates.some((candidate) =>
        searchableValues.some((value) => value.includes(candidate))
      )
    ) {
      return group.slug;
    }
  }

  return "sports";
}

export function findOutcomeIndexFromUrl(
  rawOutcome: string | undefined,
  outcomes: OutcomeData[],
  selectedMarket: { groupItemTitle?: string; question?: string } | null,
  event: Event | null
): number {
  const target = normalizeOutcomeName(rawOutcome);
  if (!target) return -1;

  const directIndex = outcomes.findIndex(
    (outcome) => normalizeOutcomeName(outcome.name) === target
  );
  if (directIndex !== -1) return directIndex;

  if (
    selectedMarket &&
    normalizeOutcomeName(selectedMarket.groupItemTitle) === target
  ) {
    return 0;
  }

  if (event?.teams?.length) {
    const teamIndex = event.teams.findIndex((team) => {
      const names = [team.name, team.abbreviation, team.alias].map(
        normalizeOutcomeName
      );
      return names.some((name) => name && name === target);
    });
    if (teamIndex !== -1) {
      const marketText = normalizeOutcomeName(
        `${selectedMarket?.groupItemTitle ?? ""} ${
          selectedMarket?.question ?? ""
        }`
      );
      const team = event.teams[teamIndex];
      const teamNames = [team.name, team.abbreviation, team.alias]
        .map(normalizeOutcomeName)
        .filter(Boolean);
      if (teamNames.some((name) => marketText.includes(name))) return 0;
    }
  }

  return -1;
}

export function matchupMoneylineRank(
  rawLabel: string | undefined,
  teams: NonNullable<Event["teams"]>
): number {
  const label = normalizeOutcomeName(rawLabel);
  if (!label) return 3;
  if (label.startsWith("draw")) return 1;

  const teamIndex = teams.findIndex((team) => {
    const names = [team.name, team.abbreviation, team.alias]
      .map(normalizeOutcomeName)
      .filter(Boolean);
    return names.some(
      (name) => label === name || label.includes(name) || name.includes(label)
    );
  });

  if (teamIndex === 0) return 0;
  if (teamIndex === 1) return 2;
  return 3;
}

export function matchupMoneylineLabel(
  rawLabel: string | undefined,
  teams: NonNullable<Event["teams"]>
): string {
  const rank = matchupMoneylineRank(rawLabel, teams);
  if (rank === 0) return teams[0]?.name.trim() || "Team A";
  if (rank === 1) return "Draw";
  if (rank === 2) return teams[1]?.name.trim() || "Team B";
  return (rawLabel || "Moneyline").replace(/\s*\([^)]*\)\s*$/, "").trim();
}
