import assert from "node:assert/strict";
import { test } from "vitest";
import {
  bm25Score,
  stableLexicalScore,
  tokenizeLexicalText,
} from "../../src/background/nlp";

test("lexical tokenization preserves tickers, amounts, percentages, signed thresholds, and dates", () => {
  assert.deepEqual(
    tokenizeLexicalText(
      "$TSLA must gain +5% and pass $100k by 2027-06-30 for @macro_desk"
    ),
    [
      "$tsla",
      "must",
      "gain",
      "+5%",
      "and",
      "pass",
      "$100k",
      "by",
      "2027-06-30",
      "for",
      "@macro_desk",
    ]
  );
});

test("stable lexical scoring applies the same normalization to queries and documents", () => {
  const scores = stableLexicalScore("$TSLA above 5% by 2027-06-30", [
    "$tsla closes above 5% on 2027-06-30",
    "TSLA closes above five percent next summer",
  ]);

  assert.ok(scores[0] > scores[1]);
  assert.ok(scores[0] > 0);
  assert.ok(scores[0] < 1);
});

test("a candidate stable lexical feature is unchanged when other candidates are added", () => {
  const query = "Federal Reserve June rate decision";
  const candidate = "Federal Reserve rate decision in June";
  const baseline = stableLexicalScore(query, [candidate])[0];
  const expanded = stableLexicalScore(query, [
    candidate,
    "Federal Reserve Federal Reserve June June rate rate decision decision",
    "World Cup winner in 2026",
  ])[0];

  assert.equal(expanded, baseline);
});

test("production BM25 retains the prior candidate-pool normalization", () => {
  const query = "Federal Reserve June rate decision";
  const candidate = "Federal Reserve rate decision in June";
  const baseline = bm25Score(query, [candidate])[0];
  const expanded = bm25Score(query, [
    candidate,
    "Federal Reserve Federal Reserve June June rate rate decision decision",
  ])[0];

  assert.equal(baseline, 1);
  assert.ok(expanded < baseline);
});
