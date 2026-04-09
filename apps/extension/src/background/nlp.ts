import MiniSearch from "minisearch";
import model from "wink-eng-lite-web-model";
import winkNLP, { type ItsFunction } from "wink-nlp";
import type { ContextGateResult } from "../types/chrome-messages";
import { LRUCache } from "./lru-cache";

const nlp = winkNLP(model);
const its = nlp.its;
// wink-nlp's its.* properties are typed as opaque helpers that don't satisfy
// ItsFunction<string>. The double-cast works around incomplete upstream typings.
// TODO: remove when wink-nlp ships corrected types (see github.com/winkjs/wink-nlp/issues)
const itsValue = its.value as unknown as ItsFunction<string>;
const itsPos = its.pos as unknown as ItsFunction<string>;
const itsLemma = its.lemma as unknown as ItsFunction<string>;

const NUMERIC_RE = /^\d+(\.\d+)?$/;

const NER_POS = new Set(["PROPN", "NOUN"]);
const STOP_POS = new Set([
  "DET",
  "ADP",
  "CCONJ",
  "SCONJ",
  "PUNCT",
  "AUX",
  "PART",
  "SYM",
  "X",
  "SPACE",
]);

// High-frequency words that share across many domains and shouldn't count
// as meaningful overlap on their own.
const GENERIC_LEMMAS = new Set([
  "price",
  "market",
  "new",
  "year",
  "day",
  "time",
  "march",
  "april",
  "may",
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
  "week",
  "month",
  "next",
  "last",
  "first",
  "second",
  "third",
  "place",
  "win",
  "hit",
  "high",
  "low",
  "big",
  "top",
  "end",
  "start",
  "go",
  "get",
  "make",
  "take",
  "come",
  "give",
  "know",
  "think",
  "say",
  "tell",
  "find",
  "look",
  "want",
  "need",
  "use",
  "try",
  "call",
  "keep",
  "let",
  "set",
  "run",
  "show",
  "help",
  "turn",
  "play",
  "move",
  "live",
  "point",
  "number",
  "part",
  "long",
  "great",
  "rate",
  "world",
  "country",
  "state",
  "people",
  "government",
  "party",
  "election",
  "vote",
  "million",
  "billion",
  "percent",
  "report",
  "official",
  "system",
  "public",
  "private",
  "national",
  "international",
  "india",
  "indian",
  "china",
  "chinese",
  "american",
  "global",
]);

export interface NlpTokens {
  lemmas: string[];
  entities: string[];
  nouns: string[];
}

const BM25_MARKET_CACHE_SIZE = 80;
const BM25_SCORE_CACHE_SIZE = 240;
const TOKENIZE_CACHE_SIZE = 500;

const bm25IndexCache = new LRUCache<string, MiniSearch<MarketDoc>>(
  BM25_MARKET_CACHE_SIZE
);
const bm25ScoreCache = new LRUCache<string, number[]>(BM25_SCORE_CACHE_SIZE);
const tokenizeCache = new LRUCache<string, NlpTokens>(TOKENIZE_CACHE_SIZE);

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function makeBm25Key(marketTexts: string[]): string {
  const parts = new Array<string>(marketTexts.length + 1);
  parts[0] = String(marketTexts.length);
  for (let i = 0; i < marketTexts.length; i++) {
    parts[i + 1] = hashText(marketTexts[i]).toString(36);
  }
  return parts.join("|");
}

function makeBm25ScoreKey(postText: string, marketTexts: string[]): string {
  return `${hashText(postText).toString(36)}:${makeBm25Key(marketTexts)}`;
}

function createBm25Index(marketTexts: string[]): MiniSearch<MarketDoc> {
  const index = new MiniSearch<MarketDoc>({
    fields: ["text"],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
    },
  });
  const docs: MarketDoc[] = marketTexts.map((text, i) => ({ id: i, text }));
  index.addAll(docs);
  return index;
}

function getBm25Index(marketTexts: string[]): MiniSearch<MarketDoc> {
  if (marketTexts.length === 0) return createBm25Index([]);
  const key = makeBm25Key(marketTexts);
  const cached = bm25IndexCache.get(key);
  if (cached) return cached;
  const created = createBm25Index(marketTexts);
  bm25IndexCache.set(key, created);
  return created;
}

export function tokenize(text: string): NlpTokens {
  const cached = tokenizeCache.get(text);
  if (cached) {
    return cached;
  }

  const doc = nlp.readDoc(text);

  const lemmas: string[] = [];
  const entities: string[] = [];
  const nouns: string[] = [];

  const tokens = doc.tokens();
  const values = tokens.out(itsValue) as string[];
  const posTags = tokens.out(itsPos) as string[];
  const lemmaValues = tokens.out(itsLemma) as string[];

  for (let i = 0; i < values.length; i++) {
    const pos = posTags[i];
    const lemma = (lemmaValues[i] || values[i]).toLowerCase();

    if (STOP_POS.has(pos) || lemma.length < 2) continue;
    if (pos === "NUM" || NUMERIC_RE.test(lemma)) continue;

    lemmas.push(lemma);

    if (pos === "PROPN" && !NUMERIC_RE.test(values[i])) {
      entities.push(values[i]);
    }
    if (NER_POS.has(pos)) {
      nouns.push(lemma);
    }
  }

  const docEntities = doc.entities();
  const entityValues = docEntities.out(itsValue) as string[];
  for (const entity of entityValues) {
    if (entity.length >= 2 && !NUMERIC_RE.test(entity)) entities.push(entity);
  }

  const result = {
    lemmas: [...new Set(lemmas)],
    entities: [...new Set(entities)],
    nouns: [...new Set(nouns)],
  };
  tokenizeCache.set(text, result);
  return result;
}

interface MarketDoc {
  id: number;
  text: string;
}

function runContextGate(post: NlpTokens, market: NlpTokens): ContextGateResult {
  // Use NOUNS only (NOUN + PROPN POS tags) for overlap — this structurally
  // excludes verbs, adverbs, adjectives, question words (how, many, what),
  // pronouns, etc. that carry no topical signal.
  const postNounSet = new Set(post.nouns);
  const marketNounSet = new Set(market.nouns);
  let sharedNouns = 0;
  let meaningfulNouns = 0;
  const sharedNounList: string[] = [];
  for (const noun of postNounSet) {
    if (marketNounSet.has(noun)) {
      sharedNouns++;
      sharedNounList.push(noun);
      if (!GENERIC_LEMMAS.has(noun)) {
        meaningfulNouns++;
      }
    }
  }

  // Entity matching — only count entities that are specific enough to
  // confirm topical overlap. Single short words like "Sam", "Max", "Will"
  // are common first names that appear across unrelated contexts.
  // Require either: multi-word entity ("Sam Altman") OR single word >= 5 chars.
  const isSpecificEntity = (entity: string): boolean => {
    if (GENERIC_LEMMAS.has(entity) || NUMERIC_RE.test(entity)) return false;
    const words = entity.trim().split(/\s+/);
    if (words.length >= 2) return true;
    return entity.length >= 5;
  };

  const postEntitySet = new Set(
    post.entities.map((entity) => entity.toLowerCase()).filter(isSpecificEntity)
  );
  const marketEntitySet = new Set(
    market.entities
      .map((entity) => entity.toLowerCase())
      .filter(isSpecificEntity)
  );
  let sharedEntities = 0;
  const sharedEntityList: string[] = [];
  for (const entity of postEntitySet) {
    if (marketEntitySet.has(entity)) {
      sharedEntities++;
      sharedEntityList.push(entity);
    }
  }

  // Only non-generic nouns count toward the gate decision.
  const meaningfulNounList = sharedNounList.filter(
    (noun) => !GENERIC_LEMMAS.has(noun)
  );

  // A single shared word (e.g. a city "Lucknow") can appear as both a noun
  // and an entity — count DISTINCT matching words across both signals.
  const allSharedWords = new Set([...meaningfulNounList, ...sharedEntityList]);
  const distinctSignals = allSharedWords.size;

  const pass = distinctSignals >= 2;
  const details = `nouns=[${sharedNounList.join(",")}] meaningful=[${meaningfulNounList.join(",")}] entities=[${sharedEntityList.join(",")}] distinct=${distinctSignals}`;
  return { pass, sharedNouns, meaningfulNouns, sharedEntities, details };
}

export function nlpContextGateBatch(
  postText: string,
  marketTexts: string[]
): ContextGateResult[] {
  if (marketTexts.length === 0) return [];
  const postTokens = tokenize(postText);
  return marketTexts.map((marketText) => {
    const marketTokens = tokenize(marketText);
    return runContextGate(postTokens, marketTokens);
  });
}

/**
 * NLP-powered context gate: checks whether the post and market share
 * meaningful lexical overlap using lemmatized tokens and entity matching.
 *
 * "Meaningful" means the shared lemma is NOT in the GENERIC_LEMMAS set —
 * generic words like "price", "market", month names, country demonyms, etc.
 * are too common across domains to signal real topical overlap.
 */
export function nlpContextGate(
  postText: string,
  marketText: string
): ContextGateResult {
  return runContextGate(tokenize(postText), tokenize(marketText));
}

/**
 * BM25 scoring: index market texts then search with post text.
 * Returns an array of scores aligned with the input marketTexts array.
 */
export function bm25Score(postText: string, marketTexts: string[]): number[] {
  if (marketTexts.length === 0) return [];

  const cachedKey = makeBm25ScoreKey(postText, marketTexts);
  const cached = bm25ScoreCache.get(cachedKey);
  if (cached) return cached;

  const index = getBm25Index(marketTexts);
  const postTokens = tokenize(postText);
  const query = postTokens.lemmas.slice(0, 20).join(" ");
  if (!query.trim()) return new Array(marketTexts.length).fill(0);

  const results = index.search(query);
  const scoreMap = new Map<number, number>();
  let maxScore = 0;
  for (const result of results) {
    if (result.score > maxScore) maxScore = result.score;
    scoreMap.set(result.id, result.score);
  }

  if (maxScore === 0) return new Array(marketTexts.length).fill(0);

  const scores = marketTexts.map((_, i) => {
    const raw = scoreMap.get(i) ?? 0;
    return raw / maxScore;
  });
  bm25ScoreCache.set(cachedKey, scores);
  return scores;
}
