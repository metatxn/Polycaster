import { logWarn } from "@knoww/logger";
import { computeSimilarities } from "./embeddings";
import { bm25Score, nlpContextGateBatch } from "./nlp";
import { createScoreMarkets } from "./score-markets-core";

export type { ScoreMarketsResult } from "./score-markets-core";

export const scoreMarkets = createScoreMarkets({
  computeSimilarities,
  bm25Score,
  nlpContextGateBatch,
  logWarn,
});
