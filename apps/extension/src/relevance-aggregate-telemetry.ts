export const RELEVANCE_AGGREGATE_RETENTION_DAYS = 14;
const MAX_SAMPLE_COUNT = 1_000;
const MAX_SEARCH_LATENCY_MS = 120_000;

const SEARCH_SOURCES = ["network", "memory_cache", "stale_cache"] as const;
const SEARCH_OUTCOMES = [
  "success",
  "empty",
  "degraded",
  "rate_limited",
  "error",
] as const;
const PIPELINE_OUTCOMES = [
  "shown",
  "no_candidates",
  "gate_rejected",
  "threshold_rejected",
  "validator_rejected",
  "scoring_error",
] as const;
const SCORING_MODES = ["hybrid", "lexical", "heuristic", "none"] as const;
const CONTEXT_MODES = ["title_only", "nested_bounded", "direct"] as const;

type SearchSource = (typeof SEARCH_SOURCES)[number];
type SearchOutcome = (typeof SEARCH_OUTCOMES)[number];
type PipelineOutcome = (typeof PIPELINE_OUTCOMES)[number];
type AggregateScoringMode = (typeof SCORING_MODES)[number];
type AggregateContextMode = (typeof CONTEXT_MODES)[number];

export interface RelevanceSearchAggregateSample {
  kind: "search";
  source: SearchSource;
  outcome: SearchOutcome;
  latencyMs: number;
  candidateCount: number;
}

export interface RelevancePipelineAggregateSample {
  kind: "pipeline";
  outcome: PipelineOutcome;
  scoringMode: AggregateScoringMode;
  contextMode: AggregateContextMode;
  retrievedCandidates: number;
  gateBlocked: number;
  gateZeroSignal: number;
  gateSingleSignal: number;
  gateLowOverlap: number;
  gateDisabledSource: number;
  gateRecovered: number;
  gateRetryEligible: number;
  legacyRelaxedShadowEligible?: number;
  thresholdBlocked: number;
  propositionDateConflicts?: number;
  propositionDirectionConflicts?: number;
  propositionEntityConflicts?: number;
  propositionNumericThresholdConflicts?: number;
  propositionOutcomeConflicts?: number;
  lexicalShadowCompared?: number;
  lexicalShadowHigher?: number;
  lexicalShadowLower?: number;
  lexicalShadowThresholdGained?: number;
  lexicalShadowThresholdLost?: number;
  validatorPassed: number;
  validatorRejected: number;
  validatorUnavailable: number;
  validatorError: number;
  shownCandidates: number;
}

export type RelevanceAggregateSample =
  | RelevanceSearchAggregateSample
  | RelevancePipelineAggregateSample;

interface RelevanceDailyAggregate {
  day: string;
  search: {
    requests: number;
    sources: Record<SearchSource, number>;
    outcomes: Record<SearchOutcome, number>;
    candidateTotal: number;
    latencyMs: Record<
      | "le_100"
      | "le_250"
      | "le_500"
      | "le_1000"
      | "le_2500"
      | "le_5000"
      | "le_10000"
      | "over_10000",
      number
    >;
  };
  pipeline: {
    posts: number;
    outcomes: Record<PipelineOutcome, number>;
    scoringModes: Record<AggregateScoringMode, number>;
    contextModes: Record<AggregateContextMode, number>;
    contextOutcomes: Record<
      AggregateContextMode,
      Record<PipelineOutcome, number>
    >;
    candidates: {
      retrieved: number;
      gateBlocked: number;
      gateZeroSignal: number;
      gateSingleSignal: number;
      gateLowOverlap: number;
      gateDisabledSource: number;
      gateRecovered: number;
      gateRetryEligible: number;
      legacyRelaxedShadowEligible: number;
      thresholdBlocked: number;
      propositionDateConflicts: number;
      propositionDirectionConflicts: number;
      propositionEntityConflicts: number;
      propositionNumericThresholdConflicts: number;
      propositionOutcomeConflicts: number;
      lexicalShadowCompared: number;
      lexicalShadowHigher: number;
      lexicalShadowLower: number;
      lexicalShadowThresholdGained: number;
      lexicalShadowThresholdLost: number;
      validatorPassed: number;
      validatorRejected: number;
      validatorUnavailable: number;
      validatorError: number;
      shown: number;
    };
  };
}

export interface RelevanceAggregateSnapshot {
  schemaVersion: 1;
  updatedAt: number;
  days: RelevanceDailyAggregate[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEnumValue<T extends string>(
  values: readonly T[],
  value: unknown
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_SAMPLE_COUNT
  );
}

export function parseRelevanceAggregateSample(
  value: unknown
): RelevanceAggregateSample | null {
  if (!isRecord(value)) return null;

  if (value.kind === "search") {
    if (
      !isEnumValue(SEARCH_SOURCES, value.source) ||
      !isEnumValue(SEARCH_OUTCOMES, value.outcome) ||
      typeof value.latencyMs !== "number" ||
      !Number.isFinite(value.latencyMs) ||
      value.latencyMs < 0 ||
      value.latencyMs > MAX_SEARCH_LATENCY_MS ||
      !isCount(value.candidateCount)
    ) {
      return null;
    }

    return {
      kind: "search",
      source: value.source,
      outcome: value.outcome,
      latencyMs: value.latencyMs,
      candidateCount: value.candidateCount,
    };
  }

  if (value.kind !== "pipeline") return null;
  if (
    !isEnumValue(PIPELINE_OUTCOMES, value.outcome) ||
    !isEnumValue(SCORING_MODES, value.scoringMode) ||
    !isEnumValue(CONTEXT_MODES, value.contextMode)
  ) {
    return null;
  }

  const countKeys = [
    "retrievedCandidates",
    "gateBlocked",
    "gateZeroSignal",
    "gateSingleSignal",
    "gateLowOverlap",
    "gateDisabledSource",
    "gateRecovered",
    "gateRetryEligible",
    "thresholdBlocked",
    "validatorPassed",
    "validatorRejected",
    "validatorUnavailable",
    "validatorError",
    "shownCandidates",
  ] as const;
  if (countKeys.some((key) => !isCount(value[key]))) return null;
  const optionalCountKeys = [
    "propositionDateConflicts",
    "propositionDirectionConflicts",
    "propositionEntityConflicts",
    "propositionNumericThresholdConflicts",
    "propositionOutcomeConflicts",
    "lexicalShadowCompared",
    "lexicalShadowHigher",
    "lexicalShadowLower",
    "lexicalShadowThresholdGained",
    "lexicalShadowThresholdLost",
    "legacyRelaxedShadowEligible",
  ] as const;
  if (
    optionalCountKeys.some(
      (key) => value[key] !== undefined && !isCount(value[key])
    )
  ) {
    return null;
  }

  return {
    kind: "pipeline",
    outcome: value.outcome,
    scoringMode: value.scoringMode,
    contextMode: value.contextMode,
    retrievedCandidates: value.retrievedCandidates as number,
    gateBlocked: value.gateBlocked as number,
    gateZeroSignal: value.gateZeroSignal as number,
    gateSingleSignal: value.gateSingleSignal as number,
    gateLowOverlap: value.gateLowOverlap as number,
    gateDisabledSource: value.gateDisabledSource as number,
    gateRecovered: value.gateRecovered as number,
    gateRetryEligible: value.gateRetryEligible as number,
    legacyRelaxedShadowEligible:
      (value.legacyRelaxedShadowEligible as number) ?? 0,
    thresholdBlocked: value.thresholdBlocked as number,
    propositionDateConflicts: (value.propositionDateConflicts as number) ?? 0,
    propositionDirectionConflicts:
      (value.propositionDirectionConflicts as number) ?? 0,
    propositionEntityConflicts:
      (value.propositionEntityConflicts as number) ?? 0,
    propositionNumericThresholdConflicts:
      (value.propositionNumericThresholdConflicts as number) ?? 0,
    propositionOutcomeConflicts:
      (value.propositionOutcomeConflicts as number) ?? 0,
    lexicalShadowCompared: (value.lexicalShadowCompared as number) ?? 0,
    lexicalShadowHigher: (value.lexicalShadowHigher as number) ?? 0,
    lexicalShadowLower: (value.lexicalShadowLower as number) ?? 0,
    lexicalShadowThresholdGained:
      (value.lexicalShadowThresholdGained as number) ?? 0,
    lexicalShadowThresholdLost:
      (value.lexicalShadowThresholdLost as number) ?? 0,
    validatorPassed: value.validatorPassed as number,
    validatorRejected: value.validatorRejected as number,
    validatorUnavailable: value.validatorUnavailable as number,
    validatorError: value.validatorError as number,
    shownCandidates: value.shownCandidates as number,
  };
}

function createDailyAggregate(day: string): RelevanceDailyAggregate {
  return {
    day,
    search: {
      requests: 0,
      sources: { network: 0, memory_cache: 0, stale_cache: 0 },
      outcomes: {
        success: 0,
        empty: 0,
        degraded: 0,
        rate_limited: 0,
        error: 0,
      },
      candidateTotal: 0,
      latencyMs: {
        le_100: 0,
        le_250: 0,
        le_500: 0,
        le_1000: 0,
        le_2500: 0,
        le_5000: 0,
        le_10000: 0,
        over_10000: 0,
      },
    },
    pipeline: {
      posts: 0,
      outcomes: {
        shown: 0,
        no_candidates: 0,
        gate_rejected: 0,
        threshold_rejected: 0,
        validator_rejected: 0,
        scoring_error: 0,
      },
      scoringModes: { hybrid: 0, lexical: 0, heuristic: 0, none: 0 },
      contextModes: { title_only: 0, nested_bounded: 0, direct: 0 },
      contextOutcomes: {
        title_only: {
          shown: 0,
          no_candidates: 0,
          gate_rejected: 0,
          threshold_rejected: 0,
          validator_rejected: 0,
          scoring_error: 0,
        },
        nested_bounded: {
          shown: 0,
          no_candidates: 0,
          gate_rejected: 0,
          threshold_rejected: 0,
          validator_rejected: 0,
          scoring_error: 0,
        },
        direct: {
          shown: 0,
          no_candidates: 0,
          gate_rejected: 0,
          threshold_rejected: 0,
          validator_rejected: 0,
          scoring_error: 0,
        },
      },
      candidates: {
        retrieved: 0,
        gateBlocked: 0,
        gateZeroSignal: 0,
        gateSingleSignal: 0,
        gateLowOverlap: 0,
        gateDisabledSource: 0,
        gateRecovered: 0,
        gateRetryEligible: 0,
        legacyRelaxedShadowEligible: 0,
        thresholdBlocked: 0,
        propositionDateConflicts: 0,
        propositionDirectionConflicts: 0,
        propositionEntityConflicts: 0,
        propositionNumericThresholdConflicts: 0,
        propositionOutcomeConflicts: 0,
        lexicalShadowCompared: 0,
        lexicalShadowHigher: 0,
        lexicalShadowLower: 0,
        lexicalShadowThresholdGained: 0,
        lexicalShadowThresholdLost: 0,
        validatorPassed: 0,
        validatorRejected: 0,
        validatorUnavailable: 0,
        validatorError: 0,
        shown: 0,
      },
    },
  };
}

function readAggregateCount(
  record: Record<string, unknown>,
  key: string
): number {
  const value = record[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function sanitizeDailyAggregate(
  value: unknown
): RelevanceDailyAggregate | null {
  if (!isRecord(value) || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.day))) {
    return null;
  }
  const search = isRecord(value.search) ? value.search : {};
  const searchSources = isRecord(search.sources) ? search.sources : {};
  const searchOutcomes = isRecord(search.outcomes) ? search.outcomes : {};
  const latency = isRecord(search.latencyMs) ? search.latencyMs : {};
  const pipeline = isRecord(value.pipeline) ? value.pipeline : {};
  const pipelineOutcomes = isRecord(pipeline.outcomes) ? pipeline.outcomes : {};
  const scoringModes = isRecord(pipeline.scoringModes)
    ? pipeline.scoringModes
    : {};
  const contextModes = isRecord(pipeline.contextModes)
    ? pipeline.contextModes
    : {};
  const contextOutcomes = isRecord(pipeline.contextOutcomes)
    ? pipeline.contextOutcomes
    : {};
  const candidates = isRecord(pipeline.candidates) ? pipeline.candidates : {};
  const sanitized = createDailyAggregate(String(value.day));

  sanitized.search.requests = readAggregateCount(search, "requests");
  sanitized.search.candidateTotal = readAggregateCount(
    search,
    "candidateTotal"
  );
  for (const source of SEARCH_SOURCES) {
    sanitized.search.sources[source] = readAggregateCount(
      searchSources,
      source
    );
  }
  for (const outcome of SEARCH_OUTCOMES) {
    sanitized.search.outcomes[outcome] = readAggregateCount(
      searchOutcomes,
      outcome
    );
  }
  for (const bucket of Object.keys(sanitized.search.latencyMs) as Array<
    keyof typeof sanitized.search.latencyMs
  >) {
    sanitized.search.latencyMs[bucket] = readAggregateCount(latency, bucket);
  }

  sanitized.pipeline.posts = readAggregateCount(pipeline, "posts");
  for (const outcome of PIPELINE_OUTCOMES) {
    sanitized.pipeline.outcomes[outcome] = readAggregateCount(
      pipelineOutcomes,
      outcome
    );
  }
  for (const mode of SCORING_MODES) {
    sanitized.pipeline.scoringModes[mode] = readAggregateCount(
      scoringModes,
      mode
    );
  }
  for (const mode of CONTEXT_MODES) {
    sanitized.pipeline.contextModes[mode] = readAggregateCount(
      contextModes,
      mode
    );
    const modeOutcomes = isRecord(contextOutcomes[mode])
      ? contextOutcomes[mode]
      : {};
    for (const outcome of PIPELINE_OUTCOMES) {
      sanitized.pipeline.contextOutcomes[mode][outcome] = readAggregateCount(
        modeOutcomes,
        outcome
      );
    }
  }
  for (const key of Object.keys(sanitized.pipeline.candidates) as Array<
    keyof typeof sanitized.pipeline.candidates
  >) {
    sanitized.pipeline.candidates[key] = readAggregateCount(candidates, key);
  }

  return sanitized;
}

export function sanitizeRelevanceAggregateSnapshot(
  value: unknown,
  now = Date.now()
): RelevanceAggregateSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return { schemaVersion: 1, updatedAt: now, days: [] };
  }
  const days = Array.isArray(value.days)
    ? value.days
        .map(sanitizeDailyAggregate)
        .filter((day): day is RelevanceDailyAggregate => day !== null)
        .sort((left, right) => left.day.localeCompare(right.day))
        .slice(-RELEVANCE_AGGREGATE_RETENTION_DAYS)
    : [];
  return {
    schemaVersion: 1,
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : now,
    days,
  };
}

function cloneSnapshot(
  snapshot: RelevanceAggregateSnapshot | undefined,
  now: number
): RelevanceAggregateSnapshot {
  return sanitizeRelevanceAggregateSnapshot(snapshot, now);
}

function latencyBucket(
  latencyMs: number
): keyof RelevanceDailyAggregate["search"]["latencyMs"] {
  if (latencyMs <= 100) return "le_100";
  if (latencyMs <= 250) return "le_250";
  if (latencyMs <= 500) return "le_500";
  if (latencyMs <= 1_000) return "le_1000";
  if (latencyMs <= 2_500) return "le_2500";
  if (latencyMs <= 5_000) return "le_5000";
  if (latencyMs <= 10_000) return "le_10000";
  return "over_10000";
}

export function addRelevanceAggregateSample(
  snapshot: RelevanceAggregateSnapshot | undefined,
  sample: RelevanceAggregateSample,
  now = Date.now()
): RelevanceAggregateSnapshot {
  const next = cloneSnapshot(snapshot, now);
  const dayKey = new Date(now).toISOString().slice(0, 10);
  let day = next.days.find((entry) => entry.day === dayKey);
  if (!day) {
    day = createDailyAggregate(dayKey);
    next.days.push(day);
    next.days.sort((left, right) => left.day.localeCompare(right.day));
  }

  if (sample.kind === "search") {
    day.search.requests++;
    day.search.sources[sample.source]++;
    day.search.outcomes[sample.outcome]++;
    day.search.candidateTotal += sample.candidateCount;
    day.search.latencyMs[latencyBucket(sample.latencyMs)]++;
  } else {
    day.pipeline.posts++;
    day.pipeline.outcomes[sample.outcome]++;
    day.pipeline.scoringModes[sample.scoringMode]++;
    day.pipeline.contextModes[sample.contextMode]++;
    day.pipeline.contextOutcomes[sample.contextMode][sample.outcome]++;
    day.pipeline.candidates.retrieved += sample.retrievedCandidates;
    day.pipeline.candidates.gateBlocked += sample.gateBlocked;
    day.pipeline.candidates.gateZeroSignal += sample.gateZeroSignal;
    day.pipeline.candidates.gateSingleSignal += sample.gateSingleSignal;
    day.pipeline.candidates.gateLowOverlap += sample.gateLowOverlap;
    day.pipeline.candidates.gateDisabledSource += sample.gateDisabledSource;
    day.pipeline.candidates.gateRecovered += sample.gateRecovered;
    day.pipeline.candidates.gateRetryEligible += sample.gateRetryEligible;
    day.pipeline.candidates.legacyRelaxedShadowEligible +=
      sample.legacyRelaxedShadowEligible ?? 0;
    day.pipeline.candidates.thresholdBlocked += sample.thresholdBlocked;
    day.pipeline.candidates.propositionDateConflicts +=
      sample.propositionDateConflicts ?? 0;
    day.pipeline.candidates.propositionDirectionConflicts +=
      sample.propositionDirectionConflicts ?? 0;
    day.pipeline.candidates.propositionEntityConflicts +=
      sample.propositionEntityConflicts ?? 0;
    day.pipeline.candidates.propositionNumericThresholdConflicts +=
      sample.propositionNumericThresholdConflicts ?? 0;
    day.pipeline.candidates.propositionOutcomeConflicts +=
      sample.propositionOutcomeConflicts ?? 0;
    day.pipeline.candidates.lexicalShadowCompared +=
      sample.lexicalShadowCompared ?? 0;
    day.pipeline.candidates.lexicalShadowHigher +=
      sample.lexicalShadowHigher ?? 0;
    day.pipeline.candidates.lexicalShadowLower +=
      sample.lexicalShadowLower ?? 0;
    day.pipeline.candidates.lexicalShadowThresholdGained +=
      sample.lexicalShadowThresholdGained ?? 0;
    day.pipeline.candidates.lexicalShadowThresholdLost +=
      sample.lexicalShadowThresholdLost ?? 0;
    day.pipeline.candidates.validatorPassed += sample.validatorPassed;
    day.pipeline.candidates.validatorRejected += sample.validatorRejected;
    day.pipeline.candidates.validatorUnavailable += sample.validatorUnavailable;
    day.pipeline.candidates.validatorError += sample.validatorError;
    day.pipeline.candidates.shown += sample.shownCandidates;
  }

  next.updatedAt = now;
  next.days = next.days.slice(-RELEVANCE_AGGREGATE_RETENTION_DAYS);
  return next;
}
