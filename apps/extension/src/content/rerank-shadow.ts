interface BaseScoredCandidate {
  score: number;
}

export function rankCandidatesByBaseScore<T extends BaseScoredCandidate>(
  candidates: T[]
): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (left, right) =>
        right.candidate.score - left.candidate.score || left.index - right.index
    )
    .map(({ candidate }) => candidate);
}

export function selectTopBaseCandidates<T extends BaseScoredCandidate>(
  candidates: T[],
  options: { maximumCandidates: number; scoreGap: number }
): T[] {
  if (candidates.length === 0 || options.maximumCandidates <= 0) return [];

  const ranked = rankCandidatesByBaseScore(candidates);
  const minimumScore = Math.max(0, ranked[0].score - options.scoreGap);
  return ranked
    .filter((candidate) => candidate.score >= minimumScore)
    .slice(0, Math.floor(options.maximumCandidates));
}
