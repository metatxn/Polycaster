import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildEmbeddingCacheNamespace,
  CONTEXT_MODEL_MANIFEST,
} from "../src/model-manifest";

test("context model manifest pins immutable Hugging Face revisions", () => {
  assert.match(CONTEXT_MODEL_MANIFEST.embedding.revision, /^[0-9a-f]{40}$/);
  assert.match(CONTEXT_MODEL_MANIFEST.reranker.revision, /^[0-9a-f]{40}$/);
  assert.equal(
    CONTEXT_MODEL_MANIFEST.embedding.artifact.path,
    "onnx/model_int8.onnx"
  );
  assert.equal(
    CONTEXT_MODEL_MANIFEST.embedding.artifact.sha256,
    "f93ff225320628d2e88baf2a395cae791b0e3b27edf5c70bf7b312a4d3260c14"
  );
  assert.equal(
    CONTEXT_MODEL_MANIFEST.reranker.artifact.path,
    "onnx/model_quantized.onnx"
  );
  assert.equal(
    CONTEXT_MODEL_MANIFEST.reranker.artifact.sha256,
    "e9d8ebf845c413e981c175bfe49a3bfa9b3dcce2a3ba54875ee5df5a58639fbe"
  );
});

test("embedding cache namespace changes for every vector-affecting setting", () => {
  const base = CONTEXT_MODEL_MANIFEST.embedding;
  const baseline = buildEmbeddingCacheNamespace(base);
  const variants = [
    { ...base, revision: "0".repeat(40) },
    { ...base, dtype: "q8" },
    { ...base, pooling: "mean" },
    { ...base, queryPrefixVersion: "search-v2" },
  ];

  assert.equal(new Set(variants.map(buildEmbeddingCacheNamespace)).size, 4);
  for (const variant of variants) {
    assert.notEqual(buildEmbeddingCacheNamespace(variant), baseline);
  }
  assert.match(baseline, /^[a-zA-Z0-9.-]+$/);
});
