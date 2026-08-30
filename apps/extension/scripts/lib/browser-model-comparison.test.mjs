import assert from "node:assert/strict";
import test from "node:test";
import {
  assessModelPackPromotion,
  BROWSER_MODEL_CANDIDATES,
  validateModelComparisonResults,
} from "./browser-model-comparison.mjs";

test("browser model candidates pin revisions and verified ONNX artifacts", () => {
  assert.ok(BROWSER_MODEL_CANDIDATES.length >= 5);
  for (const candidate of BROWSER_MODEL_CANDIDATES) {
    assert.match(candidate.revision, /^[0-9a-f]{40}$/);
    assert.match(candidate.artifact.sha256, /^[0-9a-f]{64}$/);
    assert.ok(candidate.artifact.bytes > 0);
    assert.match(candidate.artifact.path, /\.onnx$/);
  }
});

function result(id, overrides = {}) {
  return {
    id,
    datasetId: "held-out-v1",
    split: "test",
    caseIdsHash: "a".repeat(64),
    quality: {
      precisionAt1: 0.9,
      noMatchRejectionAccuracy: 0.9,
      ndcgAt10: 0.86,
    },
    latency: { coldStartMs: 1_500, warmP50Ms: 80, warmP95Ms: 140 },
    resources: { coldBytes: 60_000_000, peakMemoryBytes: 180_000_000 },
    reliability: { attempts: 100, failures: 1, failureRate: 0.01 },
    cache: { secondLoadHit: true },
    ...overrides,
  };
}

test("comparison rejects results that do not use the same held-out cases", () => {
  const checked = validateModelComparisonResults([
    result("baseline"),
    result("candidate", { caseIdsHash: "b".repeat(64) }),
  ]);

  assert.equal(checked.valid, false);
  assert.ok(checked.issues.includes("case_ids_hash_mismatch"));
});

test("promotion stays blocked without criteria and separates every decision dimension", () => {
  const baseline = result("baseline");
  const candidate = result("candidate", {
    quality: {
      precisionAt1: 0.93,
      noMatchRejectionAccuracy: 0.94,
      ndcgAt10: 0.89,
    },
    latency: { coldStartMs: 1_700, warmP50Ms: 85, warmP95Ms: 160 },
    resources: { coldBytes: 70_000_000, peakMemoryBytes: 190_000_000 },
    reliability: { attempts: 100, failures: 0, failureRate: 0 },
  });

  assert.equal(
    assessModelPackPromotion(baseline, candidate).status,
    "insufficient_evidence"
  );

  const assessed = assessModelPackPromotion(baseline, candidate, {
    minimumPrecisionAt1Gain: 0.02,
    minimumNoMatchAccuracyGain: 0.02,
    minimumNdcgAt10Gain: 0.02,
    maximumWarmP95Ms: 200,
    maximumColdBytes: 80_000_000,
    maximumPeakMemoryBytes: 220_000_000,
    maximumFailureRate: 0.01,
  });

  assert.equal(assessed.status, "passed");
  assert.deepEqual(Object.keys(assessed.dimensions), [
    "quality",
    "latency",
    "resources",
    "reliability",
  ]);
});
