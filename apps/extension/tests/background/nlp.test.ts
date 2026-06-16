import assert from "node:assert/strict";
import { test } from "vitest";
import { nlpContextGate } from "../../src/background/nlp";

test("nlpContextGate treats party as a meaningful political overlap", () => {
  const gate = nlpContextGate(
    "The party coalition dynamics are shifting ahead of the vote",
    "Which party wins 2028 US Presidential Election?"
  );

  assert.equal(gate.pass, false);
  assert.equal(gate.sharedNouns, 1);
  assert.equal(gate.meaningfulNouns, 1);
  assert.ok(/meaningful=\[party\]/.test(gate.details), gate.details);
});

test("nlpContextGate does not pass on non-political birthday party overlap", () => {
  const gate = nlpContextGate(
    "The birthday party ran late after cake, music, and decorations filled the house",
    "Which party wins 2028 US Presidential Election?"
  );

  assert.equal(gate.pass, false);
  assert.equal(gate.sharedNouns, 1);
  assert.equal(gate.meaningfulNouns, 1);
  assert.ok(/nouns=\[party\]/.test(gate.details), gate.details);
  assert.ok(/distinct=1/.test(gate.details), gate.details);
});

test("nlpContextGate counts election as a meaningful shared noun", () => {
  const gate = nlpContextGate(
    "Polling shows the election remains too close to call going into next week",
    "Who wins the 2028 US Presidential Election?"
  );

  assert.ok(gate.meaningfulNouns >= 1, gate.details);
  assert.ok(
    /meaningful=\[(?:[^\]]*,\s*)?election/.test(gate.details),
    gate.details
  );
});

test("nlpContextGate counts vote as a meaningful shared noun", () => {
  const gate = nlpContextGate(
    "Lawmakers postponed the vote after a procedural objection from the minority leader",
    "Will the Senate vote pass before the recess?"
  );

  assert.ok(gate.meaningfulNouns >= 1, gate.details);
  assert.ok(
    /meaningful=\[(?:[^\]]*,\s*)?vote/.test(gate.details),
    gate.details
  );
});

test("nlpContextGate counts government as a meaningful shared noun", () => {
  const gate = nlpContextGate(
    "The government announced new restrictions on imported goods this morning",
    "Will the UK government collapse in 2026?"
  );

  assert.ok(gate.meaningfulNouns >= 1, gate.details);
  assert.ok(
    /meaningful=\[(?:[^\]]*,\s*)?government/.test(gate.details),
    gate.details
  );
});

test("nlpContextGate passes when two distinct political nouns overlap", () => {
  const gate = nlpContextGate(
    "Voters head to the polls as the election turns into a referendum on the ruling party",
    "Which party wins the 2028 US Presidential Election?"
  );

  assert.equal(gate.pass, true, gate.details);
  assert.ok(gate.meaningfulNouns >= 2, gate.details);
  assert.ok(/distinct=([2-9]|\d{2,})/.test(gate.details), gate.details);
});

test("nlpContextGate ignores generic lemmas like country and people", () => {
  const gate = nlpContextGate(
    "The country watched as people gathered to discuss the latest report",
    "How many people in this country support the new policy?"
  );

  assert.equal(gate.pass, false);
  assert.equal(gate.meaningfulNouns, 0, gate.details);
});

test("nlpContextGate does not pass green-card text to sports card markets", () => {
  const gate = nlpContextGate(
    "Our co-founders were Green Card holders who built MapmyIndia in India and now hire Indian engineers",
    "UFC 328: Jeremy Stephens vs. King Green (Lightweight, Main Card)"
  );

  assert.equal(gate.pass, false, gate.details);
  assert.equal(gate.meaningfulNouns, 0, gate.details);
  assert.ok(/meaningful=\[\]/.test(gate.details), gate.details);
});
