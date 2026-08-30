import assert from "node:assert/strict";
import { test } from "vitest";
import {
  rankCandidatesByBaseScore,
  selectTopBaseCandidates,
} from "../../src/content/rerank-shadow";

interface Candidate {
  id: string;
  score: number;
  rerankScore?: number;
}

test("MiniLM shadow scores cannot change displayed candidate order", () => {
  const candidates: Candidate[] = [
    { id: "base-winner", score: 0.9, rerankScore: -4 },
    { id: "base-runner-up", score: 0.86, rerankScore: 8 },
    { id: "outside-window", score: 0.7, rerankScore: 12 },
  ];

  const selected = selectTopBaseCandidates(candidates, {
    maximumCandidates: 2,
    scoreGap: 0.08,
  });

  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ["base-winner", "base-runner-up"]
  );
  assert.deepEqual(
    selected.map((candidate) => candidate.rerankScore),
    [-4, 8]
  );
});

test("candidate admission remains anchored to the base-score winner", () => {
  const candidates: Candidate[] = [
    { id: "base-winner", score: 0.9, rerankScore: -10 },
    { id: "rerank-winner", score: 0.79, rerankScore: 10 },
  ];

  const selected = selectTopBaseCandidates(candidates, {
    maximumCandidates: 2,
    scoreGap: 0.08,
  });

  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ["base-winner"]
  );
});

test("base ranking is stable and keeps shadow metadata intact", () => {
  const candidates: Candidate[] = [
    { id: "first-tie", score: 0.8, rerankScore: 1 },
    { id: "second-tie", score: 0.8, rerankScore: 9 },
  ];

  const ranked = rankCandidatesByBaseScore(candidates);

  assert.deepEqual(
    ranked.map((candidate) => candidate.id),
    ["first-tie", "second-tie"]
  );
  assert.notEqual(ranked, candidates);
  assert.equal(ranked[1].rerankScore, 9);
});
