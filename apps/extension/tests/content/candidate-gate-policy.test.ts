import assert from "node:assert/strict";
import { test } from "vitest";
import { KalshiPlatformAdapter } from "../../src/content/platforms/kalshi-website";
import { ManifoldMarketsAdapter } from "../../src/content/platforms/manifold-markets";

test("short market-question adapters select the calibrated gate policy", () => {
  assert.equal(
    KalshiPlatformAdapter.candidateGatePolicy,
    "short-market-question"
  );
  assert.equal(
    ManifoldMarketsAdapter.candidateGatePolicy,
    "short-market-question"
  );
});
