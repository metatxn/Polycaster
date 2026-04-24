import { logWarn } from "@knoww/logger";
import { warmUp } from "../background/embeddings";
import { scoreMarkets } from "../background/scoring";
import type {
  ScoreMarketsMessage,
  ScoreMarketsSuccessResponse,
} from "../types/chrome-messages";

let scoringWarmedUp = false;
let warmUpPromise: Promise<void> | null = null;

async function ensureScoringWarm(): Promise<void> {
  if (scoringWarmedUp) return;
  if (warmUpPromise) return warmUpPromise;

  warmUpPromise = warmUp()
    .then(() => {
      scoringWarmedUp = true;
    })
    .catch((err) => {
      warmUpPromise = null;
      scoringWarmedUp = false;
      logWarn("offscreen.warmup-failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    });

  return warmUpPromise;
}

export async function prewarmScoring(): Promise<void> {
  await ensureScoringWarm();
}

export async function handleScoringMessage(
  request: ScoreMarketsMessage
): Promise<ScoreMarketsSuccessResponse> {
  await ensureScoringWarm();
  const result = await scoreMarkets(request);

  return {
    ok: true,
    similarities: result.similarities,
    bm25Scores: result.bm25Scores,
    contextGateResults: result.contextGateResults,
    usedEmbeddings: result.usedEmbeddings,
  };
}
