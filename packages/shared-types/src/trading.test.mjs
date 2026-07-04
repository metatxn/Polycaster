import assert from "node:assert/strict";
import test from "node:test";
import { planPusdAutoWrap } from "./trading.ts";

test("auto-wrap does not request an empty wrap for a fee-only shortfall", () => {
  const plan = planPusdAutoWrap({
    pusdBalanceRaw: 3_749_028n,
    usdcEBalanceRaw: 0n,
    requiredPusdRaw: 3_740_000n,
    reservedPusdRaw: 0n,
    estimatedFeeRaw: null,
  });

  assert.equal(plan.availablePusdRaw, 3_749_028n);
  assert.equal(plan.baseShortfallRaw, 0n);
  assert.equal(plan.shortfallRaw, 103_172n);
  assert.equal(plan.wrapAmountRaw, 0n);
  assert.equal(plan.hasEnoughBaseCollateral, true);
  assert.equal(plan.needsWrap, false);
});
