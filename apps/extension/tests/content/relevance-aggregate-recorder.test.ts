import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildRelevanceMemoryCacheAggregateSample,
  buildRelevancePipelineAggregateSample,
  buildRelevanceSearchAggregateSample,
  compareLexicalShadowScores,
  recordRelevanceAggregate,
} from "../../src/content/relevance-aggregate-recorder";

test("aggregate recorder sends only the sanitized sample", () => {
  const messages: unknown[] = [];
  const runtime = {
    sendMessage(message: unknown, callback?: () => void) {
      messages.push(message);
      callback?.();
    },
  };

  recordRelevanceAggregate(
    {
      kind: "search",
      source: "network",
      outcome: "success",
      latencyMs: 120,
      candidateCount: 8,
      query: "private query",
      pageUrl: "https://example.com/private",
    },
    runtime
  );

  assert.deepEqual(messages, [
    {
      type: "relevance-aggregate:record",
      sample: {
        kind: "search",
        source: "network",
        outcome: "success",
        latencyMs: 120,
        candidateCount: 8,
      },
    },
  ]);
  assert.equal(JSON.stringify(messages).includes("private"), false);
});

test("aggregate recorder drops malformed samples", () => {
  const messages: unknown[] = [];
  const runtime = {
    sendMessage(message: unknown) {
      messages.push(message);
    },
  };

  recordRelevanceAggregate(
    {
      kind: "search",
      source: "network",
      outcome: "success",
      latencyMs: -1,
      candidateCount: 8,
    },
    runtime
  );

  assert.deepEqual(messages, []);
});

test("aggregate recorder ignores runtime delivery failures", () => {
  const runtime = {
    sendMessage() {
      throw new Error("extension context unavailable");
    },
  };

  assert.doesNotThrow(() =>
    recordRelevanceAggregate(
      {
        kind: "search",
        source: "network",
        outcome: "success",
        latencyMs: 120,
        candidateCount: 8,
      },
      runtime
    )
  );
});

test("search aggregate classifies rate limits, degradation, and empty results", () => {
  assert.equal(
    buildRelevanceSearchAggregateSample({
      source: "network",
      status: 429,
      degraded: false,
      failed: true,
      latencyMs: 40,
      candidateCount: 0,
    }).outcome,
    "rate_limited"
  );
  assert.equal(
    buildRelevanceSearchAggregateSample({
      source: "network",
      status: 502,
      degraded: true,
      failed: true,
      latencyMs: 80,
      candidateCount: 0,
    }).outcome,
    "degraded"
  );
  assert.equal(
    buildRelevanceSearchAggregateSample({
      source: "memory_cache",
      status: 200,
      degraded: false,
      failed: false,
      latencyMs: 0,
      candidateCount: 0,
    }).outcome,
    "empty"
  );
});

test("memory-cache telemetry does not synthesize an HTTP response status", () => {
  assert.deepEqual(buildRelevanceMemoryCacheAggregateSample(0), {
    kind: "search",
    source: "memory_cache",
    outcome: "empty",
    latencyMs: 0,
    candidateCount: 0,
  });
});

test("lexical shadow comparison counts paired score and threshold changes", () => {
  assert.deepEqual(
    compareLexicalShadowScores({
      activeScores: [0.6, 0.4, 0.5],
      shadowScores: [0.55, 0.52, 0.5],
      threshold: 0.5,
    }),
    {
      compared: 3,
      higher: 1,
      lower: 1,
      thresholdGained: 1,
      thresholdLost: 0,
    }
  );
});

test("pipeline aggregate derives bounded rejection and validator counters", () => {
  const sample = buildRelevancePipelineAggregateSample({
    scoringMode: "lexical",
    contextMode: "nested_bounded",
    gateCounters: {
      blocked: 4,
      zeroSignal: 1,
      singleSignal: 1,
      lowOverlap: 1,
      disabledSource: 1,
      recovered: 2,
      retryEligible: 3,
      legacyRelaxedShadowEligible: 2,
      thresholdBlocked: 1,
      propositionConflicts: {
        date: 2,
        direction: 1,
        entity: 0,
        numericThreshold: 1,
        outcome: 0,
      },
    },
    lexicalShadow: {
      compared: 6,
      higher: 2,
      lower: 3,
      thresholdGained: 1,
      thresholdLost: 2,
    },
    candidates: [
      {
        gatePassed: false,
        gateReason: "gate-zero-signal; distinct=0",
        shown: false,
        title: "private market title",
      },
      {
        gatePassed: false,
        gateReason: "gate-single-signal; distinct=1",
        shown: false,
      },
      {
        gatePassed: false,
        gateReason: "gate-low-overlap; overlap=0.1",
        shown: false,
      },
      {
        gatePassed: false,
        gateReason: "disabled-source:private-source-name",
        shown: false,
      },
      {
        gatePassed: true,
        gateReason: "below-threshold:0.4<0.5",
        validator: "unavailable",
        shown: false,
        id: "private-market-id",
      },
      {
        gatePassed: true,
        gateReason: "passed",
        validator: "passed",
        shown: true,
      },
    ],
  });

  assert.deepEqual(sample, {
    kind: "pipeline",
    outcome: "shown",
    scoringMode: "lexical",
    contextMode: "nested_bounded",
    retrievedCandidates: 6,
    gateBlocked: 4,
    gateZeroSignal: 1,
    gateSingleSignal: 1,
    gateLowOverlap: 1,
    gateDisabledSource: 1,
    gateRecovered: 2,
    gateRetryEligible: 3,
    legacyRelaxedShadowEligible: 2,
    thresholdBlocked: 1,
    propositionDateConflicts: 2,
    propositionDirectionConflicts: 1,
    propositionEntityConflicts: 0,
    propositionNumericThresholdConflicts: 1,
    propositionOutcomeConflicts: 0,
    lexicalShadowCompared: 6,
    lexicalShadowHigher: 2,
    lexicalShadowLower: 3,
    lexicalShadowThresholdGained: 1,
    lexicalShadowThresholdLost: 2,
    validatorPassed: 1,
    validatorRejected: 0,
    validatorUnavailable: 1,
    validatorError: 0,
    shownCandidates: 1,
  });
  assert.equal(JSON.stringify(sample).includes("private"), false);
});
