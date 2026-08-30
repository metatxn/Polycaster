const LABEL_VALUES = new Set([0, 1, 2]);
const SPLITS = new Set(["train", "validation", "test"]);
const REQUIRED_HARD_NEGATIVE_CLASSES = [
  "same_entity_wrong_date",
  "same_entity_wrong_event",
  "same_entity_wrong_outcome",
  "same_entity_wrong_threshold",
];

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value, path) {
  if (!isRecord(value)) fail(path, "must be an object");
  return value;
}

function requireNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function requireBooleanTrue(value, path) {
  if (value !== true) fail(path, "must be true");
}

function validateMarket(market, path, seenMarketIds, seenRanks) {
  requireRecord(market, path);
  const id = requireNonEmptyString(market.id, `${path}.id`);
  if (seenMarketIds.has(id)) fail(`${path}.id`, `duplicate market id "${id}"`);
  seenMarketIds.add(id);

  requireNonEmptyString(market.text, `${path}.text`);
  if (!Number.isInteger(market.retrievedRank) || market.retrievedRank < 1) {
    fail(`${path}.retrievedRank`, "must be a positive integer");
  }
  if (seenRanks.has(market.retrievedRank)) {
    fail(
      `${path}.retrievedRank`,
      `duplicate retrieved rank ${market.retrievedRank}`
    );
  }
  seenRanks.add(market.retrievedRank);

  if (!Array.isArray(market.labels) || market.labels.length < 2) {
    fail(`${path}.labels`, "must contain at least two independent labels");
  }
  market.labels.forEach((label, index) => {
    if (!LABEL_VALUES.has(label)) {
      fail(`${path}.labels[${index}]`, "must be 0, 1, or 2");
    }
  });
  if (!LABEL_VALUES.has(market.relevance)) {
    fail(`${path}.relevance`, "must be 0, 1, or 2");
  }
}

function validateCase(testCase, path, seenCaseIds) {
  requireRecord(testCase, path);
  const id = requireNonEmptyString(testCase.id, `${path}.id`);
  if (seenCaseIds.has(id)) fail(`${path}.id`, `duplicate case id "${id}"`);
  seenCaseIds.add(id);

  requireNonEmptyString(testCase.postText, `${path}.postText`);
  const snapshotAt = requireNonEmptyString(
    testCase.snapshotAt,
    `${path}.snapshotAt`
  );
  if (Number.isNaN(Date.parse(snapshotAt))) {
    fail(`${path}.snapshotAt`, "must be an ISO date-time string");
  }
  if (!SPLITS.has(testCase.split)) {
    fail(`${path}.split`, "must be train, validation, or test");
  }

  const provenance = requireRecord(testCase.provenance, `${path}.provenance`);
  requireBooleanTrue(
    provenance.consentConfirmed,
    `${path}.provenance.consentConfirmed`
  );
  requireBooleanTrue(provenance.anonymized, `${path}.provenance.anonymized`);

  const strata = requireRecord(testCase.strata, `${path}.strata`);
  for (const key of ["platform", "domain", "postLength", "deviceClass"]) {
    requireNonEmptyString(strata[key], `${path}.strata.${key}`);
  }

  if (
    testCase.hardNegativeClasses !== undefined &&
    !Array.isArray(testCase.hardNegativeClasses)
  ) {
    fail(`${path}.hardNegativeClasses`, "must be an array when provided");
  }
  const hardNegativeClasses = new Set();
  for (const [index, value] of (testCase.hardNegativeClasses ?? []).entries()) {
    const hardNegativeClass = requireNonEmptyString(
      value,
      `${path}.hardNegativeClasses[${index}]`
    );
    if (hardNegativeClasses.has(hardNegativeClass)) {
      fail(
        `${path}.hardNegativeClasses[${index}]`,
        `duplicate class "${hardNegativeClass}"`
      );
    }
    hardNegativeClasses.add(hardNegativeClass);
  }

  if (!Array.isArray(testCase.goldMarketIds)) {
    fail(`${path}.goldMarketIds`, "must be an array");
  }
  const goldMarketIds = new Set();
  testCase.goldMarketIds.forEach((marketId, index) => {
    const value = requireNonEmptyString(
      marketId,
      `${path}.goldMarketIds[${index}]`
    );
    if (goldMarketIds.has(value)) {
      fail(`${path}.goldMarketIds[${index}]`, `duplicate market id "${value}"`);
    }
    goldMarketIds.add(value);
  });

  if (!Array.isArray(testCase.markets) || testCase.markets.length === 0) {
    fail(`${path}.markets`, "must contain at least one candidate market");
  }
  const seenMarketIds = new Set();
  const seenRanks = new Set();
  testCase.markets.forEach((market, index) => {
    validateMarket(
      market,
      `${path}.markets[${index}]`,
      seenMarketIds,
      seenRanks
    );
  });

  if (goldMarketIds.size === 0) {
    const relevantIndex = testCase.markets.findIndex(
      (market) => market.relevance > 0
    );
    if (relevantIndex !== -1) {
      fail(
        `${path}.markets[${relevantIndex}].relevance`,
        "must be 0 for a true no-match case"
      );
    }
  } else {
    const unexpectedRelevantIndex = testCase.markets.findIndex(
      (market) => market.relevance > 0 && !goldMarketIds.has(market.id)
    );
    if (unexpectedRelevantIndex !== -1) {
      fail(
        `${path}.markets[${unexpectedRelevantIndex}].relevance`,
        "relevant candidates must appear in goldMarketIds"
      );
    }
  }
}

export function validateContextEvaluationDataset(value) {
  const dataset = requireRecord(value, "dataset");
  if (dataset.version !== 1) fail("dataset.version", "must be 1");
  if (!Array.isArray(dataset.cases) || dataset.cases.length === 0) {
    fail("dataset.cases", "must contain at least one case");
  }

  const seenCaseIds = new Set();
  dataset.cases.forEach((testCase, index) => {
    validateCase(testCase, `cases[${index}]`, seenCaseIds);
  });
  return dataset;
}

function createIssue(code, message, details) {
  return details === undefined ? { code, message } : { code, message, details };
}

export function assessEvaluationReadiness(value, requirements = {}) {
  const resolvedRequirements = {
    minimumCases: 500,
    maximumCases: 1_000,
    minimumNoMatchShare: 0.3,
    maximumNoMatchShare: 0.4,
    minimumCandidatesPerCase: 20,
    maximumCandidatesPerCase: 100,
    minimumHeldOutShare: 0.1,
    requiredHardNegativeClasses: REQUIRED_HARD_NEGATIVE_CLASSES,
    ...requirements,
  };

  let dataset;
  try {
    dataset = validateContextEvaluationDataset(value);
  } catch (error) {
    return {
      ready: false,
      status: "insufficient_evidence",
      issues: [
        createIssue(
          "invalid_dataset",
          error instanceof Error ? error.message : String(error)
        ),
      ],
      summary: {
        caseCount: Array.isArray(value?.cases) ? value.cases.length : 0,
      },
    };
  }

  const issues = [];
  const caseCount = dataset.cases.length;
  const noMatchCaseCount = dataset.cases.filter(
    (testCase) => testCase.goldMarketIds.length === 0
  ).length;
  const noMatchShare = noMatchCaseCount / caseCount;
  const splitCounts = { test: 0, train: 0, validation: 0 };
  const hardNegativeClasses = new Set();
  const postSplits = new Map();
  let candidateCountViolations = 0;
  let unresolvedDisagreements = 0;

  for (const testCase of dataset.cases) {
    splitCounts[testCase.split]++;
    for (const hardNegativeClass of testCase.hardNegativeClasses ?? []) {
      hardNegativeClasses.add(hardNegativeClass);
    }

    if (
      testCase.markets.length < resolvedRequirements.minimumCandidatesPerCase ||
      testCase.markets.length > resolvedRequirements.maximumCandidatesPerCase
    ) {
      candidateCountViolations++;
    }

    for (const market of testCase.markets) {
      if (new Set(market.labels).size > 1 && market.adjudicated !== true) {
        unresolvedDisagreements++;
      }
    }

    const normalizedPost = testCase.postText
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    const existingSplit = postSplits.get(normalizedPost);
    if (existingSplit && existingSplit !== testCase.split) {
      issues.push(
        createIssue(
          "split_leakage",
          "The same normalized post appears in more than one split",
          { caseId: testCase.id }
        )
      );
    } else {
      postSplits.set(normalizedPost, testCase.split);
    }
  }

  if (
    caseCount < resolvedRequirements.minimumCases ||
    caseCount > resolvedRequirements.maximumCases
  ) {
    issues.push(
      createIssue(
        "case_count",
        `Dataset must contain ${resolvedRequirements.minimumCases} to ${resolvedRequirements.maximumCases} cases`,
        { actual: caseCount }
      )
    );
  }
  if (
    noMatchShare < resolvedRequirements.minimumNoMatchShare ||
    noMatchShare > resolvedRequirements.maximumNoMatchShare
  ) {
    issues.push(
      createIssue(
        "no_match_share",
        `No-match share must be between ${resolvedRequirements.minimumNoMatchShare} and ${resolvedRequirements.maximumNoMatchShare}`,
        { actual: noMatchShare }
      )
    );
  }
  if (candidateCountViolations > 0) {
    issues.push(
      createIssue(
        "candidate_count",
        `Every case must contain ${resolvedRequirements.minimumCandidatesPerCase} to ${resolvedRequirements.maximumCandidatesPerCase} candidates`,
        { violatingCases: candidateCountViolations }
      )
    );
  }
  if (
    splitCounts.train === 0 ||
    splitCounts.validation === 0 ||
    splitCounts.test === 0 ||
    splitCounts.test / caseCount < resolvedRequirements.minimumHeldOutShare
  ) {
    issues.push(
      createIssue(
        "held_out_split",
        "Dataset must contain train, validation, and a sufficient held-out test split",
        { splitCounts }
      )
    );
  }
  if (unresolvedDisagreements > 0) {
    issues.push(
      createIssue(
        "unresolved_labels",
        "Disagreeing independent labels require adjudicated=true",
        { candidates: unresolvedDisagreements }
      )
    );
  }

  const missingHardNegativeClasses =
    resolvedRequirements.requiredHardNegativeClasses.filter(
      (value) => !hardNegativeClasses.has(value)
    );
  if (missingHardNegativeClasses.length > 0) {
    issues.push(
      createIssue(
        "hard_negative_coverage",
        "Dataset is missing required hard-negative classes",
        { missing: missingHardNegativeClasses }
      )
    );
  }

  return {
    ready: issues.length === 0,
    status: issues.length === 0 ? "ready" : "insufficient_evidence",
    issues,
    summary: {
      caseCount,
      matchCaseCount: caseCount - noMatchCaseCount,
      noMatchCaseCount,
      noMatchShare,
      splitCounts,
      hardNegativeClasses: [...hardNegativeClasses].sort(),
    },
  };
}

function buildPromotionResult(readiness, criteria, evidence, checks) {
  if (!readiness.ready) {
    return {
      status: "insufficient_evidence",
      reasons: ["evaluation_dataset_not_ready"],
    };
  }
  if (!isRecord(criteria) || !isRecord(evidence)) {
    return {
      status: "insufficient_evidence",
      reasons: [
        !isRecord(criteria)
          ? "acceptance_criteria_missing"
          : "evaluation_metrics_missing",
      ],
    };
  }

  const results = [];
  for (const check of checks) {
    const value = evidence[check.metric];
    const threshold = criteria[check.criterion];
    if (!Number.isFinite(value) || !Number.isFinite(threshold)) {
      return {
        status: "insufficient_evidence",
        reasons: [`${check.metric}_missing`],
      };
    }
    results.push({
      metric: check.metric,
      value,
      threshold,
      operator: check.operator,
      passed: check.operator === ">=" ? value >= threshold : value <= threshold,
    });
  }

  return {
    status: results.every((result) => result.passed) ? "passed" : "failed",
    checks: results,
  };
}

export function assessPromotionReadiness(value, options = {}) {
  const readiness = assessEvaluationReadiness(value, options.requirements);
  return {
    dataset: readiness,
    thresholdFloor: buildPromotionResult(
      readiness,
      options.criteria?.thresholdFloor,
      options.evidence?.thresholdFloor,
      [
        {
          metric: "precisionAt1",
          criterion: "minimumPrecisionAt1",
          operator: ">=",
        },
        {
          metric: "noMatchRejectionAccuracy",
          criterion: "minimumNoMatchRejectionAccuracy",
          operator: ">=",
        },
        {
          metric: "lexicalFalsePositiveRate",
          criterion: "maximumLexicalFalsePositiveRate",
          operator: "<=",
        },
        {
          metric: "heuristicFalsePositiveRate",
          criterion: "maximumHeuristicFalsePositiveRate",
          operator: "<=",
        },
      ]
    ),
    productionReranker: buildPromotionResult(
      readiness,
      options.criteria?.productionReranker,
      options.evidence?.productionReranker,
      [
        {
          metric: "precisionAt1",
          criterion: "minimumPrecisionAt1",
          operator: ">=",
        },
        {
          metric: "ndcgAt3",
          criterion: "minimumNdcgAt3",
          operator: ">=",
        },
        {
          metric: "p95LatencyMs",
          criterion: "maximumP95LatencyMs",
          operator: "<=",
        },
        {
          metric: "failureRate",
          criterion: "maximumFailureRate",
          operator: "<=",
        },
        {
          metric: "downloadBytes",
          criterion: "maximumDownloadBytes",
          operator: "<=",
        },
      ]
    ),
  };
}

function dcg(relevances) {
  return relevances.reduce((total, relevance, index) => {
    return total + (2 ** relevance - 1) / Math.log2(index + 2);
  }, 0);
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function createPredictionMap(dataset, predictions) {
  if (!Array.isArray(predictions)) fail("predictions", "must be an array");
  const casesById = new Map(
    dataset.cases.map((testCase) => [testCase.id, testCase])
  );
  const predictionMap = new Map();

  predictions.forEach((prediction, index) => {
    const path = `predictions[${index}]`;
    requireRecord(prediction, path);
    const caseId = requireNonEmptyString(prediction.caseId, `${path}.caseId`);
    const testCase = casesById.get(caseId);
    if (!testCase) fail(`${path}.caseId`, `unknown case id "${caseId}"`);
    if (predictionMap.has(caseId)) {
      fail(`${path}.caseId`, `duplicate prediction for "${caseId}"`);
    }
    if (!Array.isArray(prediction.rankedMarketIds)) {
      fail(`${path}.rankedMarketIds`, "must be an array");
    }

    const candidateIds = new Set(testCase.markets.map((market) => market.id));
    const rankedIds = new Set();
    prediction.rankedMarketIds.forEach((marketId, rankIndex) => {
      const id = requireNonEmptyString(
        marketId,
        `${path}.rankedMarketIds[${rankIndex}]`
      );
      if (!candidateIds.has(id)) {
        fail(
          `${path}.rankedMarketIds[${rankIndex}]`,
          `unknown market id "${id}"`
        );
      }
      if (rankedIds.has(id)) {
        fail(
          `${path}.rankedMarketIds[${rankIndex}]`,
          `duplicate market id "${id}"`
        );
      }
      rankedIds.add(id);
    });

    if (
      prediction.selectedMarketId !== null &&
      prediction.selectedMarketId !== undefined &&
      !candidateIds.has(prediction.selectedMarketId)
    ) {
      fail(
        `${path}.selectedMarketId`,
        "must name a candidate market or be null"
      );
    }

    predictionMap.set(caseId, {
      caseId,
      rankedMarketIds: prediction.rankedMarketIds,
      selectedMarketId: prediction.selectedMarketId ?? null,
    });
  });

  dataset.cases.forEach((testCase) => {
    if (!predictionMap.has(testCase.id)) {
      fail("predictions", `missing prediction for case "${testCase.id}"`);
    }
  });
  return predictionMap;
}

function evaluateCase(testCase, prediction) {
  const marketsById = new Map(
    testCase.markets.map((market) => [market.id, market])
  );
  const rankedMarkets = prediction.rankedMarketIds.map((id) =>
    marketsById.get(id)
  );
  const isMatchCase = testCase.goldMarketIds.length > 0;

  const retrievalRecallAt = (limit) => {
    if (!isMatchCase) return null;
    const retrievedGold = testCase.goldMarketIds.filter((goldId) => {
      const market = marketsById.get(goldId);
      return market && market.retrievedRank <= limit;
    }).length;
    return retrievedGold / testCase.goldMarketIds.length;
  };

  const firstRelevantIndex = rankedMarkets.findIndex(
    (market) => market.relevance > 0
  );
  const idealRelevances = testCase.markets
    .map((market) => market.relevance)
    .sort((a, b) => b - a)
    .slice(0, 10);
  const idealDcg = dcg(idealRelevances);
  const selectedMarket = prediction.selectedMarketId
    ? marketsById.get(prediction.selectedMarketId)
    : null;

  return {
    caseId: testCase.id,
    isMatchCase,
    recallAt20: retrievalRecallAt(20),
    recallAt50: retrievalRecallAt(50),
    reciprocalRank:
      isMatchCase && firstRelevantIndex !== -1
        ? 1 / (firstRelevantIndex + 1)
        : isMatchCase
          ? 0
          : null,
    ndcgAt10:
      !isMatchCase || idealDcg === 0
        ? isMatchCase
          ? 0
          : null
        : dcg(rankedMarkets.slice(0, 10).map((market) => market.relevance)) /
          idealDcg,
    precisionAt1:
      isMatchCase && rankedMarkets.length > 0
        ? rankedMarkets[0].relevance > 0
          ? 1
          : 0
        : isMatchCase
          ? 0
          : null,
    selected: selectedMarket !== null,
    selectedRelevant: selectedMarket ? selectedMarket.relevance > 0 : false,
    selectedDirect: selectedMarket ? selectedMarket.relevance === 2 : false,
    noMatchRejected: !isMatchCase ? prediction.selectedMarketId === null : null,
  };
}

function summarizeCases(cases, predictionMap) {
  const results = cases.map((testCase) =>
    evaluateCase(testCase, predictionMap.get(testCase.id))
  );
  const matchResults = results.filter((result) => result.isMatchCase);
  const noMatchResults = results.filter((result) => !result.isMatchCase);
  const selectedResults = results.filter((result) => result.selected);

  return {
    caseCount: results.length,
    matchCaseCount: matchResults.length,
    noMatchCaseCount: noMatchResults.length,
    recallAt20: mean(matchResults.map((result) => result.recallAt20)),
    recallAt50: mean(matchResults.map((result) => result.recallAt50)),
    mrr: mean(matchResults.map((result) => result.reciprocalRank)),
    ndcgAt10: mean(matchResults.map((result) => result.ndcgAt10)),
    precisionAt1: mean(matchResults.map((result) => result.precisionAt1)),
    selectedRelevantPrecision: mean(
      selectedResults.map((result) => (result.selectedRelevant ? 1 : 0))
    ),
    selectedDirectPrecision: mean(
      selectedResults.map((result) => (result.selectedDirect ? 1 : 0))
    ),
    noMatchRejectionAccuracy: mean(
      noMatchResults.map((result) => (result.noMatchRejected ? 1 : 0))
    ),
    injectionCoverage: mean(results.map((result) => (result.selected ? 1 : 0))),
  };
}

function summarizeByStratum(dataset, predictionMap) {
  const output = {};
  for (const key of ["platform", "domain", "postLength", "deviceClass"]) {
    const groups = {};
    const values = new Set(
      dataset.cases.map((testCase) => testCase.strata[key])
    );
    for (const value of values) {
      groups[value] = summarizeCases(
        dataset.cases.filter((testCase) => testCase.strata[key] === value),
        predictionMap
      );
    }
    output[key] = groups;
  }
  return output;
}

export function evaluateContextMatching(value, predictions) {
  const dataset = validateContextEvaluationDataset(value);
  const predictionMap = createPredictionMap(dataset, predictions);
  return {
    version: 1,
    overall: summarizeCases(dataset.cases, predictionMap),
    byStratum: summarizeByStratum(dataset, predictionMap),
  };
}
