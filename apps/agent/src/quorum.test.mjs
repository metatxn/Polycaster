import assert from "node:assert/strict";
import test from "node:test";
import { reduceModelVotes, validateModelVote } from "./quorum.ts";

const baseVote = {
  provider: "model-a",
  action: "BUY",
  confidence: 0.78,
  fairProbability: 0.64,
  sizeUsd: "25",
  reasoning: "Order book implies a better price than fair probability.",
  citations: ["market-data"],
  riskFlags: [],
};

test("requires a valid majority before allowing a trade action", () => {
  const decision = reduceModelVotes([
    baseVote,
    { ...baseVote, provider: "model-b", confidence: 0.7 },
    { ...baseVote, provider: "model-c", action: "HOLD", confidence: 0.9 },
  ]);

  assert.equal(decision.action, "BUY");
  assert.equal(decision.majorityAction, "BUY");
  assert.equal(decision.approved, true);
});

test("falls back to HOLD when votes tie or lack a majority", () => {
  const decision = reduceModelVotes([
    { ...baseVote, provider: "model-a", action: "BUY" },
    { ...baseVote, provider: "model-b", action: "SELL" },
    { ...baseVote, provider: "model-c", action: "HOLD" },
  ]);

  assert.equal(decision.action, "HOLD");
  assert.equal(decision.approved, false);
  assert.match(decision.reason, /majority/i);
});

test("invalid model outputs are downgraded and can block quorum", () => {
  const parsed = validateModelVote({
    provider: "model-a",
    action: "BUY",
    confidence: 0.85,
    fairProbability: 0.62,
    sizeUsd: "25",
    reasoning: "No citations should invalidate the trade vote.",
    citations: [],
    riskFlags: [],
  });

  assert.equal(parsed.valid, false);

  const decision = reduceModelVotes([
    parsed.vote,
    { ...baseVote, provider: "model-b", action: "BUY" },
    { ...baseVote, provider: "model-c", action: "HOLD" },
  ]);

  assert.equal(decision.action, "HOLD");
  assert.equal(decision.approved, false);
});
