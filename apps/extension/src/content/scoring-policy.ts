import {
  describeRelevanceThreshold,
  EMBEDDING_FLOOR,
  FAIL_OPEN_FLOOR,
} from "../relevance-threshold-policy";
import type { ContextGateResult } from "../types/chrome-messages";
import type { Market } from "../types/market";
import { buildMarketContextText } from "./market-context";

export type ScoringMode = "hybrid" | "lexical" | "heuristic";

export { describeRelevanceThreshold, EMBEDDING_FLOOR, FAIL_OPEN_FLOOR };
export const AI_GATE_RETRY_FLOOR = 0.6;
export const HEURISTIC_STRICT_SHARED_NOUNS = 3;
export const HIGH_PRECISION_SINGLE_SIGNAL_FLOOR = 0.7;

type MarketDomain =
  | "business"
  | "crypto"
  | "entertainment"
  | "finance"
  | "health"
  | "immigration"
  | "legal"
  | "military"
  | "politics"
  | "science-tech"
  | "sports"
  | "transport"
  | "weather";

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
  "sol",
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
  // Prediction-market venues
  "polymarket",
  "kalshi",
  "manifold",
  // Crypto exchanges / protocols / wallets that frequently appear in posts
  // as mixed-case proper nouns — boosting them keeps the upstream search
  // ranker focused on protocol-specific markets instead of generic crypto.
  "hyperliquid",
  "phantom",
  "solana",
  "ethereum",
  "bitcoin",
  "coinbase",
  "binance",
  "uniswap",
  "arbitrum",
  "optimism",
  "polygon",
  // AI/tech brands
  "openai",
  "anthropic",
  "claude",
  "perplexity",
  "deepseek",
  "mistral",
  "nvidia",
  "spacex",
  "tesla",
]);

export const CASE_INSENSITIVE_HIGH_SIGNAL_TOKENS = new Set([
  "ai",
  "gpt",
  "gta",
  "spy",
  "btc",
  "eth",
  "sol",
  "sec",
  "fda",
  "fed",
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
  "polymarket",
  "kalshi",
  "manifold",
  "hyperliquid",
  "phantom",
  "solana",
  "ethereum",
  "bitcoin",
  "coinbase",
  "binance",
  "uniswap",
  "arbitrum",
  "optimism",
  "polygon",
  "openai",
  "anthropic",
  "claude",
  "perplexity",
  "deepseek",
  "mistral",
  "nvidia",
  "spacex",
  "tesla",
]);

const HIGH_PRECISION_SINGLE_SIGNAL_TOKENS = new Set([
  "polymarket",
  "kalshi",
  "hyperliquid",
  "phantom",
  "solana",
  "ethereum",
  "bitcoin",
  "coinbase",
  "binance",
  "uniswap",
  "arbitrum",
  "optimism",
  "polygon",
]);

const SIGNAL_TOKEN_ALIASES: Record<string, string> = {
  hyperliquidx: "hyperliquid",
};

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
  "card",
  "green",
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

const DOMAIN_PATTERNS: Record<MarketDomain, RegExp[]> = {
  business: [
    /\b(company|companies|startup|founder|co-?founder|revenue|employees?|hiring|jobs?|roles?|leadership|product|customer|enterprise)\b/i,
  ],
  crypto: [
    /\b(bitcoin|btc|ethereum|eth|solana|sol|crypto|defi|token|airdrop|blockchain|coinbase|polymarket|hyperliquid|hyperliquidx|perps?|dex|wallet|usdc|usdt|stablecoin)\b/i,
  ],
  entertainment: [
    /\b(movie|film|trailer|premiere|season|episode|hbo|max|netflix|disney|oscars?|grammys?|emmys?|actor|actress|box office)\b/i,
  ],
  finance: [
    /\b(stocks?|shares?|earnings|revenue|inflation|cpi|fed|federal reserve|rates?|treasury|nasdaq|s&p|sp500|dow|market cap)\b/i,
  ],
  health: [
    /\b(fda|vaccine|virus|disease|hospital|doctor|medical|health|drug|trial|urologist|body|cancer)\b/i,
  ],
  immigration: [
    /\b(green card|visa|citizenship|immigration|immigrant|h-?1b|passport|residency)\b/i,
  ],
  legal: [
    /\b(trial|lawsuit|court|judge|legal|charges?|indictment|settlement|case|sues?|sued)\b/i,
  ],
  military: [
    /\b(army|military|war|attack|missile|drone|defence|defense|soldier|combat|battle|air force|navy|terror|terrorist)\b/i,
  ],
  politics: [
    /\b(election|government|minister|president|congress|senate|parliament|bjp|democrat|republican|trump|biden|modi|policy|vote|voters?)\b/i,
  ],
  "science-tech": [
    /\b(ai|openai|anthropic|gpt|claude|software|engineer|engineering|developer|evm|ethereum|cloud|microsoft|google|apple|nvidia|spacex|nasa|robot|gpu)\b/i,
  ],
  sports: [
    /\b(ufc|mma|fight|fighter|lightweight|heavyweight|boxing|nfl|nba|mlb|nhl|cricket|football|soccer|tennis|golf|match|playoffs?|super bowl|world cup|esports?|counter-?strike)\b/i,
  ],
  transport: [
    /\b(flight|airport|airline|train|railway|irctc|road|traffic|vehicle|bike|car|delivery)\b/i,
  ],
  weather: [
    /\b(weather|rain|rainy|storm|hurricane|temperature|flood|monsoon|snow|wildfire|earthquake)\b/i,
  ],
};

const DOMAIN_TAG_ALIASES: Record<string, MarketDomain> = {
  ai: "science-tech",
  business: "business",
  companies: "business",
  company: "business",
  crypto: "crypto",
  cryptocurrency: "crypto",
  economics: "finance",
  economy: "finance",
  entertainment: "entertainment",
  financials: "finance",
  finance: "finance",
  health: "health",
  legal: "legal",
  politics: "politics",
  science: "science-tech",
  "science and technology": "science-tech",
  sports: "sports",
  technology: "science-tech",
  tech: "science-tech",
  weather: "weather",
};

const DOMAIN_COMPATIBILITY: Record<MarketDomain, Set<MarketDomain>> = {
  business: new Set(["business", "finance", "science-tech", "legal"]),
  crypto: new Set(["crypto", "finance", "science-tech", "legal"]),
  entertainment: new Set(["entertainment"]),
  finance: new Set(["finance", "business", "crypto", "politics"]),
  health: new Set(["health", "science-tech", "legal", "politics"]),
  immigration: new Set(["immigration", "business", "legal", "politics"]),
  legal: new Set([
    "legal",
    "business",
    "crypto",
    "finance",
    "health",
    "immigration",
    "politics",
    "science-tech",
  ]),
  military: new Set(["military", "politics", "transport"]),
  politics: new Set([
    "politics",
    "finance",
    "immigration",
    "legal",
    "military",
    "weather",
  ]),
  "science-tech": new Set([
    "science-tech",
    "business",
    "crypto",
    "finance",
    "health",
    "legal",
  ]),
  sports: new Set(["sports"]),
  transport: new Set(["transport", "business", "military", "weather"]),
  weather: new Set(["weather", "politics", "transport"]),
};

export interface DetermineScoringModeInput {
  usedEmbeddings: boolean;
  bm25Scores: number[];
  source: "offscreen" | "fallback";
}

export interface GateDecisionInput {
  postText: string;
  market: Pick<
    Market,
    "title" | "description" | "tags" | "category" | "markets"
  >;
  matchedTags: string[];
  scoringMode: ScoringMode;
  score: number;
  gate?: ContextGateResult;
  /**
   * Enables platform-specific handling for short market-question pairs. The
   * active single-signal path still requires specific entity and promoted
   * rerank evidence; the historical score-only path is observed in shadow.
   */
  relaxed?: boolean;
  includeNestedMarketContext?: boolean;
  rerankEvidence?: {
    score: number;
    threshold: number;
    promotionStatus: "failed" | "insufficient_evidence" | "passed";
  };
}

interface BuildMarketGateTextOptions {
  includeNestedMarkets?: boolean;
}

export interface GateDecisionResult {
  gate: ContextGateResult;
  recoveryGate?: ContextGateResult;
  pass: boolean;
  /**
   * True when the historical relaxed score-plus-one-signal rule would have
   * admitted a domain-compatible candidate that the active gate rejected.
   * This is observational only and must not be used for admission.
   */
  legacyRelaxedShadowEligible: boolean;
  retryEligible: boolean;
  usedFallbackGate: boolean;
  usedRecoveryGate: boolean;
  evidence: {
    wink: {
      state: "failed" | "passed" | "unavailable";
    };
    lexical: {
      passed: boolean;
      meaningfulNouns: number;
      sharedEntities: number;
    };
    specificEntity: {
      count: number;
    };
    domain: {
      state: "compatible" | "incompatible" | "unknown";
      post: MarketDomain[];
      market: MarketDomain[];
    };
    rerank: {
      score: number | null;
      threshold: number | null;
      promoted: boolean;
      passed: boolean;
    };
  };
}

function normalizeDomainToken(value: string | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addDomainFromLabel(
  domains: Set<MarketDomain>,
  label: string | undefined
): void {
  const direct = DOMAIN_TAG_ALIASES[normalizeDomainToken(label)];
  if (direct) domains.add(direct);
}

function addDomainsFromText(domains: Set<MarketDomain>, text: string): void {
  for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS) as Array<
    [MarketDomain, RegExp[]]
  >) {
    if (patterns.some((pattern) => pattern.test(text))) {
      domains.add(domain);
    }
  }
}

function inferPostDomains(
  postText: string,
  matchedTags: string[]
): Set<MarketDomain> {
  const domains = new Set<MarketDomain>();
  for (const tag of matchedTags) addDomainFromLabel(domains, tag);
  addDomainsFromText(domains, postText);
  return domains;
}

function inferMarketDomains(
  market: Pick<
    Market,
    "title" | "description" | "tags" | "category" | "markets"
  >,
  includeNestedMarkets = false
): Set<MarketDomain> {
  const domains = new Set<MarketDomain>();
  addDomainFromLabel(domains, market.category);
  for (const tag of market.tags || []) {
    addDomainFromLabel(domains, tag.label);
    addDomainFromLabel(domains, tag.slug);
  }
  addDomainsFromText(
    domains,
    buildMarketGateText(market, { includeNestedMarkets })
  );
  return domains;
}

function hasCompatibleDomain(
  postDomains: Set<MarketDomain>,
  marketDomains: Set<MarketDomain>
): boolean {
  if (marketDomains.size === 0 || postDomains.size === 0) return true;

  for (const marketDomain of marketDomains) {
    const compatible = DOMAIN_COMPATIBILITY[marketDomain];
    for (const postDomain of postDomains) {
      if (compatible.has(postDomain)) return true;
    }
  }
  return false;
}

function withDomainGateDetails(
  gate: ContextGateResult,
  postDomains: Set<MarketDomain>,
  marketDomains: Set<MarketDomain>
): ContextGateResult {
  return {
    ...gate,
    details: `${gate.details}; domain-gate=reject post=[${[...postDomains].join(",")}] market=[${[...marketDomains].join(",")}]`,
  };
}

function normalizeText(text: string): string {
  return text
    .replace(SMART_QUOTE_RE, "'")
    .replace(/#(\w)/g, "$1")
    .replace(/'s\b/gi, "")
    .replace(/n't\b/gi, "")
    .replace(/'[a-z]{1,2}\b/gi, "");
}

function normalizeSignalToken(word: string): string {
  const clean = word.replace(CONTRACTION_SUFFIX_RE, "").replace(/^[$@]+/, "");
  return SIGNAL_TOKEN_ALIASES[clean] ?? clean;
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
    const normalized = normalizeSignalToken(word);
    if (!normalized) continue;
    if (CASE_INSENSITIVE_HIGH_SIGNAL_TOKENS.has(normalized)) {
      set.add(normalized);
      continue;
    }
    if (
      normalized.length >= NAIVE_GATE_MIN_WORD_LEN &&
      !NAIVE_STOP_WORDS.has(normalized)
    ) {
      set.add(normalized);
    }
  }
  return set;
}

function getSharedHighPrecisionSignals(
  postText: string,
  marketText: string
): string[] {
  const postWords = tokenizeNaiveText(normalizeText(postText));
  const marketWords = tokenizeNaiveText(normalizeText(marketText));
  const shared: string[] = [];

  for (const word of marketWords) {
    if (postWords.has(word) && HIGH_PRECISION_SINGLE_SIGNAL_TOKENS.has(word)) {
      shared.push(word);
    }
  }

  return shared;
}

export function buildMarketGateText(
  market: Pick<Market, "title" | "description" | "markets">,
  options: BuildMarketGateTextOptions = {}
): string {
  if (options.includeNestedMarkets) {
    return buildMarketContextText(market);
  }

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
  includeNestedMarketContext = false,
  rerankEvidence,
}: GateDecisionInput): GateDecisionResult {
  const gateText = buildMarketGateText(market, {
    includeNestedMarkets: includeNestedMarketContext,
  });
  const fallbackGate = naiveContextGate(postText, gateText);
  const sharedHighPrecisionSignals = getSharedHighPrecisionSignals(
    postText,
    gateText
  );
  const postDomains = inferPostDomains(postText, matchedTags);
  const marketDomains = inferMarketDomains(market, includeNestedMarketContext);
  const domainCompatible = hasCompatibleDomain(postDomains, marketDomains);
  const fallbackOverridesWink =
    gate?.pass === false &&
    fallbackGate.pass &&
    fallbackGate.sharedEntities >= 1 &&
    postDomains.size > 0 &&
    marketDomains.size > 0 &&
    domainCompatible;
  let resolvedGate = gate ?? fallbackGate;
  if (fallbackOverridesWink) {
    resolvedGate = {
      ...fallbackGate,
      details: `${fallbackGate.details}; wink=failed-local-high-precision-pass`,
    };
  }
  let gatePass =
    gate?.pass === true || gate === undefined
      ? gate?.pass === true || fallbackGate.pass
      : fallbackOverridesWink;
  let usedRecoveryGate = false;
  let recoveryGate: ContextGateResult | undefined;
  const specificEntityCount = Math.max(
    fallbackGate.sharedEntities,
    gate?.sharedEntities ?? 0,
    sharedHighPrecisionSignals.length
  );
  const rerankPromoted = rerankEvidence?.promotionStatus === "passed";
  const rerankPassed =
    rerankPromoted &&
    Number.isFinite(rerankEvidence?.score) &&
    Number.isFinite(rerankEvidence?.threshold) &&
    (rerankEvidence?.score ?? -Infinity) >=
      (rerankEvidence?.threshold ?? Infinity);

  if (scoringMode === "heuristic") {
    gatePass =
      hasPerMarketTagMatch(matchedTags, market) ||
      (resolvedGate.pass &&
        resolvedGate.sharedNouns >= HEURISTIC_STRICT_SHARED_NOUNS);
  }

  const hasSingleSignal =
    resolvedGate.meaningfulNouns >= 1 || resolvedGate.sharedEntities >= 1;
  const legacyRelaxedWouldRecover =
    !gatePass &&
    relaxed === true &&
    score >= AI_GATE_RETRY_FLOOR &&
    hasSingleSignal &&
    domainCompatible;

  // The active platform-specific relaxation requires calibrated rerank
  // evidence. The historical score-plus-one-signal rule above is retained
  // only as shadow telemetry.
  if (
    !gatePass &&
    relaxed &&
    score >= AI_GATE_RETRY_FLOOR &&
    specificEntityCount > 0 &&
    rerankPassed
  ) {
    if (hasSingleSignal) {
      gatePass = true;
    }
  }

  if (
    !gatePass &&
    scoringMode === "hybrid" &&
    score >= HIGH_PRECISION_SINGLE_SIGNAL_FLOOR &&
    specificEntityCount > 0 &&
    rerankPassed
  ) {
    recoveryGate = fallbackGate;
    resolvedGate = {
      ...fallbackGate,
      details: `${fallbackGate.details}; calibrated-rerank-recovery=${rerankEvidence?.score}>=${rerankEvidence?.threshold}; specific=[${sharedHighPrecisionSignals.join(",")}]`,
    };
    gatePass = true;
    usedRecoveryGate = true;
  }

  const domainState =
    postDomains.size === 0 || marketDomains.size === 0
      ? "unknown"
      : domainCompatible
        ? "compatible"
        : "incompatible";
  if (gatePass && !domainCompatible) {
    gatePass = false;
    resolvedGate = withDomainGateDetails(
      resolvedGate,
      postDomains,
      marketDomains
    );
  }

  return {
    gate: resolvedGate,
    recoveryGate,
    pass: gatePass,
    legacyRelaxedShadowEligible: legacyRelaxedWouldRecover && !gatePass,
    retryEligible:
      !gatePass &&
      domainCompatible &&
      scoringMode === "hybrid" &&
      score >= AI_GATE_RETRY_FLOOR &&
      (resolvedGate.meaningfulNouns >= 1 || resolvedGate.sharedEntities >= 1),
    usedFallbackGate: gate === undefined,
    usedRecoveryGate,
    evidence: {
      wink: {
        state:
          gate === undefined ? "unavailable" : gate.pass ? "passed" : "failed",
      },
      lexical: {
        passed: fallbackGate.pass,
        meaningfulNouns: fallbackGate.meaningfulNouns,
        sharedEntities: fallbackGate.sharedEntities,
      },
      specificEntity: { count: specificEntityCount },
      domain: {
        state: domainState,
        post: [...postDomains].sort(),
        market: [...marketDomains].sort(),
      },
      rerank: {
        score: Number.isFinite(rerankEvidence?.score)
          ? (rerankEvidence?.score ?? null)
          : null,
        threshold: Number.isFinite(rerankEvidence?.threshold)
          ? (rerankEvidence?.threshold ?? null)
          : null,
        promoted: rerankPromoted,
        passed: rerankPassed,
      },
    },
  };
}
