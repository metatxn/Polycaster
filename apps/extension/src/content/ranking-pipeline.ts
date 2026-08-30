export interface RankingSignals {
  denseScore: number;
  lexicalScore: number;
  rerankScore?: number;
}

export interface FusedCandidate<T> {
  candidate: T;
  originalIndex: number;
  upstreamRank: number;
  denseRank: number;
  lexicalRank: number;
  rrfScore: number;
}

interface FusionOptions {
  rankConstant?: number;
  upstreamWeight?: number;
  denseWeight?: number;
  lexicalWeight?: number;
}

function rankBySignal<T>(
  candidates: T[],
  readScore: (candidate: T) => number
): Map<number, number> {
  return new Map(
    candidates
      .map((candidate, originalIndex) => ({
        originalIndex,
        score: readScore(candidate),
      }))
      .sort((left, right) => {
        const leftScore = Number.isFinite(left.score)
          ? left.score
          : Number.NEGATIVE_INFINITY;
        const rightScore = Number.isFinite(right.score)
          ? right.score
          : Number.NEGATIVE_INFINITY;
        return (
          rightScore - leftScore || left.originalIndex - right.originalIndex
        );
      })
      .map((entry, index) => [entry.originalIndex, index + 1])
  );
}

export function fuseCandidateRanks<T extends RankingSignals>(
  candidates: T[],
  options: FusionOptions = {}
): Array<FusedCandidate<T>> {
  const rankConstant = options.rankConstant ?? 60;
  const upstreamWeight = options.upstreamWeight ?? 1;
  const denseWeight = options.denseWeight ?? 1;
  const lexicalWeight = options.lexicalWeight ?? 1;
  if (!Number.isFinite(rankConstant) || rankConstant < 0) {
    throw new RangeError("rankConstant must be a non-negative number");
  }

  const denseRanks = rankBySignal(
    candidates,
    (candidate) => candidate.denseScore
  );
  const lexicalRanks = rankBySignal(
    candidates,
    (candidate) => candidate.lexicalScore
  );
  const maximumScore =
    (upstreamWeight + denseWeight + lexicalWeight) / (rankConstant + 1);

  return candidates
    .map((candidate, originalIndex) => {
      const upstreamRank = originalIndex + 1;
      const denseRank = denseRanks.get(originalIndex) ?? candidates.length;
      const lexicalRank = lexicalRanks.get(originalIndex) ?? candidates.length;
      const rawScore =
        upstreamWeight / (rankConstant + upstreamRank) +
        denseWeight / (rankConstant + denseRank) +
        lexicalWeight / (rankConstant + lexicalRank);
      return {
        candidate,
        originalIndex,
        upstreamRank,
        denseRank,
        lexicalRank,
        rrfScore: maximumScore > 0 ? rawScore / maximumScore : 0,
      };
    })
    .sort(
      (left, right) =>
        right.rrfScore - left.rrfScore ||
        left.originalIndex - right.originalIndex
    );
}

export function applyTwoStageReranking<T extends RankingSignals>(
  firstStage: Array<FusedCandidate<T>>,
  options: { mode: "production" | "shadow"; poolSize: number }
): {
  pool: Array<FusedCandidate<T>>;
  finalOrder: Array<FusedCandidate<T>>;
} {
  const poolSize = Math.max(0, Math.floor(options.poolSize));
  const pool = firstStage.slice(0, poolSize);
  if (options.mode === "shadow") {
    return { pool, finalOrder: firstStage.slice() };
  }

  const rerankedPool = pool
    .map((entry, poolIndex) => ({ entry, poolIndex }))
    .sort((left, right) => {
      const leftScore = left.entry.candidate.rerankScore;
      const rightScore = right.entry.candidate.rerankScore;
      return (
        (Number.isFinite(rightScore) ? (rightScore as number) : -Infinity) -
          (Number.isFinite(leftScore) ? (leftScore as number) : -Infinity) ||
        left.poolIndex - right.poolIndex
      );
    })
    .map(({ entry }) => entry);

  return {
    pool,
    finalOrder: [...rerankedPool, ...firstStage.slice(pool.length)],
  };
}
