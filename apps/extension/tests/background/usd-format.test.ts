import assert from "node:assert/strict";
import { test } from "vitest";
import { formatUsd6 } from "../../src/background/usd-format";

test("formatUsd6 formats whole-dollar raw amounts", () => {
  assert.equal(formatUsd6(1_000_000n), "$1.00");
  assert.equal(formatUsd6(0n), "$0.00");
});

test("formatUsd6 rounds to cents half-up", () => {
  assert.equal(formatUsd6(123_456_789n), "$123.46");
  // Float math turns 1.005 into 1.00499..., which truncates to $1.00.
  assert.equal(formatUsd6(1_005_000n), "$1.01");
});

test("formatUsd6 stays exact beyond double precision", () => {
  assert.equal(formatUsd6(9_007_199_254_740_993n), "$9007199254.74");
});
