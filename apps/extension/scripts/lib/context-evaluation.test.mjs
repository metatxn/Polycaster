import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessEvaluationReadiness,
  assessPromotionReadiness,
  evaluateContextMatching,
  validateContextEvaluationDataset,
} from "./context-evaluation.mjs";

function createCase(overrides = {}) {
  return {
    id: "case-1",
    postText: "OpenAI announced a new model release.",
    snapshotAt: "2026-08-29T10:00:00.000Z",
    split: "test",
    provenance: {
      consentConfirmed: true,
      anonymized: true,
    },
    strata: {
      platform: "linkedin",
      domain: "science-tech",
      postLength: "short",
      deviceClass: "mid",
    },
    goldMarketIds: ["openai-release"],
    markets: [
      {
        id: "openai-release",
        text: "Will OpenAI release a new model this month?",
        retrievedRank: 1,
        labels: [2, 2],
        relevance: 2,
      },
      {
        id: "anthropic-release",
        text: "Will Anthropic release Claude 5 this month?",
        retrievedRank: 2,
        labels: [0, 0],
        relevance: 0,
      },
    ],
    ...overrides,
  };
}

function createReadyDataset() {
  const requiredHardNegatives = [
    "same_entity_wrong_date",
    "same_entity_wrong_event",
    "same_entity_wrong_outcome",
    "same_entity_wrong_threshold",
  ];
  const cases = [];
  for (let index = 0; index < 500; index++) {
    const noMatch = index < 175;
    const markets = Array.from({ length: 20 }, (_, marketIndex) => {
      const direct = !noMatch && marketIndex === 0;
      return {
        id: `market-${index}-${marketIndex}`,
        text: `Candidate market ${index} ${marketIndex}`,
        retrievedRank: marketIndex + 1,
        labels: direct ? [2, 2] : [0, 0],
        relevance: direct ? 2 : 0,
      };
    });
    cases.push(
      createCase({
        id: `case-${index}`,
        postText: `Anonymized production post ${index}`,
        split:
          index % 10 === 0 ? "test" : index % 5 === 0 ? "validation" : "train",
        goldMarketIds: noMatch ? [] : [markets[0].id],
        markets,
        hardNegativeClasses:
          index < requiredHardNegatives.length
            ? [requiredHardNegatives[index]]
            : [],
      })
    );
  }
  return { version: 1, cases };
}

test("evaluation dataset accepts a true no-match case", () => {
  const noMatch = createCase({
    id: "no-match",
    goldMarketIds: [],
    markets: [
      {
        id: "unrelated-1",
        text: "Will Bitcoin trade above $100,000?",
        retrievedRank: 1,
        labels: [0, 0],
        relevance: 0,
      },
      {
        id: "unrelated-2",
        text: "Will the Fed cut rates?",
        retrievedRank: 2,
        labels: [0, 0],
        relevance: 0,
      },
    ],
  });

  const dataset = validateContextEvaluationDataset({
    version: 1,
    cases: [noMatch],
  });

  assert.equal(dataset.cases[0].goldMarketIds.length, 0);
  assert.ok(dataset.cases[0].markets.every((market) => market.relevance === 0));
});

test("evaluation dataset reports precise validation paths", () => {
  const invalidCases = [
    {
      value: createCase({ snapshotAt: "" }),
      message: "cases[0].snapshotAt",
    },
    {
      value: createCase({
        provenance: { consentConfirmed: false, anonymized: true },
      }),
      message: "cases[0].provenance.consentConfirmed",
    },
    {
      value: createCase({
        markets: [
          {
            id: "bad-label",
            text: "Bad label",
            retrievedRank: 1,
            labels: [2, 3],
            relevance: 2,
          },
        ],
      }),
      message: "cases[0].markets[0].labels[1]",
    },
  ];

  for (const invalid of invalidCases) {
    assert.throws(
      () =>
        validateContextEvaluationDataset({
          version: 1,
          cases: [invalid.value],
        }),
      (error) => {
        assert.ok(error.message.includes(invalid.message));
        return true;
      }
    );
  }

  assert.throws(
    () =>
      validateContextEvaluationDataset({
        version: 1,
        cases: [createCase(), createCase()],
      }),
    /cases\[1\]\.id.*duplicate/i
  );
});

test("evaluation metrics separate ranking quality from no-match rejection", () => {
  const match = createCase();
  const noMatch = createCase({
    id: "case-2",
    postText: "A personal update with no prediction market claim.",
    goldMarketIds: [],
    markets: [
      {
        id: "unrelated",
        text: "Will Bitcoin trade above $100,000?",
        retrievedRank: 1,
        labels: [0, 0],
        relevance: 0,
      },
    ],
  });
  const dataset = validateContextEvaluationDataset({
    version: 1,
    cases: [match, noMatch],
  });

  const result = evaluateContextMatching(dataset, [
    {
      caseId: "case-1",
      rankedMarketIds: ["anthropic-release", "openai-release"],
      selectedMarketId: "openai-release",
    },
    {
      caseId: "case-2",
      rankedMarketIds: ["unrelated"],
      selectedMarketId: null,
    },
  ]);

  assert.equal(result.overall.caseCount, 2);
  assert.equal(result.overall.matchCaseCount, 1);
  assert.equal(result.overall.noMatchCaseCount, 1);
  assert.equal(result.overall.recallAt20, 1);
  assert.equal(result.overall.recallAt50, 1);
  assert.equal(result.overall.mrr, 0.5);
  assert.ok(Math.abs(result.overall.ndcgAt10 - 0.6309297536) < 1e-9);
  assert.equal(result.overall.precisionAt1, 0);
  assert.equal(result.overall.selectedDirectPrecision, 1);
  assert.equal(result.overall.noMatchRejectionAccuracy, 1);
  assert.equal(result.overall.injectionCoverage, 0.5);
  assert.equal(result.byStratum.platform.linkedin.caseCount, 2);
});

test("evaluation readiness rejects the saturated legacy benchmark", async () => {
  const { readFile } = await import("node:fs/promises");
  const legacy = JSON.parse(
    await readFile(
      new URL("../../perf-fixtures/embedding-ab.json", import.meta.url),
      "utf8"
    )
  );

  const result = assessEvaluationReadiness(legacy);

  assert.equal(result.ready, false);
  assert.equal(result.status, "insufficient_evidence");
  assert.ok(result.issues.some((issue) => issue.code === "invalid_dataset"));
});

test("evaluation readiness enforces size, no-match, split, and hard-negative coverage", () => {
  const ready = assessEvaluationReadiness(createReadyDataset());

  assert.equal(ready.ready, true);
  assert.equal(ready.summary.caseCount, 500);
  assert.equal(ready.summary.noMatchShare, 0.35);
  assert.deepEqual(ready.summary.splitCounts, {
    test: 50,
    train: 400,
    validation: 50,
  });

  const undersized = assessEvaluationReadiness({
    version: 1,
    cases: createReadyDataset().cases.slice(0, 20),
  });
  assert.equal(undersized.ready, false);
  assert.ok(undersized.issues.some((issue) => issue.code === "case_count"));
});

test("promotion gates stay blocked without evidence and pass only against explicit criteria", () => {
  const dataset = createReadyDataset();
  const blocked = assessPromotionReadiness(dataset);

  assert.equal(blocked.thresholdFloor.status, "insufficient_evidence");
  assert.equal(blocked.productionReranker.status, "insufficient_evidence");

  const assessed = assessPromotionReadiness(dataset, {
    criteria: {
      thresholdFloor: {
        minimumPrecisionAt1: 0.9,
        minimumNoMatchRejectionAccuracy: 0.9,
        maximumLexicalFalsePositiveRate: 0.05,
        maximumHeuristicFalsePositiveRate: 0.05,
      },
      productionReranker: {
        minimumPrecisionAt1: 0.9,
        minimumNdcgAt3: 0.85,
        maximumP95LatencyMs: 250,
        maximumFailureRate: 0.01,
        maximumDownloadBytes: 30_000_000,
      },
    },
    evidence: {
      thresholdFloor: {
        precisionAt1: 0.93,
        noMatchRejectionAccuracy: 0.95,
        lexicalFalsePositiveRate: 0.03,
        heuristicFalsePositiveRate: 0.04,
      },
      productionReranker: {
        precisionAt1: 0.94,
        ndcgAt3: 0.88,
        p95LatencyMs: 210,
        failureRate: 0.005,
        downloadBytes: 24_000_000,
      },
    },
  });

  assert.equal(assessed.thresholdFloor.status, "passed");
  assert.equal(assessed.productionReranker.status, "passed");
});
