import type { ContextGateResult } from "../types/chrome-messages";
import type { Market } from "../types/market";

export type ScoringMode = "hybrid" | "lexical" | "heuristic";

export const EMBEDDING_FLOOR = 0.5;
export const FAIL_OPEN_FLOOR = 0.5;
export const AI_GATE_RETRY_FLOOR = 0.6;
export const HEURISTIC_STRICT_SHARED_NOUNS = 3;

const SMART_QUOTE_RE = /[\u2018\u2019\u201A\u201B\u2032\u0060\u02BC]/g;
const NAIVE_GATE_TOKEN_RE = /[\s,.!?;:()[\]{}"'/\-@#\u2018\u2019\u201C\u201D]+/;
const NAIVE_GATE_MIN_WORD_LEN = 3;
const NAIVE_GATE_MIN_DISTINCT = 2;

export const HIGH_SIGNAL_TOKENS = new Set([
  "ai",
  "gpt",
  "gta",
  "spy",
  "btc",
  "eth",
  "sec",
  "fda",
  "fed",
  "who",
  "imf",
  "epa",
  "ipo",
  "gdp",
  "cpi",
  "nyc",
  "ufo",
  "nfl",
  "nba",
  "mlb",
  "nhl",
  "ufc",
  "grok",
  "doge",
  "tsla",
  "aapl",
  "nvda",
  "amzn",
  "msft",
  "meta",
  "usdc",
  "usdt",
  "nato",
  "opec",
  "nasa",
  "brics",
]);

const NAIVE_STOP_WORDS = new Set([
  "the",
  "this",
  "that",
  "these",
  "those",
  "some",
  "any",
  "each",
  "every",
  "his",
  "her",
  "its",
  "our",
  "your",
  "their",
  "him",
  "she",
  "they",
  "them",
  "you",
  "has",
  "had",
  "have",
  "for",
  "from",
  "into",
  "with",
  "about",
  "over",
  "under",
  "after",
  "before",
  "between",
  "through",
  "during",
  "without",
  "against",
  "within",
  "and",
  "but",
  "not",
  "also",
  "just",
  "more",
  "than",
  "very",
  "only",
  "will",
  "would",
  "could",
  "should",
  "can",
  "may",
  "might",
  "must",
  "was",
  "were",
  "been",
  "being",
  "are",
  "does",
  "did",
  "get",
  "got",
  "let",
  "say",
  "said",
  "says",
  "make",
  "made",
  "take",
  "took",
  "see",
  "seen",
  "know",
  "knew",
  "think",
  "come",
  "came",
  "give",
  "gave",
  "find",
  "found",
  "tell",
  "told",
  "new",
  "now",
  "still",
  "even",
  "back",
  "way",
  "much",
  "many",
  "like",
  "here",
  "there",
  "then",
  "all",
  "out",
  "price",
  "market",
  "year",
  "day",
  "time",
  "week",
  "month",
  "march",
  "april",
  "june",
  "july",
  "january",
  "february",
  "august",
  "september",
  "october",
  "november",
  "december",
  "today",
  "tomorrow",
  "next",
  "last",
  "first",
  "second",
  "third",
  "win",
  "hit",
  "high",
  "low",
  "big",
  "top",
  "end",
  "start",
  "million",
  "billion",
  "percent",
  "number",
  "people",
  "world",
  "country",
  "state",
  "rate",
  "report",
  "because",
  "poor",
  "two",
  "three",
  "four",
  "five",
  "global",
  "track",
  "really",
  "actually",
  "well",
  "good",
  "bad",
  "thing",
  "things",
  "going",
  "look",
  "right",
  "real",
  "getting",
  "need",
  "want",
  "great",
  "long",
  "best",
  "worst",
  "same",
  "whole",
  "part",
  "keep",
  "post",
  "update",
  "breaking",
  "live",
  "watch",
  "thread",
  "opinion",
  "prediction",
  "odds",
  "chance",
  "likely",
  "bet",
  "betting",
  "question",
  "former",
  "house",
  "speaker",
  "campaign",
  "currently",
  "reportedly",
  "celebration",
  "anniversary",
  "launch",
  "launching",
]);

const CONTRACTION_SUFFIX_RE = /n't$|'[a-z]{1,2}$/i;
const NAIVE_ENTITY_RE = /[A-Z][a-zA-Z]{4,}/g;
const SHORT_ENTITY_RE = /\b[A-Z][A-Z0-9]{1,5}\b/g;

export interface DetermineScoringModeInput {
  usedEmbeddings: boolean;
  bm25Scores: number[];
  source: "offscreen" | "fallback";
}

export interface GateDecisionInput {
  postText: string;
  market: Pick<Market, "title" | "description" | "tags">;
  matchedTags: string[];
  scoringMode: ScoringMode;
  score: number;
  gate?: ContextGateResult;
  /**
   * When true, the gate passes at `distinct >= 1` provided the score clears
   * `AI_GATE_RETRY_FLOOR`. Set by platforms where both sides are short market
   * questions (kalshi.com). Default (false) keeps the standard 2+ distinct
   * signals requirement.
   */
  relaxed?: boolean;
}

export interface GateDecisionResult {
  gate: ContextGateResult;
  recoveryGate?: ContextGateResult;
  pass: boolean;
  retryEligible: boolean;
  usedFallbackGate: boolean;
  usedRecoveryGate: boolean;
}

function normalizeText(text: string): string {
  return text
    .replace(SMART_QUOTE_RE, "'")
    .replace(/#(\w)/g, "$1")
    .replace(/'s\b/gi, "")
    .replace(/n't\b/gi, "")
    .replace(/'[a-z]{1,2}\b/gi, "");
}

function extractNaiveEntities(text: string): Set<string> {
  const entities = new Set<string>();

  NAIVE_ENTITY_RE.lastIndex = 0;
  for (
    let match = NAIVE_ENTITY_RE.exec(text);
    match !== null;
    match = NAIVE_ENTITY_RE.exec(text)
  ) {
    const lower = match[0].toLowerCase();
    if (!NAIVE_STOP_WORDS.has(lower)) {
      entities.add(lower);
    }
  }

  SHORT_ENTITY_RE.lastIndex = 0;
  for (
    let match = SHORT_ENTITY_RE.exec(text);
    match !== null;
    match = SHORT_ENTITY_RE.exec(text)
  ) {
    const lower = match[0].toLowerCase();
    if (HIGH_SIGNAL_TOKENS.has(lower)) {
      entities.add(lower);
    }
  }

  return entities;
}

function tokenizeNaiveText(text: string): Set<string> {
  const words = text.toLowerCase().split(NAIVE_GATE_TOKEN_RE);
  const set = new Set<string>();
  for (const word of words) {
    if (HIGH_SIGNAL_TOKENS.has(word)) {
      set.add(word);
      continue;
    }
    if (word.length >= NAIVE_GATE_MIN_WORD_LEN && !NAIVE_STOP_WORDS.has(word)) {
      const clean = word.replace(CONTRACTION_SUFFIX_RE, "");
      if (clean.length >= NAIVE_GATE_MIN_WORD_LEN) {
        set.add(clean);
      }
    }
  }
  return set;
}

export function buildMarketGateText(
  market: Pick<Market, "title" | "description">
): string {
  let text = market.title || "";
  if (market.description) {
    text += ` ${market.description.slice(0, 120)}`;
  }
  return text;
}

export function naiveContextGate(
  postText: string,
  marketText: string
): ContextGateResult {
  const normPost = normalizeText(postText);
  const normMarket = normalizeText(marketText);

  const postWords = tokenizeNaiveText(normPost);
  const marketWords = tokenizeNaiveText(normMarket);

  let sharedNouns = 0;
  const sharedNounList: string[] = [];
  for (const word of marketWords) {
    if (postWords.has(word)) {
      sharedNouns++;
      sharedNounList.push(word);
    }
  }

  const postEntities = extractNaiveEntities(normPost);
  const marketEntities = extractNaiveEntities(normMarket);

  let sharedEntities = 0;
  const sharedEntityList: string[] = [];
  for (const entity of marketEntities) {
    if (postEntities.has(entity)) {
      sharedEntities++;
      sharedEntityList.push(entity);
    }
  }

  const allSignals = new Set([...sharedNounList, ...sharedEntityList]);
  const distinctSignals = allSignals.size;

  return {
    pass: distinctSignals >= NAIVE_GATE_MIN_DISTINCT,
    sharedNouns,
    meaningfulNouns: sharedNouns,
    sharedEntities,
    details: `fallback-local-gate: words=[${sharedNounList.join(",")}] entities=[${sharedEntityList.join(",")}] distinct=${distinctSignals}`,
  };
}

export function hasBm25Signal(bm25Scores: number[]): boolean {
  return bm25Scores.some((score) => score > 0);
}

export function determineScoringMode({
  usedEmbeddings,
  bm25Scores,
  source,
}: DetermineScoringModeInput): ScoringMode {
  if (usedEmbeddings) {
    return "hybrid";
  }
  if (source === "offscreen" && hasBm25Signal(bm25Scores)) {
    return "lexical";
  }
  return "heuristic";
}

export function getEffectiveThreshold(
  configuredThreshold: number,
  scoringMode: ScoringMode
): number {
  return scoringMode === "hybrid"
    ? Math.max(EMBEDDING_FLOOR, configuredThreshold)
    : configuredThreshold;
}

export function shouldFailOpen(
  score: number,
  floor: number = FAIL_OPEN_FLOOR
): boolean {
  return score >= floor;
}

function hasPerMarketTagMatch(
  matchedTags: string[],
  market: Pick<Market, "tags">
): boolean {
  if (matchedTags.length === 0) {
    return false;
  }

  const marketTagLabels = new Set(
    (market.tags || [])
      .map((tag) => (tag.label || tag.slug || "").toLowerCase())
      .filter(Boolean)
  );

  return matchedTags.some((tag) => marketTagLabels.has(tag.toLowerCase()));
}

export function evaluateCandidateGate({
  postText,
  market,
  matchedTags,
  scoringMode,
  score,
  gate,
  relaxed,
}: GateDecisionInput): GateDecisionResult {
  const fallbackGate = naiveContextGate(postText, buildMarketGateText(market));
  const resolvedGate = gate ?? fallbackGate;
  let gatePass = resolvedGate.pass;
  const usedRecoveryGate = false;
  let recoveryGate: ContextGateResult | undefined;

  if (scoringMode === "heuristic") {
    gatePass =
      hasPerMarketTagMatch(matchedTags, market) ||
      (resolvedGate.pass &&
        resolvedGate.sharedNouns >= HEURISTIC_STRICT_SHARED_NOUNS);
  }

  // Platform-specific relaxation: short market questions rarely share the
  // default two distinct signals. Accept a single signal provided the score
  // already cleared the AI retry floor (so quality is still gated by score).
  if (!gatePass && relaxed && score >= AI_GATE_RETRY_FLOOR) {
    const hasSingleSignal =
      resolvedGate.meaningfulNouns >= 1 || resolvedGate.sharedEntities >= 1;
    if (hasSingleSignal) {
      gatePass = true;
    }
  }

  return {
    gate: resolvedGate,
    recoveryGate,
    pass: gatePass,
    retryEligible:
      !gatePass &&
      scoringMode === "hybrid" &&
      score >= AI_GATE_RETRY_FLOOR &&
      (resolvedGate.meaningfulNouns >= 1 || resolvedGate.sharedEntities >= 1),
    usedFallbackGate: gate === undefined,
    usedRecoveryGate,
  };
}
