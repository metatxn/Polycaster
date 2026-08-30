import assert from "node:assert/strict";
import { test } from "vitest";
import { CONTEXT_DOCUMENT_SCHEMA_VERSION } from "../src/content/context-documents";
import {
  BUNDLED_CONTEXT_CALIBRATION,
  type ContextCalibrationArtifact,
  classifyContextCandidate,
  hasActiveContextCalibration,
  validateContextCalibrationArtifact,
} from "../src/context-calibration";
import { CONTEXT_MODEL_MANIFEST } from "../src/model-manifest";

function validArtifact(
  overrides: Partial<ContextCalibrationArtifact> = {}
): ContextCalibrationArtifact {
  return {
    schemaVersion: 1,
    artifactVersion: "calibration-2026-08-29",
    fittedAt: "2026-08-29T00:00:00.000Z",
    fittedSplit: "validation",
    manifestVersion: CONTEXT_MODEL_MANIFEST.manifestVersion,
    documentSchemaVersion: CONTEXT_DOCUMENT_SCHEMA_VERSION,
    rerankerRevision: CONTEXT_MODEL_MANIFEST.reranker.revision,
    thresholds: {
      directMatch: 0.82,
      adjacent: 0.61,
      rerankRecovery: 3.5,
    },
    ...overrides,
  };
}

test("runtime accepts only a validation-fitted artifact with matching versions", () => {
  assert.deepEqual(validateContextCalibrationArtifact(validArtifact()), {
    valid: true,
    issues: [],
  });
  assert.equal(
    validateContextCalibrationArtifact(
      validArtifact({ fittedSplit: "test" as "validation" })
    ).valid,
    false
  );
  assert.equal(
    validateContextCalibrationArtifact(
      validArtifact({ manifestVersion: "other-manifest" })
    ).valid,
    false
  );
  assert.equal(
    validateContextCalibrationArtifact(
      validArtifact({ documentSchemaVersion: "other-documents" })
    ).valid,
    false
  );
});

test("calibrated classification distinguishes direct, adjacent, and no match", () => {
  const artifact = validArtifact();

  assert.equal(
    classifyContextCandidate(0.9, artifact).classification,
    "direct_match"
  );
  assert.equal(
    classifyContextCandidate(0.7, artifact).classification,
    "adjacent"
  );
  assert.equal(
    classifyContextCandidate(0.3, artifact).classification,
    "no_match"
  );
});

test("missing bundled calibration preserves the conservative fallback", () => {
  const result = classifyContextCandidate(0.99, BUNDLED_CONTEXT_CALIBRATION);

  assert.equal(result.classification, null);
  assert.equal(result.reason, "conservative_fallback");
  assert.equal(hasActiveContextCalibration(), false);
});

test("only a valid matching artifact activates calibrated decisions", () => {
  assert.equal(hasActiveContextCalibration(validArtifact()), true);
  assert.equal(
    hasActiveContextCalibration(
      validArtifact({ documentSchemaVersion: "different-schema" })
    ),
    false
  );
});
