import type {
  ContextGateResult,
  ScoreMarketsMessage,
} from "../types/chrome-messages";

interface NormalizedScoreMarketsMessage {
  postText: string;
  marketTexts: string[];
  gateTexts: string[];
  includeEmbeddings: boolean;
  includeBm25: boolean;
  includeContextGate: boolean;
  includeRerank: boolean;
}

export interface ScoreMarketsResult {
  similarities: number[];
  bm25Scores: number[];
  contextGateResults: ContextGateResult[];
  usedEmbeddings: boolean;
  rerankScores?: number[];
  rerankMetrics?: {
    count: number;
    elapsedMs: number;
    queueWaitMs: number;
    model: string;
    dtype: string;
    device: "webgpu" | "wasm";
  };
  usedRerank?: boolean;
}

export interface ScoreMarketsDeps {
  computeSimilarities: (
    postText: string,
    marketTexts: string[]
  ) => Promise<number[]>;
  bm25Score: (postText: string, marketTexts: string[]) => number[];
  nlpContextGateBatch: (
    postText: string,
    gateTexts: string[]
  ) => ContextGateResult[];
  rerankMarketPairs?: (
    postText: string,
    marketTexts: string[]
  ) => Promise<{
    scores: number[];
    metrics: {
      count: number;
      elapsedMs: number;
      queueWaitMs: number;
      model: string;
      dtype: string;
      device: "webgpu" | "wasm";
    };
  }>;
  logWarn: (event: string, payload?: unknown) => void;
}

type PadValue<T> = T | (() => T);

function resolvePadValue<T>(value: PadValue<T>): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

function padArray<T>(arr: T[], length: number, value: PadValue<T>): T[] {
  if (arr.length === length) return arr;
  if (arr.length > length) return arr.slice(0, length);
  const out = arr.slice();
  while (out.length < length) out.push(resolvePadValue(value));
  return out;
}

function normalizeRequest(
  message: ScoreMarketsMessage
): NormalizedScoreMarketsMessage {
  const includeEmbeddings = message.includeEmbeddings ?? true;
  const includeBm25 = message.includeBm25 ?? true;
  const includeContextGate = message.includeContextGate ?? false;
  const includeRerank = message.includeRerank ?? false;
  const marketTexts = message.marketTexts || [];
  const gateTexts =
    message.gateTexts && message.gateTexts.length === marketTexts.length
      ? message.gateTexts
      : marketTexts;

  return {
    postText: message.postText,
    marketTexts,
    gateTexts,
    includeEmbeddings,
    includeBm25,
    includeContextGate,
    includeRerank,
  };
}

export function createScoreMarkets({
  computeSimilarities,
  bm25Score,
  nlpContextGateBatch,
  rerankMarketPairs,
  logWarn,
}: ScoreMarketsDeps) {
  return async function scoreMarkets(
    message: ScoreMarketsMessage
  ): Promise<ScoreMarketsResult> {
    const {
      postText,
      marketTexts,
      gateTexts,
      includeEmbeddings,
      includeBm25,
      includeContextGate,
      includeRerank,
    } = normalizeRequest(message);

    if (!postText || marketTexts.length === 0) {
      const empty = new Array<number>(marketTexts.length).fill(0);
      return {
        similarities: includeEmbeddings ? empty : [],
        bm25Scores: includeBm25 ? empty : [],
        contextGateResults: [],
        usedEmbeddings: false,
        rerankScores: includeRerank ? empty : undefined,
        usedRerank: false,
      };
    }

    const count = marketTexts.length;
    const createZeroScores = () => new Array<number>(count).fill(0);
    let usedEmbeddings = false;
    let similarities = includeEmbeddings ? createZeroScores() : [];
    let bm25Scores = includeBm25 ? createZeroScores() : [];
    let rerankScores = includeRerank ? createZeroScores() : undefined;
    let rerankMetrics: ScoreMarketsResult["rerankMetrics"];
    let usedRerank = false;

    if (includeEmbeddings) {
      try {
        similarities = padArray(
          await computeSimilarities(postText, marketTexts),
          count,
          () => 0
        );
        usedEmbeddings = true;
      } catch (error) {
        logWarn("scoring.embeddings-failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        similarities = createZeroScores();
      }
    }

    if (includeBm25) {
      try {
        bm25Scores = padArray(bm25Score(postText, marketTexts), count, () => 0);
      } catch (error) {
        logWarn("scoring.bm25-failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        bm25Scores = createZeroScores();
      }
    }

    if (includeRerank && rerankMarketPairs) {
      try {
        const rerank = await rerankMarketPairs(postText, marketTexts);
        rerankScores = padArray(rerank.scores, count, () => 0);
        rerankMetrics = rerank.metrics;
        usedRerank = true;
      } catch (error) {
        logWarn("scoring.rerank-failed", {
          prefix: "[XENCODER-AB]",
          message: error instanceof Error ? error.message : String(error),
        });
        rerankScores = createZeroScores();
      }
    }

    const contextGateDefault: ContextGateResult = {
      pass: false,
      sharedNouns: 0,
      meaningfulNouns: 0,
      sharedEntities: 0,
      details: "disabled",
    };
    let contextGateResults: ContextGateResult[] = [];
    if (includeContextGate) {
      try {
        contextGateResults = padArray(
          nlpContextGateBatch(postText, gateTexts),
          count,
          () => ({ ...contextGateDefault })
        );
      } catch (error) {
        logWarn("scoring.context-gate-failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        // Empty array signals the caller to degrade to a local fallback gate
        // instead of treating the gate failure as a hard block.
        contextGateResults = [];
      }
    }

    return {
      similarities,
      bm25Scores,
      contextGateResults,
      usedEmbeddings,
      rerankScores,
      rerankMetrics,
      usedRerank,
    };
  };
}
