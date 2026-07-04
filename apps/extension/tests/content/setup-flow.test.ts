import assert from "node:assert/strict";
import {
  COLLATERAL_ONRAMP_ADDRESS,
  CTF_COLLATERAL_ADAPTER_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  PUSD_CTF_APPROVAL_TARGET,
} from "@knoww/shared-types/contracts";
import { test } from "vitest";

import {
  deriveSetupFlow,
  deriveTradingSetupApprovalStatus,
  isApprovalSufficientForSetup,
  isSetupApprovalReadKnown,
  isSetupCompletionUnknownFromDegradedRead,
  isWithinDegradedSetupTrustWindow,
  resolveSetupSurfaceMode,
  SETUP_APPROVAL_DEFAULT,
  SETUP_DEGRADED_LATCH_TRUST_LIMIT,
  type SetupFlowState,
} from "../../src/content/trading/setup-flow";

const complete: SetupFlowState = {
  hasSession: true,
  address: "0x0000000000000000000000000000000000000001",
  proxyAddress: "0x0000000000000000000000000000000000000002",
  walletMode: "deposit",
  isDeployed: true,
  hasApproval: true,
  hasCredentials: true,
  cashBalance: 5,
};

test("default approval cap is 100 USDC", () => {
  assert.equal(SETUP_APPROVAL_DEFAULT, "100");
});

test("a fully set-up user has no current step and is complete", () => {
  const flow = deriveSetupFlow(complete);
  assert.equal(flow.isComplete, true);
  assert.equal(flow.currentStepId, null);
  assert.equal(flow.totalSteps, 4);
  assert.equal(flow.currentIndex, flow.totalSteps);
  assert.ok(flow.steps.every((s) => s.status === "done"));
  assert.equal(
    flow.steps.some((s) => s.id === "funds"),
    false
  );
});

test("a brand-new user starts at connect; later steps are locked", () => {
  const flow = deriveSetupFlow({
    ...complete,
    hasSession: false,
    address: null,
  });
  assert.equal(flow.currentStepId, "connect");
  assert.equal(flow.currentIndex, 1);
  assert.equal(flow.steps[0].status, "now");
  assert.ok(flow.steps.slice(1).every((s) => s.status === "pending"));
  assert.equal(flow.isComplete, false);
});

test("deployed vault without approval lands on the approve step", () => {
  const flow = deriveSetupFlow({ ...complete, hasApproval: false });
  assert.equal(flow.currentStepId, "approve");
  assert.equal(flow.steps.find((s) => s.id === "vault")?.status, "done");
  assert.equal(flow.steps.find((s) => s.id === "approve")?.status, "now");
  assert.equal(
    flow.steps.find((s) => s.id === "credentials")?.status,
    "pending"
  );
});

test("credentials cannot be current while the vault is undeployed (gate)", () => {
  const flow = deriveSetupFlow({
    ...complete,
    isDeployed: false,
    hasApproval: false,
    hasCredentials: true, // even if creds somehow exist
  });
  assert.equal(flow.currentStepId, "vault");
});

test("set-up but unfunded user is still complete because funds are not a setup step", () => {
  const flow = deriveSetupFlow({ ...complete, cashBalance: 0 });
  assert.equal(flow.currentStepId, null);
  assert.equal(flow.isComplete, true);
});

test("approval is sufficient only for a positive allowance", () => {
  assert.equal(isApprovalSufficientForSetup(0), false);
  assert.equal(isApprovalSufficientForSetup(0.5), true);
  assert.equal(isApprovalSufficientForSetup(Number.NaN), false);
  assert.equal(isApprovalSufficientForSetup(-1), false);
});

test("shared approval status derives setup completion and order allowances", () => {
  const status = deriveTradingSetupApprovalStatus({
    [`pusd:${PUSD_CTF_APPROVAL_TARGET}`]: 100,
    [`pusd:${CTF_EXCHANGE_ADDRESS}`]: 80,
    [`pusd:${NEG_RISK_CTF_EXCHANGE_ADDRESS}`]: 90,
    [`pusd:${NEG_RISK_ADAPTER_ADDRESS}`]: 45,
    [`usdce:${COLLATERAL_ONRAMP_ADDRESS}`]: 100,
    [`erc1155:${CTF_EXCHANGE_ADDRESS}`]: 1,
    [`erc1155:${NEG_RISK_CTF_EXCHANGE_ADDRESS}`]: 1,
    [`erc1155:${NEG_RISK_ADAPTER_ADDRESS}`]: 1,
  });

  assert.deepEqual(status, {
    hasTradingApproval: true,
    usdcAllowance: 80,
    usdcAllowanceNegRisk: 45,
    allowanceReadStatus: "complete",
  });
});

test("consumed onramp/CTF allowances do not flip setup completion", () => {
  // The USDC.e→onramp and pUSD→CTF allowances are finite and spent to 0 by
  // every auto-wrap/split (each wrap re-approves the exact amount and consumes
  // it), so setup completeness must not key on them — otherwise a fully
  // onboarded user is thrown back into the wizard after their first
  // wrap-funded BUY.
  const status = deriveTradingSetupApprovalStatus({
    [`pusd:${PUSD_CTF_APPROVAL_TARGET}`]: 0,
    [`pusd:${CTF_EXCHANGE_ADDRESS}`]: 80,
    [`pusd:${NEG_RISK_CTF_EXCHANGE_ADDRESS}`]: 90,
    [`pusd:${NEG_RISK_ADAPTER_ADDRESS}`]: 45,
    [`usdce:${COLLATERAL_ONRAMP_ADDRESS}`]: 0,
    [`erc1155:${CTF_EXCHANGE_ADDRESS}`]: 1,
    [`erc1155:${NEG_RISK_CTF_EXCHANGE_ADDRESS}`]: 1,
    [`erc1155:${NEG_RISK_ADAPTER_ADDRESS}`]: 1,
  });

  assert.equal(status.hasTradingApproval, true);
  assert.equal(status.allowanceReadStatus, "complete");
});

test("shared approval status fails closed when required setup approvals are missing", () => {
  const status = deriveTradingSetupApprovalStatus({
    [`pusd:${CTF_EXCHANGE_ADDRESS}`]: 80,
    [`pusd:${NEG_RISK_CTF_EXCHANGE_ADDRESS}`]: 90,
    [`pusd:${NEG_RISK_ADAPTER_ADDRESS}`]: 45,
  });

  assert.deepEqual(status, {
    hasTradingApproval: false,
    usdcAllowance: 80,
    usdcAllowanceNegRisk: 45,
    allowanceReadStatus: "complete",
  });
});

test("shared approval status can mark a partial allowance read as degraded", () => {
  const status = deriveTradingSetupApprovalStatus(
    {
      [`pusd:${CTF_EXCHANGE_ADDRESS}`]: 80,
      [`pusd:${NEG_RISK_CTF_EXCHANGE_ADDRESS}`]: 90,
      [`pusd:${NEG_RISK_ADAPTER_ADDRESS}`]: 45,
    },
    { degraded: true }
  );

  assert.deepEqual(status, {
    hasTradingApproval: false,
    usdcAllowance: 80,
    usdcAllowanceNegRisk: 45,
    allowanceReadStatus: "degraded",
  });
});

test("shared approval status stays complete when only unrelated approval reads degrade", () => {
  const options: {
    degraded?: boolean;
    degradedKeys?: string[];
  } = {
    degraded: true,
    degradedKeys: [`pusd:${CTF_COLLATERAL_ADAPTER_ADDRESS}`],
  };
  const status = deriveTradingSetupApprovalStatus(
    {
      [`pusd:${PUSD_CTF_APPROVAL_TARGET}`]: 100,
      [`pusd:${CTF_EXCHANGE_ADDRESS}`]: 80,
      [`pusd:${NEG_RISK_CTF_EXCHANGE_ADDRESS}`]: 90,
      [`pusd:${NEG_RISK_ADAPTER_ADDRESS}`]: 45,
      [`usdce:${COLLATERAL_ONRAMP_ADDRESS}`]: 100,
      [`erc1155:${CTF_EXCHANGE_ADDRESS}`]: 1,
      [`erc1155:${NEG_RISK_CTF_EXCHANGE_ADDRESS}`]: 1,
      [`erc1155:${NEG_RISK_ADAPTER_ADDRESS}`]: 1,
    },
    options
  );

  assert.deepEqual(status, {
    hasTradingApproval: true,
    usdcAllowance: 80,
    usdcAllowanceNegRisk: 45,
    allowanceReadStatus: "complete",
  });
});

test("surface mode only trusts persisted completion when the live flow is unknown", () => {
  const incomplete = deriveSetupFlow({ ...complete, hasCredentials: false });
  assert.equal(
    resolveSetupSurfaceMode({
      flow: incomplete,
      persistedComplete: true,
      dismissed: false,
      liveCompleteKnown: true,
    }),
    "wizard"
  );
  assert.equal(
    resolveSetupSurfaceMode({
      flow: incomplete,
      persistedComplete: true,
      dismissed: false,
      liveCompleteKnown: false,
    }),
    "complete"
  );
  assert.equal(
    resolveSetupSurfaceMode({
      flow: deriveSetupFlow(complete),
      persistedComplete: false,
      dismissed: false,
      liveCompleteKnown: true,
    }),
    "complete"
  );
  assert.equal(
    resolveSetupSurfaceMode({
      flow: incomplete,
      persistedComplete: false,
      dismissed: true,
      liveCompleteKnown: true,
    }),
    "banner"
  );
  assert.equal(
    resolveSetupSurfaceMode({
      flow: incomplete,
      persistedComplete: false,
      dismissed: false,
      liveCompleteKnown: true,
    }),
    "wizard"
  );
});

test("degraded-read trust window is a single inclusive-count predicate", () => {
  assert.equal(SETUP_DEGRADED_LATCH_TRUST_LIMIT, 3);
  // The count includes the read being judged: reads 1..limit are trusted.
  assert.equal(isWithinDegradedSetupTrustWindow(1), true);
  assert.equal(isWithinDegradedSetupTrustWindow(3), true);
  assert.equal(isWithinDegradedSetupTrustWindow(4), false);
  assert.equal(isWithinDegradedSetupTrustWindow(5), false);
});

test("degraded setup completion is unknown only while a trusted read could still be complete", () => {
  const completeWithAssumedApproval = deriveSetupFlow(complete);
  const incompleteWithAssumedApproval = deriveSetupFlow({
    ...complete,
    hasCredentials: false,
  });

  assert.equal(
    isSetupCompletionUnknownFromDegradedRead({
      consecutiveDegradedReads: 1,
      flowAssumingApproval: completeWithAssumedApproval,
    }),
    true
  );
  assert.equal(
    isSetupCompletionUnknownFromDegradedRead({
      consecutiveDegradedReads: SETUP_DEGRADED_LATCH_TRUST_LIMIT,
      flowAssumingApproval: completeWithAssumedApproval,
    }),
    true
  );
  assert.equal(
    isSetupCompletionUnknownFromDegradedRead({
      consecutiveDegradedReads: SETUP_DEGRADED_LATCH_TRUST_LIMIT + 1,
      flowAssumingApproval: completeWithAssumedApproval,
    }),
    false
  );
  assert.equal(
    isSetupCompletionUnknownFromDegradedRead({
      consecutiveDegradedReads: 1,
      flowAssumingApproval: incompleteWithAssumedApproval,
    }),
    false
  );
});

test("setup approval read known helper treats degraded and initial unknown as not live-known", () => {
  assert.equal(isSetupApprovalReadKnown("complete"), true);
  assert.equal(isSetupApprovalReadKnown("degraded"), false);
  assert.equal(isSetupApprovalReadKnown("unknown"), false);
});
