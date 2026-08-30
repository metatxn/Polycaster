import assert from "node:assert/strict";
import test from "node:test";
import { fitContextCalibration } from "./context-calibration.mjs";

const metadata = {
  artifactVersion: "calibration-test-v1",
  fittedAt: "2026-08-29T00:00:00.000Z",
  manifestVersion: "context-models-v1",
  documentSchemaVersion: "context-documents-v1",
  rerankerRevision: "a".repeat(40),
};

test("calibration fitting rejects held-out test rows", () => {
  assert.throws(
    () =>
      fitContextCalibration(
        [{ id: "held-out", split: "test", label: 2, score: 0.9 }],
        metadata
      ),
    /rows\[0\]\.split: must be validation/
  );
});

test("calibration fitting emits a versioned validation-only artifact", () => {
  const artifact = fitContextCalibration(
    [
      {
        id: "direct",
        split: "validation",
        label: 2,
        score: 0.88,
        rerankScore: 4.2,
      },
      {
        id: "adjacent",
        split: "validation",
        label: 1,
        score: 0.67,
        rerankScore: 3.6,
      },
      {
        id: "negative",
        split: "validation",
        label: 0,
        score: 0.31,
        rerankScore: -1,
      },
    ],
    metadata
  );

  assert.equal(artifact.fittedSplit, "validation");
  assert.equal(artifact.manifestVersion, metadata.manifestVersion);
  assert.equal(artifact.documentSchemaVersion, metadata.documentSchemaVersion);
  assert.ok(artifact.thresholds.directMatch > artifact.thresholds.adjacent);
  assert.equal(artifact.trainingSummary.rows, 3);
  assert.equal("caseIds" in artifact.trainingSummary, false);
});

test("calibration fitting optimizes ordered thresholds when score classes overlap", () => {
  const artifact = fitContextCalibration(
    [
      { split: "validation", label: 2, score: 0.82, rerankScore: 2 },
      { split: "validation", label: 2, score: 0.68, rerankScore: 0.5 },
      { split: "validation", label: 1, score: 0.72, rerankScore: 1.5 },
      { split: "validation", label: 1, score: 0.55, rerankScore: 0.2 },
      { split: "validation", label: 0, score: 0.6, rerankScore: 0.8 },
      { split: "validation", label: 0, score: 0.4, rerankScore: -1 },
    ],
    metadata
  );

  assert.ok(artifact.thresholds.directMatch > artifact.thresholds.adjacent);
  assert.equal(artifact.trainingSummary.objective, "balanced_accuracy");
  assert.ok(artifact.trainingSummary.balancedAccuracy > 0.5);
  assert.ok(artifact.trainingSummary.balancedAccuracy <= 1);
  assert.ok(artifact.trainingSummary.rerankBalancedAccuracy >= 0.5);
});
