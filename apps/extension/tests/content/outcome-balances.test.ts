import assert from "node:assert/strict";
import { test } from "vitest";
import {
  balanceChanged,
  balanceToNumber,
  formatBalance,
  hasDisplayPosition,
  positionValueUsd,
} from "../../src/content/ui/outcome-balances";

test("balanceToNumber round-trips exact 6-decimal share strings", () => {
  assert.equal(balanceToNumber("10.123456"), 10.123456);
  assert.equal(balanceToNumber("0"), 0);
  assert.equal(balanceToNumber(undefined), 0);
});

test("hasDisplayPosition uses a decimal threshold compare", () => {
  assert.equal(hasDisplayPosition("0.01"), true);
  assert.equal(hasDisplayPosition("0.009999"), false);
  assert.equal(hasDisplayPosition("0"), false);
  assert.equal(hasDisplayPosition(undefined), false);
});

test("formatBalance rounds in decimal, not float", () => {
  assert.equal(formatBalance("10.123456", 1), "10.1");
  // Float toFixed shows 10.005 (= 10.00499... as a double) as "10.00".
  assert.equal(formatBalance("10.005", 2), "10.01");
  assert.equal(formatBalance(undefined, 2), "0.00");
});

test("positionValueUsd multiplies shares by price in decimal", () => {
  assert.equal(positionValueUsd("10.123456", 0.5), "5.06");
  assert.equal(positionValueUsd("0", 0.42), "0.00");
});

test("balanceChanged detects moves beyond the settle epsilon", () => {
  assert.equal(balanceChanged("10.000000", "10.000000"), false);
  assert.equal(balanceChanged("10.000000", "10.001"), false); // not > 0.001
  assert.equal(balanceChanged("10.000000", "10.001001"), true);
  assert.equal(balanceChanged("10.002", "10.000000"), true);
});
