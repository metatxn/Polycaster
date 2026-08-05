import { describe, expect, it } from "vitest";
import {
  applyEndedCorrections,
  buildEndedCorrections,
  getCountTagSlugs,
} from "./league-rail-counts";
import { SPORT_GROUPS } from "./sport-categories";
import type { SportResult } from "./sports-websocket-manager";

const ALL_LEAGUES = SPORT_GROUPS.flatMap((group) => group.leagues);

function makeGame(overrides: Partial<SportResult> = {}): SportResult {
  return {
    gameId: 1,
    leagueAbbreviation: "",
    homeTeam: "Home",
    awayTeam: "Away",
    status: "ended",
    score: "2-1",
    period: "FT",
    live: false,
    ended: true,
    ...overrides,
  };
}

describe("getCountTagSlugs", () => {
  const closedSlugs = getCountTagSlugs(new Set());

  it("requests exactly the broad group tags when every group is closed", () => {
    const expected = Array.from(
      new Set(SPORT_GROUPS.map((group) => group.tagSlug))
    ).sort();
    expect(closedSlugs).toEqual(expected);
  });

  it("swaps a group's broad tag for its child league tags while open", () => {
    const group = SPORT_GROUPS.find(
      (candidate) =>
        candidate.leagues.length > 1 &&
        !candidate.leagues.some(
          (league) => league.tagSlug === candidate.tagSlug
        )
    );
    expect(group).toBeDefined();

    const openSlugs = getCountTagSlugs(new Set([group?.slug ?? ""]));
    for (const league of group?.leagues ?? []) {
      expect(openSlugs).toContain(league.tagSlug);
    }
    expect(openSlugs).not.toContain(group?.tagSlug);

    // Other groups stay on their broad tags.
    const otherGroup = SPORT_GROUPS.find(
      (candidate) => candidate.slug !== group?.slug
    );
    expect(openSlugs).toContain(otherGroup?.tagSlug);
  });

  it("closing a group removes its children again (pure per call)", () => {
    const group = SPORT_GROUPS.find(
      (candidate) => candidate.leagues.length > 1
    );
    getCountTagSlugs(new Set([group?.slug ?? ""]));
    expect(getCountTagSlugs(new Set())).toEqual(closedSlugs);
  });

  it("ignores open slugs that match no expandable group", () => {
    expect(getCountTagSlugs(new Set(["not-a-group"]))).toEqual(closedSlugs);
  });
});

describe("buildEndedCorrections", () => {
  const group = SPORT_GROUPS.find((candidate) => candidate.leagues.length > 0);
  const league = group?.leagues[0];
  // The parent group's broad tag is corrected alongside the league tag,
  // unless the group reuses the league's tag (then only once).
  const groupTag =
    group?.tagSlug && group.tagSlug !== league?.tagSlug
      ? group.tagSlug
      : undefined;

  it("counts ended games per league tag via the league abbreviation", () => {
    const games = [
      makeGame({ gameId: 1, leagueAbbreviation: league?.slug.toUpperCase() }),
      makeGame({ gameId: 2, leagueAbbreviation: league?.slug ?? "" }),
    ];
    expect(buildEndedCorrections(games)).toEqual({
      [league?.tagSlug ?? ""]: 2,
      ...(groupTag ? { [groupTag]: 2 } : {}),
    });
  });

  it("falls back to the slug's league prefix when the abbreviation is missing", () => {
    const games = [makeGame({ slug: `${league?.slug}-phi-bos-2026-07-30` })];
    expect(buildEndedCorrections(games)).toEqual({
      [league?.tagSlug ?? ""]: 1,
      ...(groupTag ? { [groupTag]: 1 } : {}),
    });
  });

  it("corrects the parent group's broad tag alongside the league tag", () => {
    const parent = SPORT_GROUPS.find(
      (candidate) =>
        candidate.tagSlug &&
        candidate.leagues.some((entry) => entry.tagSlug !== candidate.tagSlug)
    );
    const child = parent?.leagues.find(
      (entry) => entry.tagSlug !== parent?.tagSlug
    );
    expect(child).toBeDefined();

    const games = [makeGame({ leagueAbbreviation: child?.slug ?? "" })];
    expect(buildEndedCorrections(games)).toEqual({
      [child?.tagSlug ?? ""]: 1,
      [parent?.tagSlug ?? ""]: 1,
    });
  });

  it("corrects a tag shared between league and group only once per game", () => {
    const parent = SPORT_GROUPS.find((candidate) =>
      candidate.leagues.some((entry) => entry.tagSlug === candidate.tagSlug)
    );
    const child = parent?.leagues.find(
      (entry) => entry.tagSlug === parent?.tagSlug
    );
    expect(child).toBeDefined();

    const games = [makeGame({ leagueAbbreviation: child?.slug ?? "" })];
    expect(buildEndedCorrections(games)).toEqual({
      [child?.tagSlug ?? ""]: 1,
    });
  });

  it("ignores games that match no configured league (fail-safe)", () => {
    const games = [makeGame({ leagueAbbreviation: "zzz-unknown" })];
    expect(buildEndedCorrections(games)).toEqual({});
  });

  it("only ever produces configured league or group tag slugs", () => {
    const games = ALL_LEAGUES.slice(0, 5).map((entry, index) =>
      makeGame({ gameId: index, leagueAbbreviation: entry.slug })
    );
    const knownTags = new Set(
      [
        ...ALL_LEAGUES.map((entry) => entry.tagSlug),
        ...SPORT_GROUPS.map((entry) => entry.tagSlug),
      ].filter(Boolean)
    );
    for (const tag of Object.keys(buildEndedCorrections(games))) {
      expect(knownTags.has(tag)).toBe(true);
    }
  });
});

describe("applyEndedCorrections", () => {
  it("subtracts corrections and clamps at zero", () => {
    expect(
      applyEndedCorrections({ epl: 5, nba: 1, mlb: 4 }, { epl: 2, nba: 3 })
    ).toEqual({ epl: 3, nba: 0, mlb: 4 });
  });

  it("returns the original object untouched when no correction applies", () => {
    const counts = { epl: 5 };
    expect(applyEndedCorrections(counts, {})).toBe(counts);
    expect(applyEndedCorrections(counts, { nba: 2 })).toBe(counts);
  });

  it("never invents keys the snapshot did not report", () => {
    const adjusted = applyEndedCorrections({ epl: 5 }, { epl: 1, nba: 9 });
    expect(adjusted).toEqual({ epl: 4 });
  });
});
