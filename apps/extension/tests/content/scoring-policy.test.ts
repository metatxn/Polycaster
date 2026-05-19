import assert from "node:assert/strict";
import test from "node:test";
import {
  CASE_INSENSITIVE_HIGH_SIGNAL_TOKENS,
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

test("naiveContextGate ignores green-card versus fight-card token overlap", () => {
  const gate = naiveContextGate(
    "Green Card holders returned to India to build MapmyIndia and hire Indian engineers",
    "UFC 328: Jeremy Stephens vs. King Green (Lightweight, Main Card)"
  );

  assert.equal(gate.pass, false, gate.details);
  assert.equal(gate.sharedNouns, 0, gate.details);
  assert.equal(gate.sharedEntities, 0, gate.details);
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

test("naiveContextGate requires at least two distinct signals", () => {
  const gate = naiveContextGate(
    "GTA trailer rumor tonight",
    "GTA VI released before June 2026?"
  );

  assert.equal(gate.pass, false);
});

test("case-insensitive high-signal tokens exclude ambiguous common words", () => {
  assert.equal(CASE_INSENSITIVE_HIGH_SIGNAL_TOKENS.has("hyperliquid"), true);
  assert.equal(CASE_INSENSITIVE_HIGH_SIGNAL_TOKENS.has("who"), false);
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

test("evaluateCandidateGate does not recover a single high-score entity match", () => {
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

  assert.equal(decision.pass, false);
  assert.equal(decision.usedRecoveryGate, false);
});

test("evaluateCandidateGate accepts high-score Hyperliquid protocol overlap", () => {
  const decision = evaluateCandidateGate({
    postText: "When can I access $troll on hyperliquid?",
    market: createMarket({
      title: "Hyperliquid listed on Binance in 2026?",
      category: "Crypto",
      tags: [{ slug: "crypto", label: "Crypto" }],
    }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.77,
    gate: createGate({
      meaningfulNouns: 1,
      sharedEntities: 0,
      details:
        "nouns=[hyperliquid] meaningful=[hyperliquid] entities=[] distinct=1",
    }),
  });

  assert.equal(decision.pass, true);
});

test("evaluateCandidateGate recovers Hyperliquid X handle aliases", () => {
  const decision = evaluateCandidateGate({
    postText:
      "This is awesome but when are you gonna list $TROLL on your platform @HyperliquidX",
    market: createMarket({
      title: "Hyperliquid listed on Binance in 2026?",
      category: "Crypto",
      tags: [{ slug: "crypto", label: "Crypto" }],
    }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.8,
    gate: createGate({
      meaningfulNouns: 0,
      sharedEntities: 0,
      details: "nouns=[] meaningful=[] entities=[] distinct=0",
    }),
  });

  assert.equal(decision.pass, true);
  assert.equal(decision.usedRecoveryGate, true);
});

test("evaluateCandidateGate still rejects Phantom esports false positives", () => {
  const decision = evaluateCandidateGate({
    postText: "I wonder what the #1 trending token on phantom is",
    market: createMarket({
      title: "Counter-Strike: Eternal Fire Academy vs Phantom Academy",
    }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.8,
    gate: createGate({
      meaningfulNouns: 1,
      sharedEntities: 0,
      details: "nouns=[phantom] meaningful=[phantom] entities=[] distinct=1",
    }),
  });

  assert.equal(decision.pass, false);
  assert.ok(/domain-gate=reject/.test(decision.gate.details));
});

test("evaluateCandidateGate does not recover a single weak noun overlap", () => {
  const decision = evaluateCandidateGate({
    postText: "How do I get my hands on one of these bad boys?",
    market: createMarket({
      title: "How long will Trump and Xi shake hands when they meet?",
    }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.67,
    gate: createGate({
      meaningfulNouns: 1,
      sharedEntities: 0,
      details: "nouns=[hand] meaningful=[hand] entities=[] distinct=1",
    }),
  });

  assert.equal(decision.pass, false);
  assert.equal(decision.usedRecoveryGate, false);
});

test("evaluateCandidateGate rejects location-only overlap across unrelated topics", () => {
  const decision = evaluateCandidateGate({
    postText:
      "Delhi-based dpropulse is building India's first rotating detonation engine",
    market: createMarket({
      title: "Legends Cricket League: Daredevils Delhi vs India Tigers",
    }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.86,
    gate: createGate({
      meaningfulNouns: 1,
      sharedEntities: 1,
      details:
        "nouns=[delhi,india] meaningful=[delhi] entities=[delhi] distinct=1",
    }),
  });

  assert.equal(decision.pass, false);
  assert.equal(decision.usedRecoveryGate, false);
});

test("evaluateCandidateGate rejects sports markets for immigration business posts", () => {
  const decision = evaluateCandidateGate({
    postText:
      "MapmyIndia founders were Green Card holders who built a company in India and now hire Indian engineers",
    market: createMarket({
      title: "UFC 328: Jeremy Stephens vs. King Green (Lightweight, Main Card)",
      category: "Sports",
      tags: [{ slug: "sports", label: "Sports" }],
    }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.82,
    gate: createGate({
      pass: true,
      meaningfulNouns: 2,
      sharedEntities: 0,
      details: "nouns=[green,card,india] meaningful=[green,card] distinct=2",
    }),
  });

  assert.equal(decision.pass, false);
  assert.ok(/domain-gate=reject/.test(decision.gate.details));
  assert.ok(/market=\[sports\]/.test(decision.gate.details));
  assert.equal(decision.retryEligible, false);
});

test("evaluateCandidateGate keeps sports markets for sports posts", () => {
  const decision = evaluateCandidateGate({
    postText:
      "UFC lightweight fight card is stacked and King Green looks ready for the main event",
    market: createMarket({
      title: "UFC 328: Jeremy Stephens vs. King Green (Lightweight, Main Card)",
      category: "Sports",
      tags: [{ slug: "sports", label: "Sports" }],
    }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.82,
    gate: createGate({
      pass: true,
      meaningfulNouns: 2,
      sharedEntities: 1,
      details: "nouns=[ufc,lightweight,fight] distinct=3",
    }),
  });

  assert.equal(decision.pass, true);
});

test("evaluateCandidateGate keeps compatible business and tech domains", () => {
  const decision = evaluateCandidateGate({
    postText:
      "OpenAI and Microsoft updated their cloud partnership for enterprise AI customers",
    market: createMarket({
      title: "Will Microsoft AI revenue beat expectations this quarter?",
      category: "Companies",
      tags: [{ slug: "technology", label: "Technology" }],
    }),
    matchedTags: ["technology"],
    scoringMode: "hybrid",
    score: 0.78,
    gate: createGate({
      pass: true,
      meaningfulNouns: 2,
      sharedEntities: 1,
      details: "nouns=[microsoft,ai] distinct=2",
    }),
  });

  assert.equal(decision.pass, true);
});

test("shouldFailOpen keeps the shared score floor behavior", () => {
  assert.equal(shouldFailOpen(0.49), false);
  assert.equal(shouldFailOpen(0.5), true);
  assert.equal(shouldFailOpen(0.73), true);
});

test("evaluateCandidateGate relaxed passes a single-signal high-score match (kalshi)", () => {
  // Mirrors the live Kalshi case "More tech layoffs in 2026..." vs
  // "Tech Layoffs Up or Down in 2026?" — both sides share only `tech` but the
  // score is decisively high, so the relaxed gate should accept it.
  const decision = evaluateCandidateGate({
    postText: "More tech layoffs in 2026 than in 2025?",
    market: createMarket({ title: "Tech Layoffs Up or Down in 2026?" }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.926,
    gate: createGate({
      meaningfulNouns: 1,
      sharedEntities: 0,
      details: "nouns=[tech] meaningful=[tech] entities=[] distinct=1",
    }),
    relaxed: true,
  });

  assert.equal(decision.pass, true);
});

test("evaluateCandidateGate relaxed still rejects single-signal low-score matches", () => {
  // Score below AI_GATE_RETRY_FLOOR (0.6) — relaxation must not lower the
  // quality bar for weak matches.
  const decision = evaluateCandidateGate({
    postText: "Number of rate cuts in 2026?",
    market: createMarket({
      title: "Number of TSA passengers April 13-April 19?",
    }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.55,
    gate: createGate({
      meaningfulNouns: 1,
      sharedEntities: 0,
      details: "nouns=[number] meaningful=[number] entities=[] distinct=1",
    }),
    relaxed: true,
  });

  assert.equal(decision.pass, false);
});

test("evaluateCandidateGate relaxed without any signals still fails", () => {
  const decision = evaluateCandidateGate({
    postText: "Unrelated topic A",
    market: createMarket({ title: "Unrelated topic B" }),
    matchedTags: [],
    scoringMode: "hybrid",
    score: 0.9,
    gate: createGate({
      meaningfulNouns: 0,
      sharedEntities: 0,
      details: "distinct=0",
    }),
    relaxed: true,
  });

  assert.equal(decision.pass, false);
});
