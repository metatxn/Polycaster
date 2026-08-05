import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLimitPrice } from "./slippage.ts";

/** How many decimals the SDK's `decimalPlaces()` would count on this number. */
function decimalPlaces(value) {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

test("a limit price stepped through cents stays on the tick grid", () => {
  // The ticket edits the price in cents: `price * 100`, `± tickCents`, `/ 100`.
  // Each of those float round-trips leaves IEEE-754 residue, so stepping down
  // from 10.0¢ on a 0.001-tick market lands on 0.09500000000000001 — which the
  // UI renders as "9.5¢" and the SDK rejects with "Price must conform to tick
  // size 0.001 with at most 3 decimal places."
  const tickSize = 0.001;
  const tickCents = tickSize * 100;
  let price = 0.1;

  for (let step = 0; step < 20; step++) {
    const cents = price * 100;
    price = normalizeLimitPrice((cents - tickCents) / 100, tickSize);
    assert.ok(
      decimalPlaces(price) <= 3,
      `step ${step}: ${price} has ${decimalPlaces(price)} decimals`
    );
  }
});

test("the raw drifted value the ticket produced is snapped back", () => {
  assert.equal(normalizeLimitPrice(0.09500000000000001, 0.001), 0.095);
  assert.equal(normalizeLimitPrice(0.09700000000000002, 0.001), 0.097);
  assert.equal(
    decimalPlaces(normalizeLimitPrice(0.09500000000000001, 0.001)),
    3
  );
});

test("off-grid prices snap to the nearest tick", () => {
  assert.equal(normalizeLimitPrice(0.0956, 0.001), 0.096);
  assert.equal(normalizeLimitPrice(0.0954, 0.001), 0.095);
  assert.equal(normalizeLimitPrice(0.567, 0.01), 0.57);
  assert.equal(normalizeLimitPrice(0.5, 0.1), 0.5);
});

test("prices clamp to the band the SDK accepts for the tick", () => {
  // `resolvePrice` rejects anything outside [tick, 1 - tick], and the bound
  // moves with the tick — clamping to a fixed 0.1¢..99.9¢ would sign an
  // off-band price on a 1¢ market.
  assert.equal(normalizeLimitPrice(0, 0.01), 0.01);
  assert.equal(normalizeLimitPrice(-5, 0.01), 0.01);
  assert.equal(normalizeLimitPrice(1, 0.01), 0.99);
  assert.equal(normalizeLimitPrice(0.9999, 0.001), 0.999);
  assert.equal(normalizeLimitPrice(0.0001, 0.001), 0.001);
});

test("a missing or nonsensical tick falls back to a cent", () => {
  // 0.01 is a whole multiple of every tick Polymarket uses except 0.1, so it
  // is the safest guess when the book has not loaded yet.
  assert.equal(normalizeLimitPrice(0.5, Number.NaN), 0.5);
  assert.equal(normalizeLimitPrice(0.5, 0), 0.5);
  assert.equal(normalizeLimitPrice(0.567, -1), 0.57);
  assert.equal(normalizeLimitPrice(Number.NaN, 0.01), 0.01);
});
