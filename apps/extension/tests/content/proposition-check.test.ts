import assert from "node:assert/strict";
import { test } from "vitest";
import {
  checkPropositionCompatibility,
  shouldBlockCandidateForProposition,
} from "../../src/content/proposition-check";

test.each([
  {
    name: "date",
    post: "Tesla will launch the model by 2027-06-30",
    market: "Will Tesla launch the model by 2027-07-31?",
    field: "date",
  },
  {
    name: "direction",
    post: "Tesla will close above $500",
    market: "Will Tesla close below $500?",
    field: "direction",
  },
  {
    name: "numeric threshold",
    post: "Tesla will close above $500",
    market: "Will Tesla close above $600?",
    field: "numericThreshold",
  },
  {
    name: "entity",
    post: "Nvidia will announce a new GPU",
    market: "Will Tesla announce a new GPU?",
    field: "entity",
  },
  {
    name: "outcome",
    post: "Spain will not win the World Cup",
    market: "Will Spain win the World Cup?",
    field: "outcome",
  },
])(
  "proposition checker reports a typed $name conflict",
  ({ post, market, field }) => {
    const result = checkPropositionCompatibility(post, market);

    assert.equal(result.compatible, false);
    assert.equal(
      result.fields[field as keyof typeof result.fields].state,
      "conflict"
    );
    assert.ok(result.conflictTypes.includes(field));
  }
);

test("proposition checker keeps missing fields neutral", () => {
  const result = checkPropositionCompatibility(
    "A product update is coming",
    "Will the company make an announcement?"
  );

  assert.equal(result.compatible, true);
  assert.deepEqual(result.conflictTypes, []);
  assert.equal(result.fields.date.state, "unknown");
  assert.equal(result.fields.numericThreshold.state, "unknown");
  assert.equal(result.fields.direction.state, "unknown");
});

test("proposition checker recognizes compatible proposition details", () => {
  const result = checkPropositionCompatibility(
    "Tesla will close above $500 by 2027-06-30",
    "Will Tesla close above $500 by June 30, 2027?"
  );

  assert.equal(result.compatible, true);
  assert.equal(result.fields.entity.state, "compatible");
  assert.equal(result.fields.date.state, "compatible");
  assert.equal(result.fields.numericThreshold.state, "compatible");
  assert.equal(result.fields.direction.state, "compatible");
});

test("proposition conflicts stay shadow-only until calibration is active", () => {
  const conflict = checkPropositionCompatibility(
    "Tesla will close above $500",
    "Will Tesla close below $500?"
  );

  assert.equal(shouldBlockCandidateForProposition(conflict, false), false);
  assert.equal(shouldBlockCandidateForProposition(conflict, true), true);
});
