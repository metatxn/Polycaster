/**
 * Resolve a short, ticker-friendly label for a market row.
 *
 * Polymarket nests two kinds of sports markets under one event:
 *  - Parent markets (moneyline, toss winner, completed match) — these have no
 *    `groupItemTitle`; their `question` is the *full* event title plus a
 *    suffix, e.g. "Indian Premier League: GUJ vs ROY - Who wins the toss?".
 *  - negRisk children (Most Sixes, Top Batter, Toss Match Double) — each
 *    market is one outcome (MUM/Draw/SUN) and ships a `groupItemTitle` like
 *    "MUM" that's already short.
 *
 * Without normalization the parent rows render their entire event title in
 * the candidate ticker / chart legend / outcomes table and overflow into
 * truncation. Polymarket's UI uses `sportsMarketType` to pick a short
 * canonical label ("Moneyline", "Toss Winner", "Completed Match"). We mirror
 * that mapping here, then fall back to stripping the event-title prefix from
 * `question`, then to `question` verbatim.
 */

const SPORTS_MARKET_LABELS: Record<string, string> = {
  moneyline: "Moneyline",
  // Cricket-specific
  cricket_toss_winner: "Toss Winner",
  cricket_completed_match: "Completed Match",
  cricket_most_sixes: "Most Sixes",
  cricket_top_batter: "Top Batter",
  cricket_toss_match_double: "Toss Match Double",
  // Generic fallbacks (other sports may reuse these without the sport prefix)
  toss_winner: "Toss Winner",
  completed_match: "Completed Match",
};

function titleCase(input: string): string {
  return input
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

interface MarketLabelInput {
  question?: string;
  groupItemTitle?: string;
  sportsMarketType?: string;
}

export function getMarketShortLabel(
  market: MarketLabelInput,
  eventTitle?: string
): string {
  const groupTitle = market.groupItemTitle?.trim();
  if (groupTitle) return groupTitle;

  const sportsType = market.sportsMarketType;
  if (sportsType) {
    const mapped = SPORTS_MARKET_LABELS[sportsType];
    if (mapped) return mapped;
    // Unknown sportsMarketType: strip the sport prefix (cricket_/soccer_/...)
    // and title-case so we still ship something readable instead of the raw
    // snake_case key.
    return titleCase(sportsType.replace(/^[a-z]+_/, ""));
  }

  const question = market.question?.trim();
  if (!question) return "";

  // Strip an event-title prefix when present, e.g.
  //   "Indian Premier League: GUJ vs ROY - Who wins the toss?"
  //     → "Who wins the toss?"
  // We require the prefix to actually match the event title so we don't
  // accidentally amputate questions that happen to contain " - ".
  if (eventTitle) {
    const trimmedEventTitle = eventTitle.trim();
    const sep = " - ";
    if (question.startsWith(trimmedEventTitle + sep)) {
      return question.slice(trimmedEventTitle.length + sep.length).trim();
    }
    // Some payloads use an em dash or extra whitespace; be tolerant.
    const idx = question.indexOf(sep);
    if (idx > 0 && question.slice(0, idx).trim() === trimmedEventTitle) {
      return question.slice(idx + sep.length).trim();
    }
  }

  return question;
}
