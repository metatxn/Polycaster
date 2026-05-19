import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeUserPositions,
  sumPositionField,
} from "./user-position-summary.ts";

test("sums position monetary fields with decimal arithmetic", () => {
  assert.equal(
    sumPositionField(
      [{ currentValue: 0.1 }, { currentValue: 0.2 }, { currentValue: null }],
      "currentValue"
    ),
    0.3
  );
});

test("summarizes user position totals without floating point drift", () => {
  assert.deepEqual(
    summarizeUserPositions([
      { currentValue: 0.1, cashPnl: 0.2, realizedPnl: 0.3 },
      { currentValue: 0.2, cashPnl: 0.1, realizedPnl: 0.4 },
    ]),
    {
      totalValue: 0.3,
      totalUnrealizedPnl: 0.3,
      totalRealizedPnl: 0.7,
      totalPnl: 1,
      positionCount: 2,
    }
  );
});
