import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateBuyTakerFeeRaw,
  formatFeeUsd,
  planPusdAutoWrap,
} from "./trading.ts";

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

test("missing fee metadata means the fee is unknown, not zero", async () => {
  // `GET /markets/{conditionId}` payloads carry no fee block at all; returning
  // 0n here would quote a free trade and bypass the FALLBACK_FEE_BPS reserve.
  const fee = await estimateBuyTakerFeeRaw(
    { getClobMarketInfo: async () => ({}) },
    "condition-1",
    10,
    0.5,
    "5"
  );

  assert.equal(fee, null);
});

test("malformed fee metadata falls back to unknown, not to a free trade", async () => {
  // A negative rate flows through the curve as a negative fee, and
  // `Decimal.max(0, ...)` would launder that into a confident 0n quote —
  // bypassing the FALLBACK_FEE_BPS reserve. Same for a rate whose exponent is
  // missing or negative: the pair is malformed, so the fee is unknown.
  const payloads = [
    { fd: { r: "-1", e: "1" } },
    { fd: { r: "0.02" } },
    { fd: { r: "0.02", e: "-1" } },
    { fd: { r: "0.02", e: "not-a-number" } },
  ];

  for (const payload of payloads) {
    const fee = await estimateBuyTakerFeeRaw(
      { getClobMarketInfo: async () => payload },
      "condition-1",
      10,
      0.5,
      "5"
    );

    assert.equal(fee, null, JSON.stringify(payload));
  }
});

test("an explicit zero fee rate is preserved as a zero fee", async () => {
  // At a zero rate the exponent cannot change the answer, so `r: "0"` with no
  // `e` is the one incomplete pair that still reads as a real (zero) fee.
  for (const payload of [{ fd: { r: "0", e: "1" } }, { fd: { r: "0" } }]) {
    const fee = await estimateBuyTakerFeeRaw(
      { getClobMarketInfo: async () => payload },
      "condition-1",
      10,
      0.5,
      "5"
    );

    assert.equal(fee, 0n, JSON.stringify(payload));
  }
});

test("a malformed wire builder fee is unknown, not zero", async () => {
  // `tbf` present but negative or garbage: the builder component can't be
  // read, so the whole quote is unknown — quoting "protocol fee only" would
  // understate the real debit, and a negative bps would offset the protocol
  // fee inside `Decimal.max(0, ...)`.
  for (const tbf of ["-5", "not-a-number"]) {
    const fee = await estimateBuyTakerFeeRaw(
      { getClobMarketInfo: async () => ({ fd: { r: "0.02", e: "1" }, tbf }) },
      "condition-1",
      10,
      0.5,
      "5"
    );

    assert.equal(fee, null, tbf);
  }
});

test("an absent wire builder fee reads as no builder attribution", async () => {
  // No `tbf` spelling at all is the normal case (the unified SDK's parsed
  // market info drops it): protocol fee only, not "unknown".
  const fee = await estimateBuyTakerFeeRaw(
    { getClobMarketInfo: async () => ({ fd: { r: "0.02", e: "1" } }) },
    "condition-1",
    10,
    0.5,
    "5"
  );

  // 10 shares × 0.02 × (0.5 × 0.5)^1 = $0.05 → 50_000 raw pUSD units.
  assert.equal(fee, 50_000n);
});

test("a malformed fetched builder rate is unknown, not zero", async () => {
  // Reviewer-reproduced case: a negative fetched taker rate flowed through
  // `Decimal.max(0, ...)` as a confident 0n, bypassing the fallback reserve.
  for (const taker of [-0.005, Number.NaN]) {
    const fee = await estimateBuyTakerFeeRaw(
      { getClobMarketInfo: async () => ({ fd: { r: "0.02", e: "1" } }) },
      "condition-1",
      10,
      0.5,
      "5",
      {
        builderCode: "0xabc",
        getBuilderFeeRates: async () => ({ maker: 0, taker }),
      }
    );

    assert.equal(fee, null, String(taker));
  }
});

test("a valid fetched builder rate adds to the protocol fee", async () => {
  const fee = await estimateBuyTakerFeeRaw(
    { getClobMarketInfo: async () => ({ fd: { r: "0.02", e: "1" } }) },
    "condition-1",
    10,
    0.5,
    "5",
    {
      builderCode: "0xabc",
      getBuilderFeeRates: async () => ({ maker: 0, taker: 0.01 }),
    }
  );

  // Protocol $0.05 + builder $5 × 0.01 = $0.10 → 100_000 raw pUSD units.
  assert.equal(fee, 100_000n);
});

test("a sub-cent fee renders as a floor, not as free", () => {
  // $0.004 would round to "$0.00", which reads as "no fee" rather than
  // "too small to show".
  assert.equal(formatFeeUsd(0.004), "<$0.01");
  assert.equal(formatFeeUsd(0), "$0.00");
  assert.equal(formatFeeUsd(0.0125), "$0.01");
  assert.equal(formatFeeUsd(1.239), "$1.24");
});
