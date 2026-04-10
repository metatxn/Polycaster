import assert from "node:assert/strict";
import test from "node:test";
import {
  determineScoringMode,
  evaluateCandidateGate,
  getEffectiveThreshold,
  naiveContextGate,
  shouldFailOpen,
} from "../../src/content/scoring-policy";
import type { ContextGateResult } from "../../src/types/chrome-messages";
import type { Market } from "../../src/types/market";

function createMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: "market-1",
    title: "Default market",
    source: "polymarket",
    ...overrides,
  };
}

function createGate(
  overrides: Partial<ContextGateResult> = {}
): ContextGateResult {
  return {
    pass: false,
    sharedNouns: 0,
    meaningfulNouns: 0,
    sharedEntities: 0,
    details: "test-gate",
    ...overrides,
  };
}

test("naiveContextGate ignores generic overlap", () => {
  const gate = naiveContextGate(
    "Will this happen today after more updates?",
    "Will that market move today after more reports?"
  );

  assert.equal(gate.pass, false);
  assert.equal(gate.sharedNouns, 0);
  assert.equal(gate.sharedEntities, 0);
});

test("naiveContextGate normalizes hashtags and contractions", () => {
  const gate = naiveContextGate(
    "Japan's #Uranium policy isn't changing",
    "Will uranium policy in Japan change?"
  );

  assert.equal(gate.pass, true);
  assert.ok(gate.sharedNouns >= 2);
});

test("naiveContextGate normalizes smart/curly apostrophes", () => {
  const gate = naiveContextGate(
    "Japan\u2019s #Uranium policy isn\u2019t changing",
    "Will uranium policy in Japan change?"
  );

  assert.equal(gate.pass, true);
  assert.ok(
    gate.sharedNouns >= 2,
    `Expected >= 2 shared nouns with curly quotes, got ${gate.sharedNouns}`
  );
});

test("naiveContextGate handles left curly apostrophe in contractions", () => {
  const gate = naiveContextGate(
    "Tesla\u2018s Cybertruck deliveries aren\u2019t meeting targets",
    "Will Tesla Cybertruck deliveries exceed 500k?"
  );

  assert.equal(gate.pass, true);
  assert.ok(
    gate.sharedNouns >= 2,
    `Expected >= 2 shared nouns with left curly quotes, got ${gate.sharedNouns}`
  );
});

test("naiveContextGate allows a single high-signal token match", () => {
  const gate = naiveContextGate(
    "GTA trailer rumor tonight",
    "GTA VI released before June 2026?"
  );

  assert.equal(gate.pass, true);
  assert.ok(gate.details.includes("high-signal"));
});

test("determineScoringMode distinguishes hybrid lexical and heuristic", () => {
  assert.equal(
    determineScoringMode({
      usedEmbeddings: true,
      bm25Scores: [0],
      source: "offscreen",
    }),
    "hybrid"
  );
  assert.equal(
    determineScoringMode({
      usedEmbeddings: false,
      bm25Scores: [0, 0.42],
      source: "offscreen",
    }),
    "lexical"
  );
  assert.equal(
    determineScoringMode({
      usedEmbeddings: false,
      bm25Scores: [0, 0],
      source: "fallback",
    }),
    "heuristic"
  );
});

test("getEffectiveThreshold only floors hybrid mode", () => {
  assert.equal(getEffectiveThreshold(0.45, "hybrid"), 0.5);
  assert.equal(getEffectiveThreshold(0.62, "hybrid"), 0.62);
  assert.equal(getEffectiveThreshold(0.45, "lexical"), 0.45);
  assert.equal(getEffectiveThreshold(0.45, "heuristic"), 0.45);
});

test("evaluateCandidateGate falls back to local gate in heuristic mode when missing", () => {
  const decision = evaluateCandidateGate({
    postText: "OpenAI product roadmap launch",
    market: createMarket({
      title: "OpenAI product launch roadmap",
    }),
    matchedTags: [],
    scoringMode: "heuristic",
    score: 0.68,
  });

  assert.equal(decision.usedFallbackGate, true);
  assert.equal(decision.pass, true);
});

test("evaluateCandidateGate uses per-market tags in heuristic mode", () => {
  const decision = evaluateCandidateGate({
    postText: "Security vendor outage",
    market: createMarket({
      title: "Championship final winner",
      tags: [{ slug: "sports" }],
    }),
    matchedTags: ["ai"],
    scoringMode: "heuristic",
    score: 0.72,
    gate: createGate(),
  });

  assert.equal(decision.pass, false);
});

test("evaluateCandidateGate marks hybrid near-misses as AI-retry eligible", () => {
  const decision = evaluateCandidateGate({
    postText: "Claude model benchmark update",
    market: createMarket({
      title: "Claude 5 released by...?",
    }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.61,
    gate: createGate({
      meaningfulNouns: 1,
      sharedEntities: 0,
      details: "distinct=1",
    }),
  });

  assert.equal(decision.pass, false);
  assert.equal(decision.retryEligible, true);
});

test("evaluateCandidateGate applies single-signal recovery for high-score entity matches", () => {
  const decision = evaluateCandidateGate({
    postText: "GTA trailer rumor tonight",
    market: createMarket({
      title: "GTA VI released before June 2026?",
    }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.7,
    gate: createGate({
      meaningfulNouns: 1,
      sharedEntities: 0,
      details: "distinct=1",
    }),
  });

  assert.equal(decision.pass, true);
  assert.equal(decision.usedRecoveryGate, true);
  assert.ok(decision.recoveryGate);
});

test("shouldFailOpen keeps the shared score floor behavior", () => {
  assert.equal(shouldFailOpen(0.49), false);
  assert.equal(shouldFailOpen(0.5), true);
  assert.equal(shouldFailOpen(0.73), true);
});
