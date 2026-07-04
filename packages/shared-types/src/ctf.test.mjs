import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData } from "viem";
import {
  CTF_ADDRESS,
  NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS,
} from "./contracts.ts";
import { planCtfOperationTransactions } from "./ctf.ts";

const owner = "0x0000000000000000000000000000000000000001";
const conditionId =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const erc1155SetApprovalAbi = [
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

function clientWithCtfApproval(approved) {
  const calls = [];
  return {
    calls,
    async readContract(call) {
      calls.push(call);
      assert.equal(call.address, CTF_ADDRESS);
      assert.equal(call.functionName, "isApprovedForAll");
      assert.deepEqual(call.args, [
        owner,
        NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS,
      ]);
      return approved;
    },
  };
}

test("redeem plans neg-risk collateral adapter approval when missing", async () => {
  const client = clientWithCtfApproval(false);

  const plan = await planCtfOperationTransactions({
    operation: "redeemPositions",
    conditionId,
    negRisk: true,
    client,
    collateralOwner: owner,
  });

  assert.equal(client.calls.length, 1);
  assert.equal(plan.approvalTransaction?.to, CTF_ADDRESS);
  assert.equal(plan.transactions.length, 2);
  assert.equal(plan.transactions[0], plan.approvalTransaction);
  assert.equal(plan.transactions[1], plan.transaction);

  const decoded = decodeFunctionData({
    abi: erc1155SetApprovalAbi,
    data: plan.approvalTransaction.data,
  });
  assert.equal(decoded.functionName, "setApprovalForAll");
  assert.deepEqual(decoded.args, [
    NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS,
    true,
  ]);
});

test("redeem skips collateral adapter approval when already approved", async () => {
  const client = clientWithCtfApproval(true);

  const plan = await planCtfOperationTransactions({
    operation: "redeemPositions",
    conditionId,
    negRisk: true,
    client,
    collateralOwner: owner,
  });

  assert.equal(client.calls.length, 1);
  assert.equal(plan.approvalTransaction, null);
  assert.deepEqual(plan.transactions, [plan.transaction]);
});

function clientWithFailingReads() {
  return {
    async readContract() {
      throw new Error("rpc unavailable");
    },
  };
}

test("erc1155 preflight degrades to the idempotent approval when fallbackToApproval is set", async () => {
  // Mirrors the ERC20 collateral path: a failed read with the flag set plans
  // the (idempotent) approval instead of failing the whole operation.
  const plan = await planCtfOperationTransactions({
    operation: "redeemPositions",
    conditionId,
    negRisk: true,
    client: clientWithFailingReads(),
    collateralOwner: owner,
    fallbackToApproval: true,
  });

  assert.equal(plan.approvalTransaction?.to, CTF_ADDRESS);
  assert.equal(plan.transactions.length, 2);
  const decoded = decodeFunctionData({
    abi: erc1155SetApprovalAbi,
    data: plan.approvalTransaction.data,
  });
  assert.deepEqual(decoded.args, [
    NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS,
    true,
  ]);
});

test("erc1155 preflight still fails closed without fallbackToApproval", async () => {
  await assert.rejects(
    planCtfOperationTransactions({
      operation: "redeemPositions",
      conditionId,
      negRisk: true,
      client: clientWithFailingReads(),
      collateralOwner: owner,
    }),
    /rpc unavailable/
  );
});
