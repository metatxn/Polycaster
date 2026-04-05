import type {
  ContextGateResult,
  ScoreMarketsMessage,
} from "../types/chrome-messages";
import { computeSimilarities } from "./embeddings";
import { logWarn } from "./logger";
import { bm25Score, nlpContextGateBatch } from "./nlp";

interface NormalizedScoreMarketsMessage {
  postText: string;
  marketTexts: string[];
  gateTexts: string[];
  includeEmbeddings: boolean;
  includeBm25: boolean;
  includeContextGate: boolean;
}

export interface ScoreMarketsResult {
  similarities: number[];
  bm25Scores: number[];
  contextGateResults: ContextGateResult[];
  usedEmbeddings: boolean;
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

  return {
    postText: message.postText,
    marketTexts: message.marketTexts || [],
    gateTexts:
      message.gateTexts &&
      message.gateTexts.length === message.marketTexts.length
        ? message.gateTexts
        : message.marketTexts || [],
    includeEmbeddings,
    includeBm25,
    includeContextGate,
  };
}

export async function scoreMarkets(
  message: ScoreMarketsMessage
): Promise<ScoreMarketsResult> {
  const {
    postText,
    marketTexts,
    gateTexts,
    includeEmbeddings,
    includeBm25,
    includeContextGate,
  } = normalizeRequest(message);

  if (!postText || marketTexts.length === 0) {
    const empty = new Array<number>(marketTexts.length).fill(0);
    return {
      similarities: includeEmbeddings ? empty : [],
      bm25Scores: includeBm25 ? empty : [],
      contextGateResults: [],
      usedEmbeddings: false,
    };
  }

  const count = marketTexts.length;
  const zero = new Array<number>(count).fill(0);
  let usedEmbeddings = false;
  let similarities = zero;
  let bm25Scores = zero;

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
      similarities = zero;
    }
  }

  if (includeBm25) {
    try {
      bm25Scores = padArray(bm25Score(postText, marketTexts), count, () => 0);
    } catch (error) {
      logWarn("scoring.bm25-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      bm25Scores = zero;
    }
  }

  const contextGateDefault: ContextGateResult = {
    pass: false,
    sharedNouns: 0,
    meaningfulNouns: 0,
    sharedEntities: 0,
    details: "disabled",
  };
  const contextGateResults = includeContextGate
    ? padArray(nlpContextGateBatch(postText, gateTexts), count, () => ({
        ...contextGateDefault,
      }))
    : [];

  return {
    similarities,
    bm25Scores,
    contextGateResults,
    usedEmbeddings,
  };
}
