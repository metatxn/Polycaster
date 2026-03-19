/**
 * Token Approval Utilities
 *
 * Functions for checking and managing token approvals required for Polymarket trading.
 *
 * Reference: https://github.com/Polymarket/wagmi-safe-builder-example
 */

import { erc20Abi } from "viem";
import { CONTRACTS } from "@/constants/contracts";
import { getPublicClient } from "@/lib/rpc";

// ERC-1155 ABI for isApprovedForAll
const ERC1155_ABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    name: "isApprovedForAll",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Minimum allowance threshold (1 million USDC.e = 1,000,000,000,000 in 6 decimals)
const APPROVAL_THRESHOLD = BigInt(1_000_000_000_000);

/**
 * Approval status for all required contracts
 */
export interface ApprovalStatus {
  // ERC-20 (USDC) approvals
  usdcCtf: boolean;
  usdcCtfExchange: boolean;
  usdcNegRiskExchange: boolean;
  usdcNegRiskAdapter: boolean;
  // ERC-1155 (Outcome Token) approvals
  ctfExchangeApproval: boolean;
  ctfNegRiskExchangeApproval: boolean;
  ctfNegRiskAdapterApproval: boolean;
  // Summary
  allApproved: boolean;
}

// Throttle state for approval checks
let lastApprovalCheck = 0;
const MIN_APPROVAL_CHECK_INTERVAL = 200; // 200ms between approval checks

/**
 * Throttle approval checks to avoid rate limiting
 */
async function throttleApprovalCheck(): Promise<void> {
  const now = Date.now();
  const timeSinceLastCheck = now - lastApprovalCheck;

  if (timeSinceLastCheck < MIN_APPROVAL_CHECK_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_APPROVAL_CHECK_INTERVAL - timeSinceLastCheck)
    );
  }

  lastApprovalCheck = Date.now();
}

/**
 * Check ERC-20 allowance for a spender
 * Uses shared RPC client
 */
async function checkErc20Allowance(
  owner: `0x${string}`,
  spender: `0x${string}`
): Promise<boolean> {
  try {
    await throttleApprovalCheck();
    const client = getPublicClient();
    const allowance = await client.readContract({
      address: CONTRACTS.USDC_E,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    });
    return allowance >= APPROVAL_THRESHOLD;
  } catch (err) {
    console.error("[Approvals] Failed to check ERC-20 allowance:", err);
    return false;
  }
}

/**
 * Check ERC-1155 operator approval
 * Uses shared RPC client
 */
async function checkErc1155Approval(
  owner: `0x${string}`,
  operator: `0x${string}`
): Promise<boolean> {
  try {
    await throttleApprovalCheck();
    const client = getPublicClient();
    const isApproved = await client.readContract({
      address: CONTRACTS.CTF,
      abi: ERC1155_ABI,
      functionName: "isApprovedForAll",
      args: [owner, operator],
    });
    return isApproved;
  } catch (err) {
    console.error("[Approvals] Failed to check ERC-1155 approval:", err);
    return false;
  }
}

/**
 * Check all required approvals for a Safe address
 *
 * This checks:
 * - USDC.e approvals for: CTF, CTF Exchange, Neg Risk Exchange, Neg Risk Adapter
 * - Outcome Token approvals for: CTF Exchange, Neg Risk Exchange, Neg Risk Adapter
 */
export async function checkAllApprovals(
  safeAddress: string
): Promise<ApprovalStatus> {
  const owner = safeAddress as `0x${string}`;

  // Check all approvals in parallel
  const [
    usdcCtf,
    usdcCtfExchange,
    usdcNegRiskExchange,
    usdcNegRiskAdapter,
    ctfExchangeApproval,
    ctfNegRiskExchangeApproval,
    ctfNegRiskAdapterApproval,
  ] = await Promise.all([
    // ERC-20 approvals
    checkErc20Allowance(owner, CONTRACTS.CTF),
    checkErc20Allowance(owner, CONTRACTS.CTF_EXCHANGE),
    checkErc20Allowance(owner, CONTRACTS.NEG_RISK_CTF_EXCHANGE),
    checkErc20Allowance(owner, CONTRACTS.NEG_RISK_ADAPTER),
    // ERC-1155 approvals
    checkErc1155Approval(owner, CONTRACTS.CTF_EXCHANGE),
    checkErc1155Approval(owner, CONTRACTS.NEG_RISK_CTF_EXCHANGE),
    checkErc1155Approval(owner, CONTRACTS.NEG_RISK_ADAPTER),
  ]);

  const allApproved =
    usdcCtf &&
    usdcCtfExchange &&
    usdcNegRiskExchange &&
    usdcNegRiskAdapter &&
    ctfExchangeApproval &&
    ctfNegRiskExchangeApproval &&
    ctfNegRiskAdapterApproval;

  return {
    usdcCtf,
    usdcCtfExchange,
    usdcNegRiskExchange,
    usdcNegRiskAdapter,
    ctfExchangeApproval,
    ctfNegRiskExchangeApproval,
    ctfNegRiskAdapterApproval,
    allApproved,
  };
}

/**
 * Check if any approvals are needed
 */
export async function needsApprovals(safeAddress: string): Promise<boolean> {
  const status = await checkAllApprovals(safeAddress);
  return !status.allApproved;
}
