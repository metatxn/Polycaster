/**
 * List of sport sub-categories surfaced on /events/sports. Each entry's
 * `slug` is both the URL fragment (/events/sports/{slug}) and the tag
 * slug used against the events API. `""` represents the "All Sports"
 * overview — no slug, no route suffix.
 */
export interface SportCategory {
  label: string;
  value: string;
  tagSlug: string;
}

export const SPORT_CATEGORIES: readonly SportCategory[] = [
  { label: "All Sports", value: "", tagSlug: "sports" },
  { label: "NBA", value: "nba", tagSlug: "nba" },
  { label: "NCAAB", value: "ncaab", tagSlug: "ncaab" },
  { label: "NHL", value: "nhl", tagSlug: "nhl" },
  { label: "Soccer", value: "soccer", tagSlug: "soccer" },
  { label: "Esports", value: "esports", tagSlug: "esports" },
  { label: "Tennis", value: "tennis", tagSlug: "tennis" },
  { label: "Cricket", value: "cricket", tagSlug: "cricket" },
  { label: "UFC", value: "ufc", tagSlug: "ufc" },
  { label: "Football", value: "nfl", tagSlug: "nfl" },
  { label: "Baseball", value: "baseball", tagSlug: "baseball" },
  { label: "Rugby", value: "rugby", tagSlug: "rugby" },
  { label: "Lacrosse", value: "lacrosse", tagSlug: "lacrosse" },
  { label: "Boxing", value: "boxing", tagSlug: "boxing" },
  { label: "Golf", value: "golf", tagSlug: "golf" },
  { label: "Formula 1", value: "f1", tagSlug: "f1" },
  { label: "Table Tennis", value: "table-tennis", tagSlug: "table-tennis" },
  { label: "Chess", value: "chess", tagSlug: "chess" },
] as const;

/**
 * Fast lookup: sport slugs (excluding "" for All Sports) that should be
 * reachable via /events/sports/{slug}. The /events/[tag] route redirects
 * any of these to their canonical /events/sports/* URL.
 */
export const SPORT_SUB_SLUGS: ReadonlySet<string> = new Set(
  SPORT_CATEGORIES.filter((s) => s.value !== "").map((s) => s.value)
);

export function isSportSubSlug(slug: string): boolean {
  return SPORT_SUB_SLUGS.has(slug);
}
