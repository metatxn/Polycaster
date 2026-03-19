/**
 * Conditional Token Framework (CTF) constants and ABIs.
 *
 * Used by both the web app (via viem/wagmi) and the Chrome extension (via ethers).
 * ABIs are in human-readable format (ethers-compatible) and JSON ABI format (viem-compatible).
 *
 * Reference: https://docs.polymarket.com/developers/CTF/overview
 */

/** Parent collection ID — always bytes32(0) for Polymarket */
export const PARENT_COLLECTION_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

/** Binary partition: [1, 2] for YES (0b01) and NO (0b10) outcome slots */
export const BINARY_PARTITION = [1, 2] as const;

/** BigInt variant for viem/wagmi consumers */
export const BINARY_PARTITION_BIGINT = [BigInt(1), BigInt(2)] as const;

// ── Human-readable ABIs (ethers-compatible) ──

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
