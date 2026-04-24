/**
 * Slug-prefix category classifier.
 *
 * Polymarket market slugs encode category via a stable prefix
 * convention: `nhl-*`, `nba-*`, `mls-*`, `btc-*`, etc. Rather than
 * round-trip to Gamma for tags, we map slug prefixes to categories
 * locally. This is fast, deterministic, and accurate in practice.
 *
 * The category names chosen here are the "specialty level" — what a
 * real insider specializes in. A trader who wins 70% on NHL spreads
 * is a different creature from a trader who wins 70% on Bitcoin
 * binaries, and the specialist archetype distinguishes them.
 */

export type Category =
  | "NHL"
  | "NBA"
  | "NFL"
  | "MLB"
  | "MLS"
  | "EPL"
  | "LaLiga"
  | "Serie-A"
  | "Ligue-1"
  | "Bundesliga"
  | "UCL"
  | "Soccer-Other"
  | "Tennis-ATP"
  | "Tennis-WTA"
  | "Tennis-Other"
  | "Cricket"
  | "Esports"
  | "Golf"
  | "UFC"
  | "F1"
  | "Sports-Other"
  | "Bitcoin"
  | "Ethereum"
  | "Solana"
  | "Crypto-Other"
  | "Politics"
  | "Macro"
  | "Culture"
  | "Other";

interface Rule {
  category: Category;
  /** Match if the slug starts with any of these prefixes. */
  prefixes?: string[];
  /** Match if the slug contains any of these substrings (checked
   *  after prefixes). */
  substrings?: string[];
}

// Order matters: earlier rules win. Specific sport leagues first, then
// generic sport buckets, then crypto, then text-based politics/macro.
const RULES: Rule[] = [
  { category: "NHL", prefixes: ["nhl-"] },
  { category: "NBA", prefixes: ["nba-"] },
  { category: "NFL", prefixes: ["nfl-"] },
  { category: "MLB", prefixes: ["mlb-"] },
  { category: "MLS", prefixes: ["mls-"] },
  { category: "EPL", prefixes: ["epl-"] },
  { category: "LaLiga", prefixes: ["lal-"] },
  { category: "Serie-A", prefixes: ["sl1-", "seriea-"] },
  { category: "Ligue-1", prefixes: ["fl1-"] },
  { category: "Bundesliga", prefixes: ["bl1-"] },
  { category: "UCL", prefixes: ["ucl-", "uel-"] },
  { category: "Soccer-Other", prefixes: ["cde-", "tur-", "por-", "bra-"] },
  { category: "Tennis-ATP", prefixes: ["atp-"] },
  { category: "Tennis-WTA", prefixes: ["wta-"] },
  { category: "Cricket", prefixes: ["cric", "ipl-", "cpl-"] },
  { category: "Esports", prefixes: ["lol-", "cs-", "dota-", "val-"] },
  { category: "Golf", prefixes: ["golf-", "pga-"] },
  { category: "UFC", prefixes: ["ufc-", "mma-"] },
  { category: "F1", prefixes: ["f1-"] },
  { category: "Bitcoin", prefixes: ["btc-", "bitcoin-"] },
  { category: "Ethereum", prefixes: ["eth-"] },
  { category: "Solana", prefixes: ["sol-"] },
  {
    category: "Crypto-Other",
    prefixes: ["xrp-", "bnb-", "doge-", "ada-", "dot-", "ltc-"],
  },
  {
    category: "Politics",
    substrings: [
      "trump",
      "biden",
      "harris",
      "election",
      "president",
      "senate",
      "congress",
      "supreme-court",
      "impeach",
      "campaign",
      "primary",
      "ukraine",
      "russia-",
      "israel",
      "iran",
      "gaza",
      "nato",
    ],
  },
  {
    category: "Macro",
    substrings: [
      "fed",
      "rate-hike",
      "rate-cut",
      "cpi",
      "inflation",
      "jobs-report",
      "unemployment",
      "gdp",
      "recession",
      "sp500",
      "nasdaq",
    ],
  },
];

/** Slugs starting with these prefixes are sports but with no specific
 *  league match — bucket them into Sports-Other so the specialist
 *  archetype doesn't punish them as "Other." */
const GENERIC_SPORT_PREFIXES = [
  "football-",
  "basketball-",
  "baseball-",
  "hockey-",
  "soccer-",
  "tennis-",
];

/**
 * Classify a market slug into a category. Never throws; returns
 * "Other" when nothing matches.
 */
export function categorize(slug: string | null | undefined): Category {
  if (!slug) return "Other";
  const s = slug.toLowerCase();

  for (const rule of RULES) {
    if (rule.prefixes?.some((p) => s.startsWith(p))) {
      return rule.category;
    }
    if (rule.substrings?.some((sub) => s.includes(sub))) {
      return rule.category;
    }
  }

  if (GENERIC_SPORT_PREFIXES.some((p) => s.startsWith(p))) {
    return "Sports-Other";
  }

  return "Other";
}

/**
 * Human-readable category family for grouping in the UI — "Tennis-ATP"
 * and "Tennis-WTA" roll up to "Tennis", etc. Not used for scoring;
 * scoring uses the fine-grained category.
 */
export function categoryFamily(c: Category): string {
  if (c.startsWith("Tennis")) return "Tennis";
  if (
    c === "Bitcoin" ||
    c === "Ethereum" ||
    c === "Solana" ||
    c === "Crypto-Other"
  ) {
    return "Crypto";
  }
  return c;
}
