import assert from "node:assert/strict";
import test from "node:test";
import { isTennisSetScore, parseSportsScore } from "./sports-score-format.ts";

test("parses regular two-sided scores", () => {
  assert.deepEqual(parseSportsScore("74-84"), ["74", "84"]);
});

test("parses esports pipe-delimited series scores", () => {
  assert.deepEqual(parseSportsScore("000-000|1-0|Bo3"), ["1", "0"]);
});

test("formats tennis set scores per player", () => {
  assert.deepEqual(parseSportsScore("6-4, 3-6, 2-2"), ["6 3 2", "4 6 2"]);
});

test("preserves tennis tiebreak points compactly", () => {
  assert.deepEqual(parseSportsScore("7-6(11-9), 4-6, 0-0"), [
    "7(11) 4 0",
    "6(9) 6 0",
  ]);
});

test("identifies tennis set scores for expanded mobile layout", () => {
  assert.equal(isTennisSetScore("7-6(11-9), 4-6, 0-0"), true);
  assert.equal(isTennisSetScore("74-84"), false);
  assert.equal(isTennisSetScore("000-000|1-0|Bo3"), false);
});
