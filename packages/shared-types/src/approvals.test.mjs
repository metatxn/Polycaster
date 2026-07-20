import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, erc20Abi, maxUint256 } from "viem";
import {
  buildClobOrderApprovalTransactions,
  buildTradingApprovalTransactions,
  isClobOrderApproved,
} from "./approvals.ts";
import {
  COLLATERAL_ONRAMP_ADDRESS,
  CTF_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  PUSD_ADDRESS,
  USDC_E_ADDRESS,
} from "./contracts.ts";

const SET_APPROVAL_FOR_ALL_ABI = [
  {
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    name: "setApprovalForAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

function decodeErc1155Approval(tx) {
  return decodeFunctionData({
    abi: SET_APPROVAL_FOR_ALL_ABI,
    data: tx.data,
  });
}

function missingApprovalStatus() {
  return {
    pusdCtf: false,
    pusdCtfExchange: false,
    pusdNegRiskExchange: false,
    pusdCtfCollateralAdapter: false,
    pusdNegRiskCtfCollateralAdapter: false,
    usdcOnramp: false,
    ctfExchangeApproval: false,
    ctfNegRiskExchangeApproval: false,
    ctfCollateralAdapterApproval: false,
    ctfNegRiskCollateralAdapterApproval: false,
    allApproved: false,
    clobTradingApproved: false,
    autoWrapApproved: false,
    ctfOperationsApproved: false,
    negRiskConversionApproved: false,
  };
}

function decodeErc20Approval(tx) {
  return decodeFunctionData({
    abi: erc20Abi,
    data: tx.data,
  });
}

test("neg-risk BUY approval readiness ignores unrelated global setup approvals", () => {
  const status = {
    ...missingApprovalStatus(),
    pusdNegRiskExchange: true,
    pusdNegRiskCtfCollateralAdapter: true,
    // The standing onramp allowance is zeroed by every auto-wrap (the wrap
    // batch self-approves the exact amount), so BUY readiness must not
    // require it — otherwise the approval gate re-fails after every
    // wrap-funded BUY.
    usdcOnramp: false,
  };

  assert.equal(status.allApproved, false);
  assert.equal(
    isClobOrderApproved(status, {
      side: "BUY",
      negRisk: true,
    }),
    true
  );
});

test("neg-risk BUY scoped approvals never grant the self-approving onramp allowance", () => {
  const status = {
    ...missingApprovalStatus(),
    pusdNegRiskExchange: true,
    pusdNegRiskCtfCollateralAdapter: true,
    usdcOnramp: false,
  };

  const transactions = buildClobOrderApprovalTransactions(status, {
    side: "BUY",
    negRisk: true,
  });

  // The auto-wrap batch carries its own exact approve; a per-order standing
  // grant would only add an extra signature that the next wrap zeroes anyway.
  assert.equal(transactions.length, 0);
});

test("neg-risk SELL readiness requires both exchange and adapter operator approvals", () => {
  // clobTradingApproved requires ctfNegRiskCollateralAdapterApproval; the
  // per-order path must apply the same rule or a neg-risk SELL (e.g.
  // transferred-in tokens) passes the gate and fails at settlement.
  const exchangeOnly = {
    ...missingApprovalStatus(),
    ctfNegRiskExchangeApproval: true,
  };
  assert.equal(
    isClobOrderApproved(exchangeOnly, { side: "SELL", negRisk: true }),
    false
  );

  const both = {
    ...exchangeOnly,
    ctfNegRiskCollateralAdapterApproval: true,
  };
  assert.equal(
    isClobOrderApproved(both, { side: "SELL", negRisk: true }),
    true
  );

  // Non-neg-risk SELL is unchanged: the CTF exchange approval alone suffices.
  const standard = {
    ...missingApprovalStatus(),
    ctfExchangeApproval: true,
  };
  assert.equal(
    isClobOrderApproved(standard, { side: "SELL", negRisk: false }),
    true
  );
});

test("neg-risk SELL scoped approvals grant the missing NegRiskCtfCollateralAdapter operator approval", () => {
  const exchangeOnly = {
    ...missingApprovalStatus(),
    ctfNegRiskExchangeApproval: true,
  };
  const adapterOnlyTxns = buildClobOrderApprovalTransactions(exchangeOnly, {
    side: "SELL",
    negRisk: true,
  });
  assert.equal(adapterOnlyTxns.length, 1);
  assert.equal(adapterOnlyTxns[0].to, CTF_ADDRESS);
  const adapterDecoded = decodeErc1155Approval(adapterOnlyTxns[0]);
  assert.equal(adapterDecoded.args[0], NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS);
  assert.equal(adapterDecoded.args[1], true);

  const bothMissingTxns = buildClobOrderApprovalTransactions(
    missingApprovalStatus(),
    { side: "SELL", negRisk: true }
  );
  const operators = bothMissingTxns.map(
    (tx) => decodeErc1155Approval(tx).args[0]
  );
  assert.deepEqual(
    [...operators].sort(),
    [
      NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS,
      NEG_RISK_CTF_EXCHANGE_ADDRESS,
    ].sort()
  );
});

test("trading approval batch uses MaxUint256 for pUSD exchange approvals", () => {
  const requestedAmountRaw = 5_000_000n;
  const transactions = buildTradingApprovalTransactions(
    missingApprovalStatus(),
    requestedAmountRaw
  );

  const erc20Approvals = transactions
    .filter((tx) => tx.to === PUSD_ADDRESS || tx.to === USDC_E_ADDRESS)
    .map((tx) => ({
      token: tx.to,
      decoded: decodeErc20Approval(tx),
    }));

  const ctfExchangeApproval = erc20Approvals.find(
    ({ token, decoded }) =>
      token === PUSD_ADDRESS && decoded.args[0] === CTF_EXCHANGE_ADDRESS
  );
  const negRiskExchangeApproval = erc20Approvals.find(
    ({ token, decoded }) =>
      token === PUSD_ADDRESS &&
      decoded.args[0] === NEG_RISK_CTF_EXCHANGE_ADDRESS
  );
  const negRiskAdapterApproval = erc20Approvals.find(
    ({ token, decoded }) =>
      token === PUSD_ADDRESS &&
      decoded.args[0] === NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS
  );
  const usdcOnrampApproval = erc20Approvals.find(
    ({ token, decoded }) =>
      token === USDC_E_ADDRESS && decoded.args[0] === COLLATERAL_ONRAMP_ADDRESS
  );

  assert.equal(ctfExchangeApproval?.decoded.args[1], maxUint256);
  assert.equal(negRiskExchangeApproval?.decoded.args[1], maxUint256);
  assert.equal(negRiskAdapterApproval?.decoded.args[1], maxUint256);
  assert.equal(usdcOnrampApproval?.decoded.args[1], requestedAmountRaw);
});
