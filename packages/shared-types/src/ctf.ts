/**
 * Conditional Token Framework (CTF) constants and ABIs.
 *
 * Used by both the web app (via viem/wagmi) and the Chrome extension (via viem).
 * ABIs are in human-readable and JSON formats for viem consumers.
 *
 * Reference: https://docs.polymarket.com/developers/CTF/overview
 */

import {
  type Address,
  encodeFunctionData,
  type Hex,
  type PublicClient,
} from "viem";
import {
  type ApprovalTransaction,
  buildCtfCollateralApprovalTransaction,
  buildErc1155ApprovalTransaction,
  readErc20Allowance,
  readErc1155Approval,
} from "./approvals.ts";
import {
  CTF_ADDRESS,
  CTF_COLLATERAL_ADAPTER_ADDRESS,
  NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS,
  PUSD_ADDRESS,
} from "./contracts.ts";
import { parsePusdUnits } from "./trading.ts";

/** Parent collection ID — always bytes32(0) for Polymarket */
export const PARENT_COLLECTION_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

/** Binary partition: [1, 2] for YES (0b01) and NO (0b10) outcome slots */
export const BINARY_PARTITION = [1, 2] as const;

/** BigInt variant for viem/wagmi consumers */
export const BINARY_PARTITION_BIGINT = [BigInt(1), BigInt(2)] as const;

// ── Human-readable ABIs ──

export const ERC20_BALANCE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
] as const;

export const ERC20_ALLOWANCE_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
] as const;

export const CTF_SPLIT_ABI = [
  "function splitPosition(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)",
] as const;

export const CTF_MERGE_ABI = [
  "function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)",
] as const;

export const CTF_REDEEM_ABI = [
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
] as const;

export const CTF_BALANCE_BATCH_ABI = [
  "function balanceOfBatch(address[] owners, uint256[] ids) view returns (uint256[])",
] as const;

// ── JSON ABIs (viem-compatible) ──

export const CTF_JSON_ABI = [
  {
    name: "splitPosition",
    type: "function",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "partition", type: "uint256[]" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "mergePositions",
    type: "function",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "partition", type: "uint256[]" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "redeemPositions",
    type: "function",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "balanceOfBatch",
    type: "function",
    inputs: [
      { name: "owners", type: "address[]" },
      { name: "ids", type: "uint256[]" },
    ],
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
  },
] as const;

export const ERC20_JSON_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export type CtfOperationName =
  | "splitPosition"
  | "mergePositions"
  | "redeemPositions";
export type CtfAmountOperationName = Extract<
  CtfOperationName,
  "splitPosition" | "mergePositions"
>;

type CtfPusdAmountInput = Parameters<typeof parsePusdUnits>[0];

export type CtfOperationTransactionInput =
  | {
      operation: "splitPosition" | "mergePositions";
      conditionId: Hex;
      amountRaw: bigint;
      negRisk?: boolean;
    }
  | {
      operation: "redeemPositions";
      conditionId: Hex;
      negRisk?: boolean;
    };

export interface CtfOperationTransaction {
  to: Address;
  data: Hex;
  value: "0";
}

export interface CtfOutcomeBalances {
  yesBalance: bigint;
  noBalance: bigint;
  minBalance: bigint;
}

export type CtfOperationTransactionPlanInput =
  | {
      operation: CtfAmountOperationName;
      conditionId: Hex | string;
      amount?: CtfPusdAmountInput;
      amountRaw?: bigint;
      negRisk?: boolean;
    }
  | {
      operation: "redeemPositions";
      conditionId: Hex | string;
      negRisk?: boolean;
    };

export interface CtfCollateralApprovalRequirement {
  spender: Address;
  amountRaw: bigint;
}

export interface CtfOperationTransactionPlan {
  operation: CtfOperationName;
  conditionId: Hex;
  amountRaw?: bigint;
  transaction: CtfOperationTransaction;
  collateralApproval: CtfCollateralApprovalRequirement | null;
}

export type CtfOperationTransactionsPlanInput =
  CtfOperationTransactionPlanInput & {
    client?: PublicClient;
    collateralOwner?: Address;
    fallbackToApproval?: boolean;
  };

export interface CtfOperationTransactionsPlan
  extends CtfOperationTransactionPlan {
  approvalTransaction: ApprovalTransaction | null;
  transactions: Array<CtfOperationTransaction | ApprovalTransaction>;
}

export function getCtfOperationTarget(negRisk?: boolean): Address {
  return (
    negRisk
      ? NEG_RISK_CTF_COLLATERAL_ADAPTER_ADDRESS
      : CTF_COLLATERAL_ADAPTER_ADDRESS
  ) as Address;
}

export function encodeCtfSplitPositionCalldata(
  conditionId: Hex,
  amountRaw: bigint
): Hex {
  return encodeFunctionData({
    abi: CTF_JSON_ABI,
    functionName: "splitPosition",
    args: [
      PUSD_ADDRESS,
      PARENT_COLLECTION_ID,
      conditionId,
      [...BINARY_PARTITION_BIGINT],
      amountRaw,
    ],
  });
}

export function buildCtfOperationTransaction(
  input: CtfOperationTransactionInput
): CtfOperationTransaction {
  const to = getCtfOperationTarget(input.negRisk);
  switch (input.operation) {
    case "splitPosition":
      return {
        to,
        data: encodeCtfSplitPositionCalldata(
          input.conditionId,
          input.amountRaw
        ),
        value: "0",
      };
    case "mergePositions":
      return {
        to,
        data: encodeCtfMergePositionsCalldata(
          input.conditionId,
          input.amountRaw
        ),
        value: "0",
      };
    case "redeemPositions":
      return {
        to,
        data: encodeCtfRedeemPositionsCalldata(input.conditionId),
        value: "0",
      };
  }
}

function normalizeCtfConditionId(conditionId: Hex | string): Hex {
  return conditionId as Hex;
}

function resolveCtfAmountRaw(input: {
  amount?: CtfPusdAmountInput;
  amountRaw?: bigint;
}): bigint {
  if (input.amountRaw !== undefined) return input.amountRaw;
  if (input.amount !== undefined) return parsePusdUnits(input.amount);
  throw new Error("CTF operation amount is required");
}

export function planCtfOperationTransaction(
  input: CtfOperationTransactionPlanInput
): CtfOperationTransactionPlan {
  const conditionId = normalizeCtfConditionId(input.conditionId);

  if (input.operation === "redeemPositions") {
    return {
      operation: input.operation,
      conditionId,
      transaction: buildCtfOperationTransaction({
        operation: input.operation,
        conditionId,
        negRisk: input.negRisk,
      }),
      collateralApproval: null,
    };
  }

  const amountRaw = resolveCtfAmountRaw(input);
  const transaction = buildCtfOperationTransaction({
    operation: input.operation,
    conditionId,
    amountRaw,
    negRisk: input.negRisk,
  });

  return {
    operation: input.operation,
    conditionId,
    amountRaw,
    transaction,
    collateralApproval:
      input.operation === "splitPosition"
        ? { spender: transaction.to, amountRaw }
        : null,
  };
}

export async function planCtfOperationTransactions(
  input: CtfOperationTransactionsPlanInput
): Promise<CtfOperationTransactionsPlan> {
  const plan = planCtfOperationTransaction(input);
  let approvalTransaction: ApprovalTransaction | null = null;

  if (plan.collateralApproval && (input.client || input.collateralOwner)) {
    if (!input.client || !input.collateralOwner) {
      throw new Error(
        "CTF collateral approval planning requires both client and owner"
      );
    }
    approvalTransaction = await buildCtfCollateralApprovalIfNeeded(
      input.client,
      input.collateralOwner,
      plan.collateralApproval.spender,
      plan.collateralApproval.amountRaw,
      { fallbackToApproval: input.fallbackToApproval }
    );
  }

  if (
    !approvalTransaction &&
    plan.operation !== "splitPosition" &&
    input.client &&
    input.collateralOwner
  ) {
    // Same degrade rule as the ERC20 collateral path above: with
    // fallbackToApproval set, a failed read plans the idempotent approval
    // instead of failing the whole operation.
    const approved = await readErc1155Approval(
      input.client,
      input.collateralOwner,
      plan.transaction.to,
      input.fallbackToApproval ? { fallbackApproved: false } : {}
    );
    if (!approved) {
      approvalTransaction = buildErc1155ApprovalTransaction(
        plan.transaction.to
      );
    }
  }

  return {
    ...plan,
    approvalTransaction,
    transactions: approvalTransaction
      ? [approvalTransaction, plan.transaction]
      : [plan.transaction],
  };
}

export async function readCtfOutcomeBalances(
  client: PublicClient,
  owner: Address,
  yesTokenId: string | bigint,
  noTokenId: string | bigint
): Promise<CtfOutcomeBalances> {
  const balances = (await client.readContract({
    address: CTF_ADDRESS as Address,
    abi: CTF_JSON_ABI,
    functionName: "balanceOfBatch",
    args: [
      [owner, owner],
      [BigInt(yesTokenId), BigInt(noTokenId)],
    ],
  })) as [bigint, bigint];

  const [yesBalance, noBalance] = balances;
  return {
    yesBalance,
    noBalance,
    minBalance: yesBalance < noBalance ? yesBalance : noBalance,
  };
}

export async function readCtfCollateralAllowance(
  client: PublicClient,
  owner: Address,
  spender: Address
): Promise<bigint> {
  return readErc20Allowance(client, owner, spender);
}

export async function buildCtfCollateralApprovalIfNeeded(
  client: PublicClient,
  owner: Address,
  spender: Address,
  amountRaw: bigint,
  options: { fallbackToApproval?: boolean } = {}
): Promise<ApprovalTransaction | null> {
  let allowance: bigint;
  try {
    allowance = await readCtfCollateralAllowance(client, owner, spender);
  } catch (err) {
    if (!options.fallbackToApproval) throw err;
    allowance = BigInt(0);
  }

  if (allowance >= amountRaw) return null;
  return buildCtfCollateralApprovalTransaction(spender, amountRaw);
}

export function encodeCtfMergePositionsCalldata(
  conditionId: Hex,
  amountRaw: bigint
): Hex {
  return encodeFunctionData({
    abi: CTF_JSON_ABI,
    functionName: "mergePositions",
    args: [
      PUSD_ADDRESS,
      PARENT_COLLECTION_ID,
      conditionId,
      [...BINARY_PARTITION_BIGINT],
      amountRaw,
    ],
  });
}

export function encodeCtfRedeemPositionsCalldata(conditionId: Hex): Hex {
  return encodeFunctionData({
    abi: CTF_JSON_ABI,
    functionName: "redeemPositions",
    args: [
      PUSD_ADDRESS,
      PARENT_COLLECTION_ID,
      conditionId,
      [...BINARY_PARTITION_BIGINT],
    ],
  });
}
