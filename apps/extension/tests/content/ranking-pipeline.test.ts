import assert from "node:assert/strict";
import { test } from "vitest";
import {
  applyTwoStageReranking,
  fuseCandidateRanks,
} from "../../src/content/ranking-pipeline";

interface Candidate {
  id: string;
  denseScore: number;
  lexicalScore: number;
  rerankScore?: number;
}

test("reciprocal-rank fusion depends on ranks, not raw score scales", () => {
  const candidates: Candidate[] = [
    { id: "upstream", denseScore: 0.2, lexicalScore: 3 },
    { id: "dense", denseScore: 0.9, lexicalScore: 1 },
    { id: "lexical", denseScore: 0.1, lexicalScore: 8 },
  ];
  const scaled = candidates.map((candidate) => ({
    ...candidate,
    denseScore: candidate.denseScore * 10_000,
    lexicalScore: candidate.lexicalScore / 10_000,
  }));

  assert.deepEqual(
    fuseCandidateRanks(candidates).map(({ candidate }) => candidate.id),
    fuseCandidateRanks(scaled).map(({ candidate }) => candidate.id)
  );
});

test("fusion keeps input order for stable ties", () => {
  const fused = fuseCandidateRanks([
    { id: "first", denseScore: 0.5, lexicalScore: 0.5 },
    { id: "second", denseScore: 0.5, lexicalScore: 0.5 },
  ]);

  assert.deepEqual(
    fused.map(({ candidate }) => candidate.id),
    ["first", "second"]
  );
});

test("shadow and production share a fixed rerank pool but only production changes order", () => {
  const candidates: Candidate[] = [
    {
      id: "first-stage-1",
      denseScore: 0.9,
      lexicalScore: 0.8,
      rerankScore: -3,
    },
    { id: "first-stage-2", denseScore: 0.8, lexicalScore: 0.7, rerankScore: 9 },
    { id: "outside-pool", denseScore: 0.7, lexicalScore: 0.6, rerankScore: 99 },
  ];
  const firstStage = fuseCandidateRanks(candidates);
  const shadow = applyTwoStageReranking(firstStage, {
    mode: "shadow",
    poolSize: 2,
  });
  const production = applyTwoStageReranking(firstStage, {
    mode: "production",
    poolSize: 2,
  });

  assert.deepEqual(
    shadow.pool.map(({ candidate }) => candidate.id),
    production.pool.map(({ candidate }) => candidate.id)
  );
  assert.deepEqual(
    shadow.finalOrder.map(({ candidate }) => candidate.id),
    ["first-stage-1", "first-stage-2", "outside-pool"]
  );
  assert.deepEqual(
    production.finalOrder.map(({ candidate }) => candidate.id),
    ["first-stage-2", "first-stage-1", "outside-pool"]
  );
  assert.equal(
    production.pool.some(({ candidate }) => candidate.id === "outside-pool"),
    false
  );
});
