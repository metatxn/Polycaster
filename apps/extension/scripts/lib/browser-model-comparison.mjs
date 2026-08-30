export const BROWSER_MODEL_CANDIDATES = [
  {
    id: "arctic-s-int8",
    role: "embedding",
    model: "Snowflake/snowflake-arctic-embed-s",
    revision: "e596f507467533e48a2e17c007f0e1dacc837b33",
    dtype: "int8",
    artifact: {
      path: "onnx/model_int8.onnx",
      bytes: 34_015_111,
      sha256:
        "f93ff225320628d2e88baf2a395cae791b0e3b27edf5c70bf7b312a4d3260c14",
    },
    compatibility: { transformersJsDeclared: true, onnxLayout: "standard" },
  },
  {
    id: "minilm-l6-q8",
    role: "reranker",
    model: "Xenova/ms-marco-MiniLM-L-6-v2",
    revision: "a09144355adeed5f58c8ed011d209bf8ee5a1fec",
    dtype: "q8",
    artifact: {
      path: "onnx/model_quantized.onnx",
      bytes: 23_143_499,
      sha256:
        "e9d8ebf845c413e981c175bfe49a3bfa9b3dcce2a3ba54875ee5df5a58639fbe",
    },
    compatibility: { transformersJsDeclared: true, onnxLayout: "standard" },
  },
  {
    id: "arctic-m-v1.5-int8",
    role: "embedding",
    model: "Snowflake/snowflake-arctic-embed-m-v1.5",
    revision: "e58a8f756156a1293d763f17e3aae643474e9b8a",
    dtype: "int8",
    artifact: {
      path: "onnx/model_int8.onnx",
      bytes: 110_145_162,
      sha256:
        "a18f437b2466863901a0bdc14904cf93246f5ecce0b656fc773bc2b7b2f84f6e",
    },
    compatibility: { transformersJsDeclared: true, onnxLayout: "standard" },
  },
  {
    id: "jina-reranker-v1-tiny-int8",
    role: "reranker",
    model: "jinaai/jina-reranker-v1-tiny-en",
    revision: "aca45de6945b5dc6399abcd2a9c55ded5dc9111f",
    dtype: "int8",
    artifact: {
      path: "onnx/model_int8.onnx",
      bytes: 33_424_854,
      sha256:
        "5fa8508528828b4ad9bc97c97b6e020984e3b745fbcb53f0a907e68704f8a18a",
    },
    compatibility: { transformersJsDeclared: true, onnxLayout: "standard" },
  },
  {
    id: "mixedbread-rerank-xsmall-q8",
    role: "reranker",
    model: "mixedbread-ai/mxbai-rerank-xsmall-v1",
    revision: "b5c6e9da73abc3711f593f705371cdbe9e0fe422",
    dtype: "q8",
    artifact: {
      path: "onnx/model_quantized.onnx",
      bytes: 87_245_802,
      sha256:
        "15ef19a6de90be7d52b627f2c784107bd806e64826450f41fb75fa4f0179ab30",
    },
    compatibility: { transformersJsDeclared: true, onnxLayout: "standard" },
  },
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateModelComparisonResults(results) {
  const issues = [];
  if (!Array.isArray(results) || results.length < 2) {
    return { valid: false, issues: ["at_least_two_results_required"] };
  }

  const reference = results[0];
  for (const result of results) {
    if (!isRecord(result)) {
      issues.push("invalid_result");
      continue;
    }
    if (result.split !== "test") issues.push("held_out_test_split_required");
    if (result.datasetId !== reference.datasetId) {
      issues.push("dataset_id_mismatch");
    }
    if (result.caseIdsHash !== reference.caseIdsHash) {
      issues.push("case_ids_hash_mismatch");
    }
    if (!/^[0-9a-f]{64}$/.test(result.caseIdsHash ?? "")) {
      issues.push("invalid_case_ids_hash");
    }
    for (const dimension of [
      "quality",
      "latency",
      "resources",
      "reliability",
      "cache",
    ]) {
      if (!isRecord(result[dimension])) {
        issues.push(`${dimension}_missing`);
      }
    }
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function assessModelPackPromotion(baseline, candidate, criteria) {
  const validation = validateModelComparisonResults([baseline, candidate]);
  if (!validation.valid || !isRecord(criteria)) {
    return {
      status: "insufficient_evidence",
      reasons: validation.valid
        ? ["promotion_criteria_missing"]
        : validation.issues,
    };
  }

  const dimensions = {
    quality: {
      precisionAt1Gain:
        candidate.quality.precisionAt1 - baseline.quality.precisionAt1,
      noMatchAccuracyGain:
        candidate.quality.noMatchRejectionAccuracy -
        baseline.quality.noMatchRejectionAccuracy,
      ndcgAt10Gain: candidate.quality.ndcgAt10 - baseline.quality.ndcgAt10,
    },
    latency: { warmP95Ms: candidate.latency.warmP95Ms },
    resources: {
      coldBytes: candidate.resources.coldBytes,
      peakMemoryBytes: candidate.resources.peakMemoryBytes,
    },
    reliability: { failureRate: candidate.reliability.failureRate },
  };
  const checks = [
    dimensions.quality.precisionAt1Gain >= criteria.minimumPrecisionAt1Gain,
    dimensions.quality.noMatchAccuracyGain >=
      criteria.minimumNoMatchAccuracyGain,
    dimensions.quality.ndcgAt10Gain >= criteria.minimumNdcgAt10Gain,
    dimensions.latency.warmP95Ms <= criteria.maximumWarmP95Ms,
    dimensions.resources.coldBytes <= criteria.maximumColdBytes,
    dimensions.resources.peakMemoryBytes <= criteria.maximumPeakMemoryBytes,
    dimensions.reliability.failureRate <= criteria.maximumFailureRate,
  ];

  return {
    status: checks.every(Boolean) ? "passed" : "failed",
    dimensions,
    checks,
  };
}
