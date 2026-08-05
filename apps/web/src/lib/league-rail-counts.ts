import { gameMatchesLeagues } from "@/hooks/use-sports-websocket";
import { SPORT_GROUPS } from "@/lib/sport-categories";
import type { SportResult } from "@/lib/sports-websocket-manager";

/**
 * Pure count-selection and overlay logic for the league rail, kept out of
 * the component so the slug-hygiene and correction rules are unit-testable.
 */

/**
 * Slugs the rail actually displays — nothing more:
 * - leaf sports (no leagues) always show their broad tag count;
 * - closed groups show their broad tag count;
 * - open groups display the sum of child league counts, so only the
 *   children are requested and the broad group tag is dropped. Closing a
 *   group removes its children from the next request.
 */
export function getCountTagSlugs(
  openGroupSlugs: ReadonlySet<string>
): string[] {
  const slugs = new Set<string>();
  for (const group of SPORT_GROUPS) {
    const isOpen = group.leagues.length > 0 && openGroupSlugs.has(group.slug);
    if (!isOpen) {
      if (group.tagSlug) slugs.add(group.tagSlug);
      continue;
    }
    for (const league of group.leagues) {
      if (league.tagSlug) slugs.add(league.tagSlug);
    }
  }
  return Array.from(slugs).sort();
}

const LEAGUE_MATCHERS = SPORT_GROUPS.flatMap((group) =>
  group.leagues.map((league) => ({
    tagSlug: league.tagSlug,
    // A closed group displays its broad tag count, which includes the ended
    // game too — correct it alongside the league tag. Undefined when the
    // group reuses the league's tag (e.g. football/nfl), so the shared key
    // is only ever decremented once per game.
    groupTagSlug:
      group.tagSlug && group.tagSlug !== league.tagSlug
        ? group.tagSlug
        : undefined,
    matchSet: new Set([league.slug.toLowerCase()]),
  }))
);

/**
 * Ended games per displayed tag slug, from the Sports WebSocket. Gamma's
 * schedule baseline (`start_time_min = now - 8h`) keeps counting an event
 * until its market closes, so a game the WebSocket reports as `ended` is a
 * known overcount until then. Each game corrects its league tag AND its
 * parent group's broad tag (closed groups display the broad count). A game
 * that matches no configured league is ignored (fail-safe: the baseline
 * stands).
 *
 * Corrections are deliberately NOT rebased when a fresh Gamma snapshot
 * arrives: Gamma still counts the ended event, so rebasing on each poll
 * would reinstate the overcount. The cost is a bounded double-subtract
 * (clamped at zero) in the window between the market closing upstream and
 * the 30-minute ended-game eviction — and, mirrored, a game evicted while
 * its market is still open reverts to the baseline's +1 overcount until
 * that market closes. The badge is therefore an accepted ±1-per-ended-game
 * approximation inside those bounded windows; resolving it exactly would
 * take a per-ended-game Gamma market-close lookup, declined as new
 * upstream traffic for a transient badge value.
 */
export function buildEndedCorrections(
  finishedGames: readonly SportResult[]
): Record<string, number> {
  const corrections: Record<string, number> = {};
  for (const game of finishedGames) {
    for (const { tagSlug, groupTagSlug, matchSet } of LEAGUE_MATCHERS) {
      if (gameMatchesLeagues(game, matchSet)) {
        corrections[tagSlug] = (corrections[tagSlug] ?? 0) + 1;
        if (groupTagSlug) {
          corrections[groupTagSlug] = (corrections[groupTagSlug] ?? 0) + 1;
        }
        break;
      }
    }
  }
  return corrections;
}

/** Apply ended-game corrections to snapshot counts, never below zero. */
export function applyEndedCorrections(
  byTagSlug: Record<string, number>,
  corrections: Record<string, number>
): Record<string, number> {
  let changed = false;
  const adjusted: Record<string, number> = {};
  for (const [slug, count] of Object.entries(byTagSlug)) {
    const correction = corrections[slug];
    if (correction === undefined) {
      adjusted[slug] = count;
      continue;
    }
    adjusted[slug] = Math.max(0, count - correction);
    changed = true;
  }
  return changed ? adjusted : byTagSlug;
}
