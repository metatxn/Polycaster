import assert from "node:assert/strict";
import { test } from "vitest";
import {
  addRelevanceAggregateSample,
  parseRelevanceAggregateSample,
  RELEVANCE_AGGREGATE_RETENTION_DAYS,
  type RelevanceAggregateSnapshot,
} from "../../src/relevance-aggregate-telemetry";

test("aggregate telemetry accepts only bounded fields and drops browsing data", () => {
  const sample = parseRelevanceAggregateSample({
    kind: "search",
    source: "network",
    outcome: "success",
    latencyMs: 180,
    candidateCount: 8,
    postText: "private post text",
    query: "private query",
    pageUrl: "https://example.com/private",
    marketId: "private-market-id",
  });

  assert.deepEqual(sample, {
    kind: "search",
    source: "network",
    outcome: "success",
    latencyMs: 180,
    candidateCount: 8,
  });
  assert.equal(JSON.stringify(sample).includes("private"), false);
});

test("aggregate telemetry records fixed counters and latency buckets", () => {
  const now = Date.UTC(2026, 7, 29, 12);
  let snapshot = addRelevanceAggregateSample(
    undefined,
    {
      kind: "search",
      source: "network",
      outcome: "degraded",
      latencyMs: 180,
      candidateCount: 0,
    },
    now
  );

  snapshot = addRelevanceAggregateSample(
    snapshot,
    {
      kind: "pipeline",
      outcome: "validator_rejected",
      scoringMode: "lexical",
      contextMode: "nested_bounded",
      retrievedCandidates: 8,
      gateBlocked: 2,
      gateZeroSignal: 1,
      gateSingleSignal: 1,
      gateLowOverlap: 0,
      gateDisabledSource: 0,
      gateRecovered: 1,
      gateRetryEligible: 2,
      legacyRelaxedShadowEligible: 2,
      thresholdBlocked: 1,
      propositionDateConflicts: 2,
      propositionDirectionConflicts: 1,
      propositionEntityConflicts: 0,
      propositionNumericThresholdConflicts: 1,
      propositionOutcomeConflicts: 0,
      lexicalShadowCompared: 8,
      lexicalShadowHigher: 3,
      lexicalShadowLower: 4,
      lexicalShadowThresholdGained: 1,
      lexicalShadowThresholdLost: 2,
      validatorPassed: 0,
      validatorRejected: 3,
      validatorUnavailable: 2,
      validatorError: 0,
      shownCandidates: 0,
    },
    now
  );

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.days.length, 1);
  const day = snapshot.days[0];
  assert.equal(day.day, "2026-08-29");
  assert.equal(day.search.requests, 1);
  assert.equal(day.search.sources.network, 1);
  assert.equal(day.search.outcomes.degraded, 1);
  assert.equal(day.search.candidateTotal, 0);
  assert.equal(day.search.latencyMs.le_250, 1);
  assert.equal(day.pipeline.posts, 1);
  assert.equal(day.pipeline.outcomes.validator_rejected, 1);
  assert.equal(day.pipeline.scoringModes.lexical, 1);
  assert.equal(day.pipeline.contextModes.nested_bounded, 1);
  assert.equal(
    day.pipeline.contextOutcomes.nested_bounded.validator_rejected,
    1
  );
  assert.equal(day.pipeline.contextOutcomes.title_only.validator_rejected, 0);
  assert.equal(day.pipeline.candidates.retrieved, 8);
  assert.equal(day.pipeline.candidates.gateBlocked, 2);
  assert.equal(day.pipeline.candidates.gateZeroSignal, 1);
  assert.equal(day.pipeline.candidates.gateSingleSignal, 1);
  assert.equal(day.pipeline.candidates.gateLowOverlap, 0);
  assert.equal(day.pipeline.candidates.gateDisabledSource, 0);
  assert.equal(day.pipeline.candidates.gateRecovered, 1);
  assert.equal(day.pipeline.candidates.gateRetryEligible, 2);
  assert.equal(day.pipeline.candidates.legacyRelaxedShadowEligible, 2);
  assert.equal(day.pipeline.candidates.thresholdBlocked, 1);
  assert.equal(day.pipeline.candidates.propositionDateConflicts, 2);
  assert.equal(day.pipeline.candidates.propositionDirectionConflicts, 1);
  assert.equal(day.pipeline.candidates.propositionNumericThresholdConflicts, 1);
  assert.equal(day.pipeline.candidates.lexicalShadowCompared, 8);
  assert.equal(day.pipeline.candidates.lexicalShadowHigher, 3);
  assert.equal(day.pipeline.candidates.lexicalShadowLower, 4);
  assert.equal(day.pipeline.candidates.lexicalShadowThresholdGained, 1);
  assert.equal(day.pipeline.candidates.lexicalShadowThresholdLost, 2);
  assert.equal(day.pipeline.candidates.validatorRejected, 3);
  assert.equal(day.pipeline.candidates.validatorUnavailable, 2);
  assert.equal(day.pipeline.candidates.shown, 0);
});

test("aggregate telemetry keeps only the configured number of UTC day buckets", () => {
  const start = Date.UTC(2026, 7, 1, 12);
  let snapshot: RelevanceAggregateSnapshot | undefined;

  for (let day = 0; day < RELEVANCE_AGGREGATE_RETENTION_DAYS + 3; day++) {
    snapshot = addRelevanceAggregateSample(
      snapshot,
      {
        kind: "search",
        source: "memory_cache",
        outcome: "empty",
        latencyMs: 0,
        candidateCount: 0,
      },
      start + day * 24 * 60 * 60 * 1000
    );
  }

  assert.equal(snapshot?.days.length, RELEVANCE_AGGREGATE_RETENTION_DAYS);
  assert.equal(snapshot?.days[0].day, "2026-08-04");
  assert.equal(
    snapshot?.days.at(-1)?.day,
    `2026-08-${String(RELEVANCE_AGGREGATE_RETENTION_DAYS + 3).padStart(2, "0")}`
  );
});

test("aggregate telemetry rejects malformed or unbounded samples", () => {
  assert.equal(
    parseRelevanceAggregateSample({
      kind: "search",
      source: "network",
      outcome: "success",
      latencyMs: -1,
      candidateCount: 8,
    }),
    null
  );
  assert.equal(
    parseRelevanceAggregateSample({
      kind: "pipeline",
      outcome: "unknown",
      scoringMode: "hybrid",
    }),
    null
  );
  assert.equal(
    parseRelevanceAggregateSample({
      kind: "pipeline",
      outcome: "shown",
      scoringMode: "hybrid",
      contextMode: "unbounded",
      retrievedCandidates: 1,
      gateBlocked: 0,
      gateZeroSignal: 0,
      gateSingleSignal: 0,
      gateLowOverlap: 0,
      gateDisabledSource: 0,
      gateRecovered: 0,
      gateRetryEligible: 0,
      thresholdBlocked: 0,
      validatorPassed: 1,
      validatorRejected: 0,
      validatorUnavailable: 0,
      validatorError: 0,
      shownCandidates: 1,
    }),
    null
  );
});
