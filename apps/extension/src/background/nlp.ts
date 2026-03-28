import MiniSearch from "minisearch";
import model from "wink-eng-lite-web-model";
import winkNLP, { type ItsFunction } from "wink-nlp";

const nlp = winkNLP(model);
const its = nlp.its;
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

export function tokenize(text: string): NlpTokens {
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
  for (const ent of entityValues) {
    if (ent.length >= 2 && !NUMERIC_RE.test(ent)) entities.push(ent);
  }

  return {
    lemmas: [...new Set(lemmas)],
    entities: [...new Set(entities)],
    nouns: [...new Set(nouns)],
  };
}

interface MarketDoc {
  id: number;
  text: string;
}

/**
 * BM25 scoring: index market texts then search with post text.
 * Returns an array of scores aligned with the input marketTexts array.
 */
export function bm25Score(postText: string, marketTexts: string[]): number[] {
  if (marketTexts.length === 0) return [];

  const index = new MiniSearch<MarketDoc>({
    fields: ["text"],
    storeFields: ["text"],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
    },
  });

  const docs: MarketDoc[] = marketTexts.map((text, i) => ({
    id: i,
    text,
  }));
  index.addAll(docs);

  const postTokens = tokenize(postText);
  const query = postTokens.lemmas.slice(0, 20).join(" ");

  if (!query.trim()) return new Array(marketTexts.length).fill(0);

  const results = index.search(query, { prefix: true, fuzzy: 0.2 });

  const scoreMap = new Map<number, number>();
  let maxScore = 0;
  for (const r of results) {
    if (r.score > maxScore) maxScore = r.score;
    scoreMap.set(r.id, r.score);
  }

  if (maxScore === 0) return new Array(marketTexts.length).fill(0);

  return marketTexts.map((_, i) => {
    const raw = scoreMap.get(i) ?? 0;
    return raw / maxScore;
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
): {
  pass: boolean;
  sharedNouns: number;
  meaningfulNouns: number;
  sharedEntities: number;
  details: string;
} {
  const post = tokenize(postText);
  const market = tokenize(marketText);

  // Use NOUNS only (NOUN + PROPN POS tags) for overlap — this structurally
  // excludes verbs, adverbs, adjectives, question words (how, many, what),
  // pronouns, etc. that carry no topical signal.
  const postNounSet = new Set(post.nouns);
  const marketNounSet = new Set(market.nouns);
  let sharedNouns = 0;
  let meaningfulNouns = 0;
  const sharedNounList: string[] = [];
  for (const n of postNounSet) {
    if (marketNounSet.has(n)) {
      sharedNouns++;
      sharedNounList.push(n);
      if (!GENERIC_LEMMAS.has(n)) {
        meaningfulNouns++;
      }
    }
  }

  // Entity matching — only count entities that are specific enough to
  // confirm topical overlap. Single short words like "Sam", "Max", "Will"
  // are common first names that appear across unrelated contexts.
  // Require either: multi-word entity ("Sam Altman") OR single word >= 5 chars.
  const isSpecificEntity = (e: string): boolean => {
    if (GENERIC_LEMMAS.has(e) || NUMERIC_RE.test(e)) return false;
    const words = e.trim().split(/\s+/);
    if (words.length >= 2) return true;
    return e.length >= 5;
  };

  const postEntitySet = new Set(
    post.entities.map((e) => e.toLowerCase()).filter(isSpecificEntity)
  );
  const marketEntitySet = new Set(
    market.entities.map((e) => e.toLowerCase()).filter(isSpecificEntity)
  );
  let sharedEntities = 0;
  const sharedEntityList: string[] = [];
  for (const e of postEntitySet) {
    if (marketEntitySet.has(e)) {
      sharedEntities++;
      sharedEntityList.push(e);
    }
  }

  // A single shared word (e.g. a city "Lucknow") can appear as both a noun
  // and an entity — count DISTINCT matching words across both signals.
  const allSharedWords = new Set([...sharedNounList, ...sharedEntityList]);
  const distinctSignals = allSharedWords.size;

  const pass = distinctSignals >= 2;
  const details = `nouns=[${sharedNounList.join(",")}] meaningful=${meaningfulNouns} entities=[${sharedEntityList.join(",")}] distinct=${distinctSignals}`;
  return { pass, sharedNouns, meaningfulNouns, sharedEntities, details };
}
