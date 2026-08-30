import assert from "node:assert/strict";
import { test } from "vitest";
import {
  BUNDLED_CONTEXT_PROMOTION,
  type ContextPromotionRecord,
  canUseProductionReranker,
} from "../src/context-promotion";
import { CONTEXT_MODEL_MANIFEST } from "../src/model-manifest";

function passingRecord(
  overrides: Partial<ContextPromotionRecord> = {}
): ContextPromotionRecord {
  return {
    schemaVersion: 1,
    evaluatedAt: "2026-08-29T00:00:00.000Z",
    manifestVersion: CONTEXT_MODEL_MANIFEST.manifestVersion,
    rerankerRevision: CONTEXT_MODEL_MANIFEST.reranker.revision,
    productionReranker: { status: "passed" },
    ...overrides,
  };
}

test("bundled evidence keeps production reranking locked", () => {
  assert.equal(
    BUNDLED_CONTEXT_PROMOTION.productionReranker.status,
    "insufficient_evidence"
  );
  assert.equal(canUseProductionReranker(), false);
});

test("production reranking requires a passing compatible promotion record", () => {
  assert.equal(canUseProductionReranker(passingRecord()), true);
  assert.equal(
    canUseProductionReranker(
      passingRecord({ manifestVersion: "different-model-manifest" })
    ),
    false
  );
  assert.equal(
    canUseProductionReranker(
      passingRecord({ rerankerRevision: "0".repeat(40) })
    ),
    false
  );
  assert.equal(
    canUseProductionReranker(
      passingRecord({ productionReranker: { status: "failed" } })
    ),
    false
  );
});
