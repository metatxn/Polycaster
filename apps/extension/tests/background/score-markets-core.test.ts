import assert from "node:assert/strict";
import test from "node:test";
import {
  createScoreMarkets,
  type ScoreMarketsDeps,
} from "../../src/background/score-markets-core";
import type { ContextGateResult } from "../../src/types/chrome-messages";

function createGate(
  overrides: Partial<ContextGateResult> = {}
): ContextGateResult {
  return {
    pass: true,
    sharedNouns: 2,
    meaningfulNouns: 2,
    sharedEntities: 0,
    details: "nlp-pass",
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<ScoreMarketsDeps> = {}
): ScoreMarketsDeps & { warnEvents: string[] } {
  const warnEvents: string[] = [];

  return {
    warnEvents,
    computeSimilarities: async () => [0.91, 0.37],
    bm25Score: () => [0.22, 0.11],
    nlpContextGateBatch: () => [createGate(), createGate()],
    logWarn: (event) => {
      warnEvents.push(event);
    },
    ...overrides,
  };
}

test("score-markets core returns zeroed arrays for empty post text", async () => {
  const deps = createDeps();
  const scoreMarkets = createScoreMarkets(deps);

  const result = await scoreMarkets({
    type: "score-markets",
    postText: "",
    marketTexts: ["market one"],
    includeContextGate: true,
  });

  assert.deepEqual(result.similarities, [0]);
  assert.deepEqual(result.bm25Scores, [0]);
  assert.deepEqual(result.contextGateResults, []);
  assert.equal(result.usedEmbeddings, false);
});

test("score-markets core pads shorter result arrays", async () => {
  const deps = createDeps({
    computeSimilarities: async () => [0.91],
    bm25Score: () => [0.22, 0.11],
    nlpContextGateBatch: () => [createGate()],
  });
  const scoreMarkets = createScoreMarkets(deps);

  const result = await scoreMarkets({
    type: "score-markets",
    postText: "OpenAI product launch",
    marketTexts: ["market one", "market two"],
    gateTexts: ["gate one", "gate two"],
    includeContextGate: true,
  });

  assert.deepEqual(result.similarities, [0.91, 0]);
  assert.deepEqual(result.bm25Scores, [0.22, 0.11]);
  assert.equal(result.contextGateResults[0].details, "nlp-pass");
  assert.equal(result.contextGateResults[1].details, "disabled");
  assert.equal(result.usedEmbeddings, true);
});

test("score-markets core keeps BM25 when embeddings fail", async () => {
  const deps = createDeps({
    computeSimilarities: async () => {
      throw new Error("embeddings down");
    },
    bm25Score: () => [0.8],
  });
  const scoreMarkets = createScoreMarkets(deps);

  const result = await scoreMarkets({
    type: "score-markets",
    postText: "Japan decision",
    marketTexts: ["Bank of Japan Decision in June?"],
  });

  assert.deepEqual(result.similarities, [0]);
  assert.deepEqual(result.bm25Scores, [0.8]);
  assert.equal(result.usedEmbeddings, false);
  assert.ok(deps.warnEvents.includes("scoring.embeddings-failed"));
});

test("score-markets core leaves gate results empty when the NLP gate fails", async () => {
  const deps = createDeps({
    nlpContextGateBatch: () => {
      throw new Error("nlp failed");
    },
  });
  const scoreMarkets = createScoreMarkets(deps);

  const result = await scoreMarkets({
    type: "score-markets",
    postText: "Claude release",
    marketTexts: ["Claude 5 released by...?"],
    includeContextGate: true,
  });

  assert.deepEqual(result.contextGateResults, []);
  assert.ok(deps.warnEvents.includes("scoring.context-gate-failed"));
});

test("score-markets core falls back to market texts when gate text length mismatches", async () => {
  let seenGateTexts: string[] = [];
  const deps = createDeps({
    nlpContextGateBatch: (_postText, gateTexts) => {
      seenGateTexts = gateTexts;
      return [createGate(), createGate()];
    },
  });
  const scoreMarkets = createScoreMarkets(deps);

  await scoreMarkets({
    type: "score-markets",
    postText: "Market text mismatch",
    marketTexts: ["market one", "market two"],
    gateTexts: ["only one"],
    includeContextGate: true,
  });

  assert.deepEqual(seenGateTexts, ["market one", "market two"]);
});

test("score-markets core respects disabled feature flags", async () => {
  let embeddingsCalled = 0;
  let bm25Called = 0;
  let gateCalled = 0;
  const deps = createDeps({
    computeSimilarities: async () => {
      embeddingsCalled++;
      return [0.4];
    },
    bm25Score: () => {
      bm25Called++;
      return [0.2];
    },
    nlpContextGateBatch: () => {
      gateCalled++;
      return [createGate()];
    },
  });
  const scoreMarkets = createScoreMarkets(deps);

  const result = await scoreMarkets({
    type: "score-markets",
    postText: "AI update",
    marketTexts: ["Claude 5 released by...?"],
    includeEmbeddings: false,
    includeBm25: false,
    includeContextGate: true,
  });

  assert.deepEqual(result.similarities, []);
  assert.deepEqual(result.bm25Scores, []);
  assert.equal(result.contextGateResults.length, 1);
  assert.equal(result.usedEmbeddings, false);
  assert.equal(embeddingsCalled, 0);
  assert.equal(bm25Called, 0);
  assert.equal(gateCalled, 1);
});
