/**
 * Registry for the editorial guide library (/guides). One entry per
 * published guide — the index page, the article routes, and the sitemap
 * guides segment all read from this list, so adding a guide here is the
 * single step that wires it everywhere.
 *
 * Dates are ISO (UTC) and follow the sitemap lastmod rule (§11.5): bump
 * `dateModified` only for meaningful content changes, never on re-renders.
 */
export type GuideEntry = {
  slug: string;
  /** Metadata title (the layout appends the "| Knoww" template suffix). */
  title: string;
  /** On-page H1 — sentence case, per the site's editorial style. */
  heading: string;
  /** Meta description, kept within the 155-char ceiling. */
  description: string;
  /** One-paragraph teaser for the /guides index. */
  summary: string;
  datePublished: string;
  dateModified: string;
};

export const GUIDES: GuideEntry[] = [
  {
    slug: "what-is-a-prediction-market",
    title: "What Is a Prediction Market? A Plain-English Guide",
    heading: "What is a prediction market?",
    description:
      "What prediction markets are, how prices turn into probabilities, and what a real contract pays out — with a worked example and honest limitations.",
    summary:
      "The foundations: what a prediction-market contract actually is, why a 62¢ price means a 62% implied probability, what happens when a market resolves, and where market prices can mislead you.",
    datePublished: "2026-08-08",
    dateModified: "2026-08-08",
  },
  {
    slug: "how-to-read-prediction-market-odds",
    title: "How to Read Prediction-Market Odds",
    heading: "How to read prediction-market odds",
    description:
      "Turn prediction-market prices into probabilities: cents to percent, spreads, depth, payout math, and the traps in multi-outcome markets.",
    summary:
      "A practical reading of a live order book: converting prices to probabilities, why the bid–ask spread is your real cost, what 24-hour movement tells you, and why multi-outcome prices rarely sum to exactly 100%.",
    datePublished: "2026-08-08",
    dateModified: "2026-08-08",
  },
  {
    slug: "how-prediction-markets-resolve",
    title: "How Prediction Markets Resolve",
    heading: "How prediction markets resolve",
    description:
      "What happens when a prediction market ends: written resolution rules, the UMA optimistic oracle, disputes, and how winning shares settle to $1.",
    summary:
      'The end of a market\'s life: how written rules and resolution sources determine the outcome, how UMA\'s optimistic oracle proposes and disputes results, and why "closed" and "resolved" are different states.',
    datePublished: "2026-08-08",
    dateModified: "2026-08-08",
  },
];

export function getGuide(slug: string): GuideEntry | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}
