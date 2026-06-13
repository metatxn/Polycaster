import assert from "node:assert/strict";
import { test } from "vitest";

import {
  clampStake,
  STREAM_STAKE_STEP,
  stepStake,
} from "../../src/content/trading/stream-bet-logic";

test("STREAM_STAKE_STEP is $1", () => {
  assert.equal(STREAM_STAKE_STEP, 1);
});

test("clampStake floors at the minimum", () => {
  assert.equal(clampStake(0), 1);
  assert.equal(clampStake(-5), 1);
});

test("clampStake rounds to whole dollars", () => {
  assert.equal(clampStake(3.4), 3);
  assert.equal(clampStake(3.6), 4);
});

test("clampStake caps at the floored balance ceiling when funded", () => {
  assert.equal(clampStake(10, 1, 3.5), 3); // floor(3.5) = 3
  assert.equal(clampStake(10, 1, 0), 10); // max 0 => no ceiling
});

test("clampStake never returns below min even when balance < min", () => {
  assert.equal(clampStake(10, 1, 0.4), 1);
});

test("stepStake moves by one dollar and clamps", () => {
  assert.equal(stepStake(5, 1), 6);
  assert.equal(stepStake(5, -1), 4);
  assert.equal(stepStake(1, -1), 1); // already at floor
  assert.equal(stepStake(3, 1, 1, 3), 3); // at ceiling
});
