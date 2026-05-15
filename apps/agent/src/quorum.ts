import Decimal from "decimal.js";
import {
  type ModelVote,
  ModelVoteSchema,
  type QuorumDecision,
  type ValidatedModelVote,
} from "./types.ts";

const MIN_TRADE_CONFIDENCE = 0.6;
const FALLBACK_HOLD_VOTE: ModelVote = {
  provider: "invalid",
  resolutionView: "Invalid model output; no analysis available.",
  marketImpliedProbability: 0,
  fairProbability: 0,
  edgePct: 0,
  evidenceFor: [],
  evidenceAgainst: [],
  missingEvidence: [],
  action: "HOLD",
  confidence: 0,
  sizeUsd: "0",
  reasoning: "Invalid model output was downgraded to HOLD.",
  citations: ["validation"],
  riskFlags: ["invalid-model-output"],
};

export function validateModelVote(input: unknown): ValidatedModelVote {
  const parsed = ModelVoteSchema.safeParse(input);
  if (parsed.success) {
    return {
      provider: parsed.data.provider,
      valid: true,
      vote: parsed.data,
      errors: [],
    };
  }

  const provider =
    input && typeof input === "object" && "provider" in input
      ? String((input as { provider?: unknown }).provider ?? "unknown")
      : "unknown";

  return {
    provider,
    valid: false,
    vote: {
      ...FALLBACK_HOLD_VOTE,
      provider,
      riskFlags: [
        ...FALLBACK_HOLD_VOTE.riskFlags,
        ...parsed.error.issues.map((issue) => issue.path.join(".") || "root"),
      ],
    },
    errors: parsed.error.issues.map((issue) => issue.message),
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values
    .reduce((sum, value) => sum.plus(value), new Decimal(0))
    .div(values.length)
    .toNumber();
}

function smallestDecimalString(values: string[]): string {
  const decimals = values
    .map((value) => {
      try {
        return new Decimal(value);
      } catch {
        return null;
      }
    })
    .filter((value): value is Decimal => Boolean(value?.isFinite()));
  if (decimals.length === 0) return "0";
  return Decimal.min(...decimals).toString();
}

export function reduceModelVotes(inputs: unknown[]): QuorumDecision {
  const parsed = inputs.map(validateModelVote);
  const validVotes = parsed
    .filter((result) => result.valid)
    .map((result) => result.vote);
  const invalidVotes = parsed.filter((result) => !result.valid);

  const counts = new Map<ModelVote["action"], number>();
  for (const vote of validVotes) {
    counts.set(vote.action, (counts.get(vote.action) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [leader, leaderCount] = ranked[0] ?? [null, 0];
  const secondCount = ranked[1]?.[1] ?? 0;
  const hasMajority =
    leader !== null && leaderCount >= 2 && leaderCount > secondCount;
  const leaderVotes = leader
    ? validVotes.filter((vote) => vote.action === leader)
    : [];
  const confidence = average(leaderVotes.map((vote) => vote.confidence));
  const fairProbability = average(
    leaderVotes.map((vote) => vote.fairProbability)
  );
  const riskFlags = [
    ...new Set(parsed.flatMap((result) => result.vote.riskFlags)),
  ];

  if (!hasMajority) {
    return {
      action: "HOLD",
      approved: false,
      majorityAction: null,
      confidence: 0,
      fairProbability: 0,
      sizeUsd: "0",
      reason: "No valid majority reached; defaulting to HOLD.",
      riskFlags,
      validVotes,
      invalidVotes,
    };
  }

  if (leader === "HOLD") {
    return {
      action: "HOLD",
      approved: false,
      majorityAction: "HOLD",
      confidence,
      fairProbability,
      sizeUsd: "0",
      reason: "Majority selected HOLD.",
      riskFlags,
      validVotes,
      invalidVotes,
    };
  }

  if (confidence < MIN_TRADE_CONFIDENCE) {
    return {
      action: "HOLD",
      approved: false,
      majorityAction: leader,
      confidence,
      fairProbability,
      sizeUsd: "0",
      reason: "Majority confidence is below the trade threshold.",
      riskFlags: [...riskFlags, "low-confidence"],
      validVotes,
      invalidVotes,
    };
  }

  return {
    action: leader,
    approved: true,
    majorityAction: leader,
    confidence,
    fairProbability,
    sizeUsd: smallestDecimalString(leaderVotes.map((vote) => vote.sizeUsd)),
    reason: `Valid majority selected ${leader}.`,
    riskFlags,
    validVotes,
    invalidVotes,
  };
}
