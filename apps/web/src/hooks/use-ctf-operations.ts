/**
 * CTF Operations Hook
 *
 * Handles Conditional Token Framework operations:
 * - Split: Convert pUSD into YES + NO outcome tokens
 * - Merge: Convert YES + NO outcome tokens back to pUSD
 * - Redeem: Claim winnings after market resolution
 *
 * Reference: https://docs.polymarket.com/developers/CTF/overview
 */

"use client";

import { createLogger } from "@knoww/logger";
import {
  BINARY_PARTITION_BIGINT as BINARY_PARTITION,
  CTF_JSON_ABI as CTF_ABI,
  PARENT_COLLECTION_ID,
} from "@knoww/shared-types/ctf";

const log = createLogger("ctf-operations");

import { useCallback, useState } from "react";
import { useConnection, useWalletClient } from "wagmi";
import {
  CONTRACTS,
  CTF_ADDRESS,
  PUSD_CTF_APPROVAL_TARGET,
  PUSD_DECIMALS,
} from "@/constants/contracts";
import { executeViaRelayer } from "@/lib/relayer-client";

// ============================================================================
// Types
// ============================================================================

export interface CTFOperationState {
  isLoading: boolean;
  error: string | null;
  txHash: string | null;
}

export interface OutcomeTokenBalances {
  yesBalance: bigint;
  noBalance: bigint;
  minBalance: bigint;
}

type OperationResult = { success: boolean; txHash?: string; error?: string };

type CTFFunction = "splitPosition" | "mergePositions" | "redeemPositions";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse error message into user-friendly format
 */
function parseUserFriendlyError(errorMessage: string): string {
  const lowerMsg = errorMessage.toLowerCase();

  const errorMappings: Array<{ patterns: string[]; message: string }> = [
    {
      patterns: ["user rejected", "user denied", "rejected the request"],
      message: "Transaction cancelled",
    },
    {
      patterns: ["insufficient", "exceeds balance"],
      message: "Insufficient balance",
    },
    {
      patterns: ["network", "timeout", "connection"],
      message: "Network error. Please try again.",
    },
    {
      patterns: ["gas", "execution reverted"],
      message: "Transaction failed. Please try again.",
    },
  ];

  for (const { patterns, message } of errorMappings) {
    if (patterns.some((p) => lowerMsg.includes(p))) {
      return message;
    }
  }

  return errorMessage.length > 100
    ? `${errorMessage.substring(0, 100)}...`
    : errorMessage;
}

// ============================================================================
// Hook
// ============================================================================

export function useCtfOperations() {
  const { address, isConnected } = useConnection();
  const { data: walletClient } = useWalletClient();

  const [state, setState] = useState<CTFOperationState>({
    isLoading: false,
    error: null,
    txHash: null,
  });

  const ensureCtfCollateralApproval = useCallback(
    async (proxyAddress: string, requiredAmount: bigint) => {
      if (!walletClient || !address) {
        throw new Error("Wallet not connected");
      }

      const { createPublicClient, encodeFunctionData, erc20Abi, http } =
        await import("viem");
      const { polygon } = await import("viem/chains");
      const { getRpcUrl } = await import("@/lib/rpc");
      const publicClient = createPublicClient({
        chain: polygon,
        transport: http(getRpcUrl()),
      });

      const allowance = await publicClient.readContract({
        address: CONTRACTS.PUSD,
        abi: erc20Abi,
        functionName: "allowance",
        args: [
          proxyAddress as `0x${string}`,
          PUSD_CTF_APPROVAL_TARGET as `0x${string}`,
        ],
      });

      if (allowance >= requiredAmount) return;

      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [PUSD_CTF_APPROVAL_TARGET as `0x${string}`, requiredAmount],
      });

      await executeViaRelayer(walletClient, address as `0x${string}`, [
        {
          to: CONTRACTS.PUSD,
          data,
          value: "0",
        },
      ]);
    },
    [walletClient, address]
  );

  /**
   * Execute a CTF operation via relayer with polling
   */
  const executeCTFOperation = useCallback(
    async (
      operationName: CTFFunction,
      encodedData: `0x${string}`
    ): Promise<OperationResult> => {
      setState({ isLoading: true, error: null, txHash: null });

      try {
        if (!walletClient || !address) {
          throw new Error("Wallet not connected");
        }

        const result = await executeViaRelayer(
          walletClient,
          address as `0x${string}`,
          [
            {
              to: CTF_ADDRESS as `0x${string}`,
              data: encodedData,
              value: "0",
            },
          ]
        );

        const txHash = result.transactionHash;
        setState({ isLoading: false, error: null, txHash });
        return { success: true, txHash };
      } catch (err) {
        const rawMessage =
          err instanceof Error ? err.message : `${operationName} failed`;
        const errorMessage = parseUserFriendlyError(rawMessage);
        log.error("operation.failed", { operation: operationName, error: err });
        setState({ isLoading: false, error: errorMessage, txHash: null });
        return { success: false, error: errorMessage };
      }
    },
    [walletClient, address]
  );

  /**
   * Get outcome token balances for a market
   */
  const getOutcomeBalances = useCallback(
    async (
      yesTokenId: string,
      noTokenId: string,
      ownerAddress?: string
    ): Promise<OutcomeTokenBalances> => {
      const owner = ownerAddress || address;
      if (!owner) {
        throw new Error("No address available");
      }

      const { createPublicClient, http } = await import("viem");
      const { polygon } = await import("viem/chains");
      const { getRpcUrl } = await import("@/lib/rpc");

      const publicClient = createPublicClient({
        chain: polygon,
        transport: http(getRpcUrl()),
      });

      const balances = (await publicClient.readContract({
        address: CTF_ADDRESS as `0x${string}`,
        abi: CTF_ABI,
        functionName: "balanceOfBatch",
        args: [
          [owner as `0x${string}`, owner as `0x${string}`],
          [BigInt(yesTokenId), BigInt(noTokenId)],
        ],
      })) as [bigint, bigint];

      const [yesBalance, noBalance] = balances;
      const minBalance = yesBalance < noBalance ? yesBalance : noBalance;

      return { yesBalance, noBalance, minBalance };
    },
    [address]
  );

  /**
   * Split pUSD into YES + NO outcome tokens
   * 1 pUSD → 1 YES + 1 NO
   */
  const splitPosition = useCallback(
    async (
      conditionId: string,
      amount: number,
      proxyAddress: string
    ): Promise<OperationResult> => {
      const { encodeFunctionData, parseUnits } = await import("viem");

      const amountInWei = parseUnits(amount.toString(), PUSD_DECIMALS);
      await ensureCtfCollateralApproval(proxyAddress, amountInWei);

      const encodedData = encodeFunctionData({
        abi: CTF_ABI,
        functionName: "splitPosition",
        args: [
          CONTRACTS.PUSD as `0x${string}`,
          PARENT_COLLECTION_ID,
          conditionId as `0x${string}`,
          BINARY_PARTITION,
          amountInWei,
        ],
      });

      return executeCTFOperation("splitPosition", encodedData);
    },
    [executeCTFOperation, ensureCtfCollateralApproval]
  );

  /**
   * Merge YES + NO outcome tokens back to pUSD
   * 1 YES + 1 NO → 1 pUSD
   */
  const mergePositions = useCallback(
    async (
      conditionId: string,
      amount: number,
      _proxyAddress: string
    ): Promise<OperationResult> => {
      const { encodeFunctionData, parseUnits } = await import("viem");

      const amountInWei = parseUnits(amount.toString(), PUSD_DECIMALS);

      const encodedData = encodeFunctionData({
        abi: CTF_ABI,
        functionName: "mergePositions",
        args: [
          CONTRACTS.PUSD as `0x${string}`,
          PARENT_COLLECTION_ID,
          conditionId as `0x${string}`,
          BINARY_PARTITION,
          amountInWei,
        ],
      });

      return executeCTFOperation("mergePositions", encodedData);
    },
    [executeCTFOperation]
  );

  /**
   * Redeem winning positions after market resolution
   */
  const redeemPositions = useCallback(
    async (
      conditionId: string,
      _proxyAddress: string
    ): Promise<OperationResult> => {
      const { encodeFunctionData } = await import("viem");

      const encodedData = encodeFunctionData({
        abi: CTF_ABI,
        functionName: "redeemPositions",
        args: [
          CONTRACTS.PUSD as `0x${string}`,
          PARENT_COLLECTION_ID,
          conditionId as `0x${string}`,
          BINARY_PARTITION,
        ],
      });

      return executeCTFOperation("redeemPositions", encodedData);
    },
    [executeCTFOperation]
  );

  /**
   * Reset the operation state
   */
  const reset = useCallback(() => {
    setState({ isLoading: false, error: null, txHash: null });
  }, []);

  return {
    ...state,
    isConnected,
    splitPosition,
    mergePositions,
    redeemPositions,
    getOutcomeBalances,
    reset,
  };
}
