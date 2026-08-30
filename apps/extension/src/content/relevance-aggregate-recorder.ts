import {
  parseRelevanceAggregateSample,
  type RelevanceAggregateSample,
  type RelevancePipelineAggregateSample,
  type RelevanceSearchAggregateSample,
} from "../relevance-aggregate-telemetry";

interface RelevanceAggregateRuntime {
  lastError?: { message?: string };
  sendMessage(message: unknown, callback?: () => void): unknown;
}

function getRuntime(): RelevanceAggregateRuntime | null {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return null;
  }
  return chrome.runtime;
}

export function buildRelevanceSearchAggregateSample(input: {
  source: RelevanceSearchAggregateSample["source"];
  status?: number;
  degraded: boolean;
  failed: boolean;
  latencyMs: number;
  candidateCount: number;
}): RelevanceSearchAggregateSample {
  const outcome =
    input.status === 429
      ? "rate_limited"
      : input.degraded
        ? "degraded"
        : input.failed || (input.status !== undefined && input.status >= 400)
          ? "error"
          : input.candidateCount === 0
            ? "empty"
            : "success";
  return {
    kind: "search",
    source: input.source,
    outcome,
    latencyMs: input.latencyMs,
    candidateCount: input.candidateCount,
  };
}

export function buildRelevanceMemoryCacheAggregateSample(
  candidateCount: number
): RelevanceSearchAggregateSample {
  return buildRelevanceSearchAggregateSample({
    source: "memory_cache",
    degraded: false,
    failed: false,
    latencyMs: 0,
    candidateCount,
  });
}

interface PipelineCandidateAggregateInput {
  gatePassed: boolean;
  gateReason?: string;
  validator?: "passed" | "rejected" | "unavailable" | "error";
  shown: boolean;
}

export interface LexicalShadowAggregate {
  compared: number;
  higher: number;
  lower: number;
  thresholdGained: number;
  thresholdLost: number;
}

export function compareLexicalShadowScores(input: {
  activeScores: number[];
  shadowScores: number[];
  threshold: number;
}): LexicalShadowAggregate {
  const result: LexicalShadowAggregate = {
    compared: 0,
    higher: 0,
    lower: 0,
    thresholdGained: 0,
    thresholdLost: 0,
  };
  if (!Number.isFinite(input.threshold)) return result;

  const count = Math.min(input.activeScores.length, input.shadowScores.length);
  for (let index = 0; index < count; index++) {
    const active = input.activeScores[index];
    const shadow = input.shadowScores[index];
    if (!Number.isFinite(active) || !Number.isFinite(shadow)) continue;

    result.compared++;
    if (shadow > active) result.higher++;
    else if (shadow < active) result.lower++;

    const activePassed = active >= input.threshold;
    const shadowPassed = shadow >= input.threshold;
    if (!activePassed && shadowPassed) result.thresholdGained++;
    else if (activePassed && !shadowPassed) result.thresholdLost++;
  }
  return result;
}

export function buildRelevancePipelineAggregateSample(input: {
  scoringMode: RelevancePipelineAggregateSample["scoringMode"];
  contextMode?: RelevancePipelineAggregateSample["contextMode"];
  candidates: PipelineCandidateAggregateInput[];
  scoringError?: boolean;
  lexicalShadow?: LexicalShadowAggregate;
  gateCounters?: {
    blocked: number;
    zeroSignal: number;
    singleSignal: number;
    lowOverlap: number;
    disabledSource: number;
    recovered: number;
    retryEligible: number;
    legacyRelaxedShadowEligible: number;
    thresholdBlocked: number;
    propositionConflicts?: {
      date?: number;
      direction?: number;
      entity?: number;
      numericThreshold?: number;
      outcome?: number;
    };
  };
}): RelevancePipelineAggregateSample {
  const countValidator = (
    validator: NonNullable<PipelineCandidateAggregateInput["validator"]>
  ) =>
    input.candidates.filter((candidate) => candidate.validator === validator)
      .length;
  const countGateReason = (prefix: string) =>
    input.candidates.filter((candidate) =>
      candidate.gateReason?.startsWith(prefix)
    ).length;
  const gateBlocked =
    input.gateCounters?.blocked ??
    input.candidates.filter((candidate) => !candidate.gatePassed).length;
  const gateZeroSignal =
    input.gateCounters?.zeroSignal ?? countGateReason("gate-zero-signal");
  const gateSingleSignal =
    input.gateCounters?.singleSignal ?? countGateReason("gate-single-signal");
  const gateLowOverlap =
    input.gateCounters?.lowOverlap ?? countGateReason("gate-low-overlap");
  const gateDisabledSource =
    input.gateCounters?.disabledSource ?? countGateReason("disabled-source:");
  const gateRecovered = input.gateCounters?.recovered ?? 0;
  const gateRetryEligible = input.gateCounters?.retryEligible ?? 0;
  const thresholdBlocked =
    input.gateCounters?.thresholdBlocked ??
    input.candidates.filter((candidate) =>
      candidate.gateReason?.includes("below-threshold:")
    ).length;
  const shownCandidates = input.candidates.filter(
    (candidate) => candidate.shown
  ).length;
  const validatorRejected = countValidator("rejected");
  const validatorUnavailable = countValidator("unavailable");
  const validatorError = countValidator("error");

  const outcome =
    shownCandidates > 0
      ? "shown"
      : input.scoringError
        ? "scoring_error"
        : input.candidates.length === 0
          ? "no_candidates"
          : validatorRejected + validatorUnavailable + validatorError > 0
            ? "validator_rejected"
            : thresholdBlocked > 0
              ? "threshold_rejected"
              : "gate_rejected";

  return {
    kind: "pipeline",
    outcome,
    scoringMode: input.scoringMode,
    contextMode: input.contextMode ?? "title_only",
    retrievedCandidates: input.candidates.length,
    gateBlocked,
    gateZeroSignal,
    gateSingleSignal,
    gateLowOverlap,
    gateDisabledSource,
    gateRecovered,
    gateRetryEligible,
    legacyRelaxedShadowEligible:
      input.gateCounters?.legacyRelaxedShadowEligible ?? 0,
    thresholdBlocked,
    propositionDateConflicts:
      input.gateCounters?.propositionConflicts?.date ?? 0,
    propositionDirectionConflicts:
      input.gateCounters?.propositionConflicts?.direction ?? 0,
    propositionEntityConflicts:
      input.gateCounters?.propositionConflicts?.entity ?? 0,
    propositionNumericThresholdConflicts:
      input.gateCounters?.propositionConflicts?.numericThreshold ?? 0,
    propositionOutcomeConflicts:
      input.gateCounters?.propositionConflicts?.outcome ?? 0,
    lexicalShadowCompared: input.lexicalShadow?.compared ?? 0,
    lexicalShadowHigher: input.lexicalShadow?.higher ?? 0,
    lexicalShadowLower: input.lexicalShadow?.lower ?? 0,
    lexicalShadowThresholdGained: input.lexicalShadow?.thresholdGained ?? 0,
    lexicalShadowThresholdLost: input.lexicalShadow?.thresholdLost ?? 0,
    validatorPassed: countValidator("passed"),
    validatorRejected,
    validatorUnavailable,
    validatorError,
    shownCandidates,
  };
}

export function recordRelevanceAggregate(
  value: RelevanceAggregateSample | unknown,
  runtime: RelevanceAggregateRuntime | null = getRuntime()
): void {
  const sample = parseRelevanceAggregateSample(value);
  if (!sample || !runtime) return;

  try {
    runtime.sendMessage({ type: "relevance-aggregate:record", sample }, () => {
      void runtime.lastError;
    });
  } catch {
    // Aggregate diagnostics must never affect matching or page behavior.
  }
}
