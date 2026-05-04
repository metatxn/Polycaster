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
import type { ApprovalTransaction } from "@knoww/shared-types/approvals";
import {
  type CtfOperationName,
  type CtfOperationTransaction,
  type CtfOutcomeBalances,
  planCtfOperationTransaction,
  planCtfOperationTransactions,
  readCtfOutcomeBalances,
} from "@knoww/shared-types/ctf";
import { formatCtfOperationError } from "@knoww/shared-types/trading-errors";

const log = createLogger("ctf-operations");

import { useCallback, useState } from "react";
import { useConnection, useWalletClient } from "wagmi";
import {
  executeViaDepositWallet,
  executeViaRelayer,
} from "@/lib/relayer-client";
import { useTradingWalletMode } from "./use-trading-wallet-mode";

// ============================================================================
// Types
// ============================================================================

export interface CTFOperationState {
  isLoading: boolean;
  error: string | null;
  txHash: string | null;
}

export type OutcomeTokenBalances = CtfOutcomeBalances;

type OperationResult = { success: boolean; txHash?: string; error?: string };

async function createCtfPublicClient() {
  const { createPublicClient, http } = await import("viem");
  const { polygon } = await import("viem/chains");
  const { getRpcUrl } = await import("@/lib/rpc");

  return createPublicClient({
    chain: polygon,
    transport: http(getRpcUrl()),
  });
}

// ============================================================================
// Hook
// ============================================================================

export function useCtfOperations() {
  const { address, isConnected } = useConnection();
  const { data: walletClient } = useWalletClient();
  const { isEoaMode, mode: walletMode } = useTradingWalletMode();

  const [state, setState] = useState<CTFOperationState>({
    isLoading: false,
    error: null,
    txHash: null,
  });

  const executeCtfApprovalTransaction = useCallback(
    async (
      approvalTx: ApprovalTransaction,
      publicClient: Awaited<ReturnType<typeof createCtfPublicClient>>
    ) => {
      if (!walletClient || !address) {
        throw new Error("Wallet not connected");
      }

      const { polygon } = await import("viem/chains");

      if (isEoaMode) {
        const hash = await walletClient.sendTransaction({
          account: address as `0x${string}`,
          chain: polygon,
          to: approvalTx.to,
          data: approvalTx.data,
          value: BigInt(approvalTx.value),
        });
        await publicClient.waitForTransactionReceipt({ hash });
        return;
      }

      if (walletMode === "deposit") {
        await executeViaDepositWallet(walletClient, address as `0x${string}`, [
          approvalTx,
        ]);
        return;
      }

      await executeViaRelayer(walletClient, address as `0x${string}`, [
        approvalTx,
      ]);
    },
    [walletClient, address, isEoaMode, walletMode]
  );

  /**
   * Execute a CTF operation via relayer with polling
   */
  const executeCTFOperation = useCallback(
    async (
      operationName: CtfOperationName,
      transaction: CtfOperationTransaction
    ): Promise<OperationResult> => {
      setState({ isLoading: true, error: null, txHash: null });

      try {
        if (!walletClient || !address) {
          throw new Error("Wallet not connected");
        }

        if (isEoaMode) {
          const { polygon } = await import("viem/chains");
          const { getPublicClient } = await import("@/lib/rpc");
          const hash = await walletClient.sendTransaction({
            account: address as `0x${string}`,
            chain: polygon,
            to: transaction.to,
            data: transaction.data,
            value: BigInt(transaction.value),
          });
          await getPublicClient().waitForTransactionReceipt({ hash });
          setState({ isLoading: false, error: null, txHash: hash });
          return { success: true, txHash: hash };
        }

        const result =
          walletMode === "deposit"
            ? await executeViaDepositWallet(
                walletClient,
                address as `0x${string}`,
                [transaction]
              )
            : await executeViaRelayer(walletClient, address as `0x${string}`, [
                transaction,
              ]);

        const txHash = result.transactionHash;
        setState({ isLoading: false, error: null, txHash });
        return { success: true, txHash };
      } catch (err) {
        const errorMessage = formatCtfOperationError(
          err,
          `${operationName} failed`
        );
        log.error("operation.failed", { operation: operationName, error: err });
        setState({ isLoading: false, error: errorMessage, txHash: null });
        return { success: false, error: errorMessage };
      }
    },
    [walletClient, address, isEoaMode, walletMode]
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

      const publicClient = await createCtfPublicClient();

      return readCtfOutcomeBalances(
        publicClient,
        owner as `0x${string}`,
        yesTokenId,
        noTokenId
      );
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
      proxyAddress: string,
      negRisk = false
    ): Promise<OperationResult> => {
      const publicClient = await createCtfPublicClient();
      const plan = await planCtfOperationTransactions({
        operation: "splitPosition",
        conditionId,
        amount: amount.toString(),
        negRisk,
        client: publicClient,
        collateralOwner: proxyAddress as `0x${string}`,
      });
      if (plan.approvalTransaction) {
        await executeCtfApprovalTransaction(
          plan.approvalTransaction,
          publicClient
        );
      }

      return executeCTFOperation(plan.operation, plan.transaction);
    },
    [executeCTFOperation, executeCtfApprovalTransaction]
  );

  /**
   * Merge YES + NO outcome tokens back to pUSD
   * 1 YES + 1 NO → 1 pUSD
   */
  const mergePositions = useCallback(
    async (
      conditionId: string,
      amount: number,
      _proxyAddress: string,
      negRisk = false
    ): Promise<OperationResult> => {
      const plan = planCtfOperationTransaction({
        operation: "mergePositions",
        conditionId,
        amount: amount.toString(),
        negRisk,
      });
      return executeCTFOperation(plan.operation, plan.transaction);
    },
    [executeCTFOperation]
  );

  /**
   * Redeem winning positions after market resolution
   */
  const redeemPositions = useCallback(
    async (
      conditionId: string,
      _proxyAddress: string,
      negRisk = false
    ): Promise<OperationResult> => {
      const plan = planCtfOperationTransaction({
        operation: "redeemPositions",
        conditionId,
        negRisk,
      });
      return executeCTFOperation(plan.operation, plan.transaction);
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
