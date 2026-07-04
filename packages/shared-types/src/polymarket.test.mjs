import assert from "node:assert/strict";
import test from "node:test";
import { resolvePreferredTradingWalletMode } from "./polymarket.ts";

test("prefers safe mode whenever the legacy Safe is deployed", () => {
  assert.equal(
    resolvePreferredTradingWalletMode({
      storedMode: "deposit",
      legacySafeDeployed: true,
    }),
    "safe"
  );
});

test("uses deposit mode when no legacy Safe is deployed", () => {
  assert.equal(
    resolvePreferredTradingWalletMode({
      storedMode: "safe",
      legacySafeDeployed: false,
    }),
    "deposit"
  );
});
