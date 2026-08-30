import { logWarn } from "@knoww/logger";
import { computeSimilarities, rerankMarketPairs } from "./embeddings";
import { bm25Score, nlpContextGateBatch, stableLexicalScore } from "./nlp";
import { createScoreMarkets } from "./score-markets-core";

export type { ScoreMarketsResult } from "./score-markets-core";

export const scoreMarkets = createScoreMarkets({
  computeSimilarities,
  bm25Score,
  stableLexicalScore,
  nlpContextGateBatch,
  rerankMarketPairs,
  logWarn,
});
