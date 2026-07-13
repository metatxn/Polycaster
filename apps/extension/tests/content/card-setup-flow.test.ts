import assert from "node:assert/strict";
import { test } from "vitest";

import { cardSetupFlow } from "../../src/content/trading/setup-flow";
import type { TradingContext } from "../../src/content/trading/trading-service";

// A connected, deployed, approved, credentialed, funded card context.
const base: TradingContext = {
  state: "ready",
  address: "0x0000000000000000000000000000000000000001",
  proxyAddress: "0x0000000000000000000000000000000000000002",
  walletMode: "deposit",
  legacySafeAvailable: false,
  isDeployed: true,
  pusdBalance: 0,
  usdcEBalance: 0,
  balance: 10,
  polBalance: 0,
  tokenBalances: [],
  hasCredentials: true,
  error: null,
  orderBook: null,
  orderBookTokenId: null,
  orderBookError: null,
  minOrderSize: 0,
  tickSize: 0,
  hasTradingApproval: true,
  usdcAllowance: 100,
  usdcAllowanceNegRisk: 100,
  approvalReadStatus: "complete",
};

test("card maps a deployed, approved, credentialed, funded ctx to complete", () => {
  assert.equal(cardSetupFlow({ ...base }).isComplete, true);
});

test("card maps an undeployed ctx to the vault step", () => {
  assert.equal(
    cardSetupFlow({ ...base, isDeployed: false }).currentStepId,
    "vault"
  );
});

test("card maps zero allowance to the approve step", () => {
  assert.equal(
    cardSetupFlow({
      ...base,
      hasTradingApproval: false,
      usdcAllowance: 0,
      usdcAllowanceNegRisk: 0,
    }).currentStepId,
    "approve"
  );
});

test("card uses full setup approval status when scalar allowance cache is stale", () => {
  assert.equal(
    cardSetupFlow({
      ...base,
      hasTradingApproval: true,
      usdcAllowance: 0,
      usdcAllowanceNegRisk: 0,
    }).isComplete,
    true
  );
});

test("card ignores stale scalar allowance caches when setup approval is incomplete", () => {
  assert.equal(
    cardSetupFlow({
      ...base,
      hasTradingApproval: false,
      usdcAllowance: 100,
      usdcAllowanceNegRisk: 100,
    }).currentStepId,
    "approve"
  );
});

test("card treats deployed, approved, credentialed users as complete even with zero cash", () => {
  const flow = cardSetupFlow({ ...base, balance: 0 });
  assert.equal(flow.currentStepId, null);
  assert.equal(flow.isComplete, true);
  assert.equal(
    flow.steps.some((step) => step.id === "funds"),
    false
  );
});
