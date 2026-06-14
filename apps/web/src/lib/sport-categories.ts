/**
 * Sport taxonomy surfaced under /events/sports/*. Two-level tree:
 *
 *   SPORT_GROUPS (≈18 top-level entries) → leagues[] (≈60 leaves)
 *
 * Both group and league `slug`s are valid `/events/sports/{slug}` routes.
 * `tagSlug` is the Polymarket Gamma tag the events API filters on (often
 * matches slug; sometimes a short alias, e.g. `bra2` for Brazil Série B).
 */

export interface SportLeague {
  /** URL fragment: /events/sports/{slug} */
  slug: string;
  /** Display label shown in the rail */
  label: string;
  /** Gamma tag slug used by the events API. For most modern leagues
   *  Polymarket exposes events via `series_id` rather than `tag_slug`,
   *  so prefer `seriesId` when present. */
  tagSlug: string;
  /** Polymarket Gamma series identifier for the current season. When
   *  set, the events API queries `series_id={seriesId}` which mirrors
   *  Polymarket's own UI exactly (e.g. La Liga 2025-26 → 10193).
   *  IDs roll over each season — needs annual maintenance. */
  seriesId?: number;
}

export interface SportGroup {
  /** URL fragment for the group landing page */
  slug: string;
  /** Display label shown as the rail header */
  label: string;
  /** Gamma tag slug for the group itself (broad sport tag) */
  tagSlug: string;
  /** Nested leagues. Empty for single-league sports (Golf, F1, Boxing). */
  leagues: SportLeague[];
}

export const SPORT_GROUPS: readonly SportGroup[] = [
  {
    slug: "football",
    label: "Football",
    tagSlug: "nfl",
    leagues: [
      { slug: "nfl", label: "NFL", tagSlug: "nfl" },
      { slug: "nfl-draft", label: "NFL Draft", tagSlug: "nfl-draft" },
      { slug: "cfb", label: "CFB", tagSlug: "college-football" },
    ],
  },
  {
    slug: "basketball",
    label: "Basketball",
    tagSlug: "basketball",
    leagues: [
      { slug: "nba", label: "NBA", tagSlug: "nba", seriesId: 10345 },
      { slug: "ncaab", label: "CBB", tagSlug: "ncaa-cbb", seriesId: 10470 },
      {
        slug: "euroleague",
        label: "Euroleague",
        tagSlug: "euroleague-basketball",
        seriesId: 10371,
      },
      {
        slug: "aba-league",
        label: "ABA League",
        tagSlug: "bkaba",
        seriesId: 11467,
      },
      {
        slug: "germany-bbl",
        label: "Germany BBL",
        tagSlug: "bkbbl",
        seriesId: 11466,
      },
      {
        slug: "turkey-bsl",
        label: "Turkey BSL",
        tagSlug: "bkbsl",
        seriesId: 11468,
      },
      {
        slug: "japan-b-league",
        label: "Japan B League",
        tagSlug: "bkjpn",
        seriesId: 11470,
      },
      {
        slug: "vtb-united-league",
        label: "VTB United League",
        tagSlug: "bkvtb",
        seriesId: 11465,
      },
      {
        slug: "greek-basketball",
        label: "Greek Basketball",
        tagSlug: "bkgr1",
        seriesId: 11469,
      },
      {
        slug: "liga-endesa",
        label: "Liga Endesa",
        tagSlug: "liga-endesa",
        seriesId: 10878,
      },
      { slug: "lnb", label: "LNB", tagSlug: "lnb", seriesId: 10873 },
      { slug: "kbl", label: "KBL", tagSlug: "kbl", seriesId: 10874 },
      { slug: "cba", label: "CBA", tagSlug: "cba", seriesId: 10875 },
      {
        slug: "france-pro-a",
        label: "Pro A",
        tagSlug: "pro-a",
        seriesId: 10872,
      },
    ],
  },
  {
    slug: "soccer",
    label: "Soccer",
    tagSlug: "soccer",
    leagues: [
      {
        slug: "epl",
        label: "EPL",
        tagSlug: "premier-league-2025",
        seriesId: 10188,
      },
      {
        slug: "la-liga",
        label: "La Liga",
        tagSlug: "la-liga-2025",
        seriesId: 10193,
      },
      {
        slug: "bundesliga",
        label: "Bundesliga",
        tagSlug: "bundesliga-2025",
        seriesId: 10194,
      },
      {
        slug: "ligue-1",
        label: "Ligue 1",
        tagSlug: "ligue-1-2025",
        seriesId: 10195,
      },
      { slug: "ucl", label: "UCL", tagSlug: "ucl-2025", seriesId: 10204 },
      { slug: "uel", label: "UEL", tagSlug: "uel-2025", seriesId: 10209 },
      {
        slug: "uefa-conference-league",
        label: "UEFA Conference League",
        tagSlug: "europa-conference-league",
        seriesId: 10437,
      },
      { slug: "mls", label: "MLS", tagSlug: "mls-2025", seriesId: 10189 },
      {
        slug: "fifa-world-cup",
        label: "FIFA World Cup",
        tagSlug: "fifa-world-cup",
        seriesId: 11433,
      },
      {
        slug: "copa-libertadores",
        label: "Copa Libertadores",
        tagSlug: "lib-2025",
        seriesId: 10289,
      },
      {
        slug: "copa-sudamericana",
        label: "Copa Sudamericana",
        tagSlug: "sud-2025",
        seriesId: 10291,
      },
      {
        slug: "saudi-pro-league",
        label: "Saudi Pro League",
        tagSlug: "saudi-professional-league",
        seriesId: 10361,
      },
      {
        slug: "eredivisie",
        label: "Eredivisie",
        tagSlug: "ere-2025",
        seriesId: 10286,
      },
      {
        slug: "primeira-liga",
        label: "Primeira Liga",
        tagSlug: "primeira-liga",
        seriesId: 10330,
      },
      {
        slug: "brasileirao-a",
        label: "Brazil Série A",
        tagSlug: "brazil-serie-a",
        seriesId: 10359,
      },
      {
        slug: "brasileirao-b",
        label: "Brazil Série B",
        tagSlug: "brazil-serie-b",
        seriesId: 10973,
      },
      {
        slug: "japan-j-league",
        label: "Japan J. League",
        tagSlug: "japan-j-league",
        seriesId: 10360,
      },
      {
        slug: "j2-league",
        label: "J2 League",
        tagSlug: "japan-j2-league",
        seriesId: 10443,
      },
      {
        slug: "k-league",
        label: "K-League",
        tagSlug: "k-league",
        seriesId: 10444,
      },
      {
        slug: "efl-championship",
        label: "EFL Championship",
        tagSlug: "efl-championship",
        seriesId: 10355,
      },
      {
        slug: "super-lig",
        label: "Süper Lig",
        tagSlug: "tur-2025",
        seriesId: 10292,
      },
      {
        slug: "ligue-2",
        label: "Ligue 2",
        tagSlug: "ligue-2",
        seriesId: 10675,
      },
      {
        slug: "la-liga-2",
        label: "La Liga 2",
        tagSlug: "la-liga-2",
        seriesId: 10672,
      },
      {
        slug: "bundesliga-2",
        label: "2. Bundesliga",
        tagSlug: "bundesliga-2",
        seriesId: 10670,
      },
      {
        slug: "csl",
        label: "Chinese Super League",
        tagSlug: "chinese-super-league",
        seriesId: 10439,
      },
      {
        slug: "egypt-pl",
        label: "Egypt Premier League",
        tagSlug: "egypt-1",
        seriesId: 10969,
      },
      {
        slug: "norway-eliteserien",
        label: "Norway Eliteserien",
        tagSlug: "norway-eliteserien",
        seriesId: 10362,
      },
      {
        slug: "colombia-primera",
        label: "Colombia Primera A",
        tagSlug: "primera-a",
        seriesId: 10964,
      },
      {
        slug: "morocco-botola",
        label: "Morocco Botola Pro",
        tagSlug: "morocco-1",
        seriesId: 10968,
      },
      {
        slug: "peru-liga-1",
        label: "Peru Liga 1",
        tagSlug: "liga-1",
        seriesId: 10967,
      },
      {
        slug: "denmark-superliga",
        label: "Denmark Superliga",
        tagSlug: "denmark-superliga",
        seriesId: 10363,
      },
      {
        slug: "bolivia-lfpb",
        label: "Bolivia LFPB",
        tagSlug: "bolivia-1",
        seriesId: 10966,
      },
      {
        slug: "a-league",
        label: "A-League",
        tagSlug: "a-league-soccer",
        seriesId: 10438,
      },
      {
        slug: "indian-super-league",
        label: "Indian Super League",
        tagSlug: "indian-super-league",
        seriesId: 10364,
      },
      {
        slug: "argentina-primera",
        label: "Argentina Primera",
        tagSlug: "primera-divisin-argentina",
        seriesId: 10312,
      },
      {
        slug: "russian-premier-league",
        label: "Russian Premier League",
        tagSlug: "russian-premier-league",
        seriesId: 10313,
      },
      {
        slug: "dfb-pokal",
        label: "DFB-Pokal",
        tagSlug: "dfb-pokal",
        seriesId: 10317,
      },
      {
        slug: "coupe-de-france",
        label: "Coupe de France",
        tagSlug: "coupe-de-france",
        seriesId: 10315,
      },
    ],
  },
  {
    slug: "tennis",
    label: "Tennis",
    tagSlug: "tennis",
    leagues: [
      { slug: "atp", label: "ATP", tagSlug: "atp", seriesId: 10365 },
      { slug: "wta", label: "WTA", tagSlug: "wta", seriesId: 10366 },
    ],
  },
  {
    slug: "cricket",
    label: "Cricket",
    tagSlug: "cricket",
    leagues: [
      {
        slug: "cricket-international",
        label: "International",
        tagSlug: "international-cricket",
        seriesId: 10528,
      },
      {
        slug: "ipl",
        label: "Indian Premier League",
        tagSlug: "indian-premier-league",
        seriesId: 11213,
      },
      {
        slug: "psl",
        label: "PSL",
        tagSlug: "pakistan-super-league",
        seriesId: 11214,
      },
    ],
  },
  {
    slug: "baseball",
    label: "Baseball",
    tagSlug: "baseball",
    leagues: [
      { slug: "mlb", label: "MLB", tagSlug: "mlb", seriesId: 3 },
      { slug: "kbo", label: "KBO", tagSlug: "kbo", seriesId: 10370 },
    ],
  },
  {
    slug: "hockey",
    label: "Hockey",
    tagSlug: "hockey",
    leagues: [
      { slug: "nhl", label: "NHL", tagSlug: "nhl-2026", seriesId: 10346 },
      {
        slug: "shl",
        label: "Swedish Hockey League",
        tagSlug: "shl-2026",
        seriesId: 10695,
      },
      {
        slug: "khl",
        label: "Kontinental Hockey League",
        tagSlug: "khl-2026",
        seriesId: 10700,
      },
      {
        slug: "ahl",
        label: "American Hockey League",
        tagSlug: "ahl-2026",
        seriesId: 10699,
      },
      {
        slug: "dehl",
        label: "Deutsche Eishockey Liga",
        tagSlug: "dehl-2026",
        seriesId: 10701,
      },
      {
        slug: "czech-extraliga",
        label: "Czech Extraliga",
        tagSlug: "snhl-2026",
        seriesId: 10703,
      },
    ],
  },
  {
    slug: "rugby",
    label: "Rugby",
    tagSlug: "rugby",
    leagues: [
      {
        slug: "super-rugby",
        label: "Super Rugby",
        tagSlug: "super-rugby-pacific",
        seriesId: 10883,
      },
      {
        slug: "urc",
        label: "United Rugby Championship",
        tagSlug: "united-rugby-championship",
        seriesId: 10881,
      },
      {
        slug: "top-14",
        label: "Top 14",
        tagSlug: "rugby-top-14",
        seriesId: 10841,
      },
      {
        slug: "champions-cup",
        label: "European Champions Cup",
        tagSlug: "rugby-champions-cup",
        seriesId: 10882,
      },
      {
        slug: "premiership-rugby",
        label: "Premiership Rugby",
        tagSlug: "rugby-premiership",
        seriesId: 10840,
      },
    ],
  },
  { slug: "ufc", label: "UFC", tagSlug: "ufc", leagues: [] },
  { slug: "boxing", label: "Boxing", tagSlug: "boxing", leagues: [] },
  { slug: "f1", label: "Formula 1", tagSlug: "f1", leagues: [] },
  {
    slug: "motorsports",
    label: "Motorsports",
    tagSlug: "motorsports",
    leagues: [],
  },
  { slug: "golf", label: "Golf", tagSlug: "golf", leagues: [] },
  {
    slug: "table-tennis",
    label: "Table Tennis",
    tagSlug: "table-tennis",
    leagues: [],
  },
  {
    slug: "pickleball",
    label: "Pickleball",
    tagSlug: "pickleball",
    leagues: [],
  },
  { slug: "esports", label: "Esports", tagSlug: "esports", leagues: [] },
  { slug: "lacrosse", label: "Lacrosse", tagSlug: "lacrosse", leagues: [] },
  { slug: "chess", label: "Chess", tagSlug: "chess", leagues: [] },
] as const;

export interface SportEntry {
  slug: string;
  label: string;
  tagSlug: string;
  /** Optional Polymarket series ID — when set, prefer it over tagSlug. */
  seriesId?: number;
  /** The parent group when this entry is a league; the group itself otherwise. */
  group: SportGroup;
  /** True when slug points at a top-level group rather than a nested league. */
  isGroup: boolean;
}

const SPORT_ENTRY_BY_SLUG: ReadonlyMap<string, SportEntry> = (() => {
  const map = new Map<string, SportEntry>();
  for (const group of SPORT_GROUPS) {
    map.set(group.slug, {
      slug: group.slug,
      label: group.label,
      tagSlug: group.tagSlug,
      group,
      isGroup: true,
    });
    for (const league of group.leagues) {
      map.set(league.slug, {
        slug: league.slug,
        label: league.label,
        tagSlug: league.tagSlug,
        seriesId: league.seriesId,
        group,
        isGroup: false,
      });
    }
  }
  return map;
})();

/**
 * Slugs reachable via /events/sports/{slug}. Includes both top-level
 * sport groups and nested leagues. The /events/[tag] route redirects
 * any of these to their canonical /events/sports/* URL.
 */
export const SPORT_SUB_SLUGS: ReadonlySet<string> = new Set(
  SPORT_ENTRY_BY_SLUG.keys()
);

export function isSportSubSlug(slug: string): boolean {
  return SPORT_SUB_SLUGS.has(slug);
}

export function getSportEntry(slug: string): SportEntry | undefined {
  return SPORT_ENTRY_BY_SLUG.get(slug);
}

/** All league slugs flattened across every group, useful for prefetch loops. */
export const ALL_LEAGUE_SLUGS: readonly string[] = SPORT_GROUPS.flatMap((g) =>
  g.leagues.map((l) => l.slug)
);

/** Tag slug for the "all sports" landing — used by the /live page. */
export const ALL_SPORTS_TAG_SLUG = "sports";
