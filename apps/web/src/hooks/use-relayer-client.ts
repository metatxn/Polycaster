/**
 * Polymarket Relayer Client Hook
 *
 * Uses Polymarket's relayer infrastructure for gasless transactions:
 * - Deploy Safe wallets for users
 * - Set token approvals (pUSD for CTF/CLOB V2, USDC.e for Onramp)
 * - Execute CTF operations (split, merge, redeem)
 *
 * Reference: https://docs.polymarket.com/developers/builders/relayer-client
 */

"use client";

import { createLogger } from "@knoww/logger";
import { buildTradingApprovalTransactions } from "@knoww/shared-types/approvals";
import {
  normalizeApprovalAmount,
  parseApprovalAmountRaw,
} from "@knoww/shared-types/trading";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWalletClient } from "wagmi";

const log = createLogger("relayer-client");

// Contract addresses on Polygon Mainnet
import { CONTRACTS } from "@/constants/contracts";
import { POLYGON_CHAIN_ID, RELAYER_API_URL } from "@/constants/polymarket";

import {
  derivePolymarketDepositWallet,
  derivePolymarketSafe,
  executeViaDepositWallet,
  executeViaRelayer,
  getDeployed,
  deployDepositWallet as relayerDeployDepositWallet,
  deploySafe as relayerDeploySafe,
} from "@/lib/relayer-client";
// Shared RPC utilities
import {
  clearDeploymentCache,
  getPublicClient,
  checkIsDeployed as rpcCheckIsDeployed,
} from "@/lib/rpc";
import {
  type TradingWalletMode,
  useTradingWalletMode,
} from "./use-trading-wallet-mode";

const POLYMARKET_RELAYER_URL = RELAYER_API_URL;
const CHAIN_ID = POLYGON_CHAIN_ID;

// Transaction states from the relayer (kept for documentation purposes)
// type TransactionState =
//   | "STATE_NEW"
//   | "STATE_EXECUTED"
//   | "STATE_MINED"
//   | "STATE_CONFIRMED"
//   | "STATE_FAILED"
//   | "STATE_INVALID";

interface RelayerClientState {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  proxyAddress: string | null;
  hasDeployedSafe: boolean;
  walletMode: TradingWalletMode | null;
}

// Debounce time for deployment checks
const CHECK_DEPLOYMENT_DEBOUNCE_MS = 2000;

export function useRelayerClient() {
  const { address, isConnected } = useConnection();
  const { data: walletClient } = useWalletClient();
  const { mode, isEoaMode } = useTradingWalletMode();
  const isDepositMode = mode === "deposit";

  const [state, setState] = useState<RelayerClientState>({
    isInitialized: false,
    isLoading: false,
    error: null,
    proxyAddress: null,
    hasDeployedSafe: false,
    walletMode: null,
  });

  // Ref for debouncing deployment checks
  const lastCheckRef = useRef<number>(0);
  const lastCheckKeyRef = useRef<string | null>(null);
  const checkTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Derive the Safe address using the custom relayer client's helper.
   *
   * Kept async to preserve the consumer-facing signature, but the underlying
   * derivation is synchronous (CREATE2) via derivePolymarketSafe().
   */
  const deriveSafeAddress = useCallback(async (): Promise<string | null> => {
    if (!address) return null;
    if (isEoaMode) return address;
    try {
      if (isDepositMode) {
        return derivePolymarketDepositWallet(address as `0x${string}`);
      }
      return derivePolymarketSafe(address as `0x${string}`);
    } catch (err) {
      log.warn("derive.failed", err);
      return null;
    }
  }, [address, isEoaMode, isDepositMode]);

  /**
   * Deploy a Safe wallet for the user (gasless)
   * Returns the proxy address of the deployed Safe
   * If Safe is already deployed, returns the existing address
   */
  const deploySafe = useCallback(async () => {
    if (!walletClient || !address) {
      return { success: false, error: "Wallet not connected" };
    }

    if (isEoaMode) {
      setState((prev) => ({
        ...prev,
        isInitialized: true,
        isLoading: false,
        error: null,
        proxyAddress: address,
        hasDeployedSafe: true,
        walletMode: mode,
      }));
      return {
        success: true,
        transactionHash: "",
        proxyAddress: address,
        alreadyDeployed: true,
      };
    }

    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      proxyAddress: null,
      hasDeployedSafe: false,
      walletMode: mode,
    }));

    try {
      const result = isDepositMode
        ? await relayerDeployDepositWallet(address as `0x${string}`)
        : await relayerDeploySafe(walletClient, address as `0x${string}`);
      const safe = isDepositMode
        ? derivePolymarketDepositWallet(address as `0x${string}`)
        : derivePolymarketSafe(address as `0x${string}`);

      log.info("trading_wallet.deployed", {
        transactionHash: result.transactionHash,
        proxyAddress: safe,
        mode,
      });

      setState((prev) => ({
        ...prev,
        isLoading: false,
        proxyAddress: safe,
        hasDeployedSafe: true,
        walletMode: mode,
      }));

      return {
        success: true,
        transactionHash: result.transactionHash,
        proxyAddress: safe,
      };
    } catch (deployErr) {
      const errMessage =
        deployErr instanceof Error ? deployErr.message : String(deployErr);

      // Preserve existing "already deployed" handling
      if (errMessage.toLowerCase().includes("already deployed")) {
        const derivedAddress = isDepositMode
          ? derivePolymarketDepositWallet(address as `0x${string}`)
          : derivePolymarketSafe(address as `0x${string}`);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          proxyAddress: derivedAddress,
          hasDeployedSafe: true,
          walletMode: mode,
        }));
        return {
          success: true,
          transactionHash: "",
          proxyAddress: derivedAddress,
          alreadyDeployed: true,
        };
      }

      log.error("deploy.error", deployErr);
      const errorMessage = errMessage || "Failed to deploy trading wallet";
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return { success: false, error: errorMessage };
    }
  }, [walletClient, address, isEoaMode, isDepositMode, mode]);

  /**
   * Set the default token approvals for app trading (gasless)
   *
   * Polymarket docs list pUSD → CTF plus CTF operator approval to both CLOB
   * exchanges as the market-making setup. The app also grants pUSD allowance to
   * both CLOB exchanges because BUY orders are rejected by the CLOB server when
   * that allowance is missing. USDC.e is approved only to the CollateralOnramp
   * so `wrap()` can convert USDC.e → pUSD on demand.
   *
   * ERC-20 Approvals:
   * - pUSD → CTF:                        docs-required split/mint setup
   * - pUSD → CTF Exchange V2:            settle BUY on standard markets
   * - pUSD → Neg Risk CTF Exchange V2:   settle BUY on neg-risk markets
   * - USDC.e → CollateralOnramp:         allow wrap() to pull USDC.e → mint pUSD
   *
   * ERC-1155 (Outcome Token) Approvals:
   * - CTF → CTF Exchange V2:             sell positions on standard markets
   * - CTF → Neg Risk CTF Exchange V2:    sell positions on neg-risk markets
   *
   * This list must mirror `checkAllApprovals` in `@/lib/approvals` — adding a
   * target there without adding it here leaves users stuck in a loop where
   * the check fails after a "successful" batch.
   */
  const approveUsdcForTrading = useCallback(
    async (approvalAmount?: string) => {
      if (!walletClient || !address) {
        return { success: false, error: "Wallet not connected" };
      }
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const { polygon } = await import("viem/chains");
        const { checkAllApprovals } = await import("@/lib/approvals");
        const normalizedApprovalAmount =
          normalizeApprovalAmount(approvalAmount);
        const approvalAmountRaw = parseApprovalAmountRaw(approvalAmount);

        // First, verify the Safe is deployed
        const expectedSafe = await deriveSafeAddress();
        if (!expectedSafe) {
          throw new Error(
            "Could not derive Safe address. Please ensure your wallet is connected."
          );
        }

        const isDeployed = isEoaMode
          ? true
          : await getDeployed(
              expectedSafe as `0x${string}`,
              isDepositMode ? "WALLET" : "SAFE"
            );
        log.debug("approvals.safe_check", { expectedSafe, isDeployed });

        // Check if approvals are already set
        log.debug("approvals.checking");
        const approvalStatus = await checkAllApprovals(
          expectedSafe,
          approvalAmountRaw
        );
        log.debug("approvals.status", approvalStatus);

        const approvalTxs = buildTradingApprovalTransactions(
          approvalStatus,
          approvalAmountRaw
        );

        if (approvalTxs.length === 0) {
          log.debug("approvals.already_set");
          setState((prev) => ({ ...prev, isLoading: false }));
          return {
            success: true,
            transactionHash: "",
            message: "All approvals already set",
            alreadyApproved: true,
          };
        }

        if (isEoaMode) {
          const publicClient = getPublicClient();
          const txHashes: `0x${string}`[] = [];
          for (const tx of approvalTxs) {
            const hash = await walletClient.sendTransaction({
              account: address as `0x${string}`,
              chain: polygon,
              to: tx.to,
              data: tx.data,
              value: BigInt(0),
            });
            txHashes.push(hash);
            await publicClient.waitForTransactionReceipt({ hash });
          }

          setState((prev) => ({ ...prev, isLoading: false }));
          return {
            success: true,
            transactionHash: txHashes.at(-1) ?? "",
            transactionHashes: txHashes,
          };
        }

        if (!isDeployed) {
          throw new Error(
            "Your trading wallet is not deployed yet. Please complete the 'Create Trading Wallet' step first."
          );
        }

        log.debug("approvals.submitting", {
          amount: normalizedApprovalAmount,
          txnCount: approvalTxs.length,
        });

        // Execute the approval transactions with retry logic.
        // The new relayer client throws on failure states, so wrap in try/catch.
        const maxRetries = 3;
        let lastError: Error | null = null;
        let result: { transactionID: string; transactionHash: string } | null =
          null;

        for (let retry = 0; retry < maxRetries; retry++) {
          try {
            if (retry > 0) {
              log.debug("approvals.retry", { attempt: retry + 1, maxRetries });
              // Wait before retrying (exponential backoff: 1s, 2s, 4s)
              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * 2 ** (retry - 1))
              );
            }

            const txs = approvalTxs.map((t) => ({
              to: t.to as `0x${string}`,
              data: t.data as `0x${string}`,
              value: t.value,
            }));
            result = isDepositMode
              ? await executeViaDepositWallet(
                  walletClient,
                  address as `0x${string}`,
                  txs,
                  expectedSafe as `0x${string}`
                )
              : await executeViaRelayer(
                  walletClient,
                  address as `0x${string}`,
                  txs
                );

            log.info("approvals.result", {
              transactionID: result.transactionID,
              hash: result.transactionHash,
              retry,
            });
            break; // success
          } catch (executeErr) {
            log.error("approvals.execute_failed", {
              attempt: retry + 1,
              error: executeErr,
            });
            lastError =
              executeErr instanceof Error
                ? executeErr
                : new Error(String(executeErr));
            // Continue to next retry
          }
        }

        if (!result) {
          throw lastError ?? new Error("Approval failed after all retries");
        }

        setState((prev) => ({ ...prev, isLoading: false }));
        return { success: true, transactionHash: result.transactionHash };
      } catch (err) {
        log.error("approvals.error", err);
        const errorMessage =
          err instanceof Error ? err.message : "Failed to set approvals";
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }));
        return { success: false, error: errorMessage };
      }
    },
    [walletClient, address, deriveSafeAddress, isEoaMode, isDepositMode]
  );

  /**
   * Check if an address has deployed code (is a contract)
   * Uses shared RPC client with caching to avoid rate limiting
   */
  const checkIsDeployed = useCallback(
    async (proxyAddress: string): Promise<boolean> => {
      try {
        return await rpcCheckIsDeployed(proxyAddress);
      } catch (err) {
        log.error("deployment.check_failed", err);
        return false;
      }
    },
    []
  );

  /**
   * Check if user has a deployed Safe wallet
   * Derives the expected address and checks if it has code deployed
   *
   * Includes debouncing to prevent rate limiting
   */
  const checkSafeDeployment = useCallback(
    async (options?: { force?: boolean }) => {
      if (!address) return;

      // Debounce: skip if called too recently (unless forced)
      const now = Date.now();
      const checkKey = `${address.toLowerCase()}:${mode}`;
      if (
        !options?.force &&
        lastCheckKeyRef.current === checkKey &&
        now - lastCheckRef.current < CHECK_DEPLOYMENT_DEBOUNCE_MS
      ) {
        return;
      }
      lastCheckRef.current = now;
      lastCheckKeyRef.current = checkKey;

      // Clear any pending check
      if (checkTimeoutRef.current) {
        clearTimeout(checkTimeoutRef.current);
        checkTimeoutRef.current = null;
      }

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
        proxyAddress: null,
        hasDeployedSafe: false,
        walletMode: mode,
      }));

      try {
        if (isEoaMode) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isInitialized: true,
            hasDeployedSafe: true,
            proxyAddress: address ?? null,
            walletMode: mode,
          }));
          return;
        }

        // Derive the expected Safe address
        const derivedAddress = await deriveSafeAddress();

        if (!derivedAddress) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isInitialized: true,
            hasDeployedSafe: false,
            proxyAddress: null,
            walletMode: mode,
          }));
          return;
        }

        // IMPORTANT: Check if the derived address actually has code deployed
        // For new users, this will be FALSE because their Safe doesn't exist yet
        const isDeployed = await checkIsDeployed(derivedAddress);

        log.debug("safe.check", {
          derivedAddress,
          isDeployed,
          note: isDeployed
            ? "Safe exists on-chain"
            : "Safe NOT deployed yet (new user)",
        });

        setState((prev) => ({
          ...prev,
          isLoading: false,
          isInitialized: true,
          // ONLY set proxyAddress if the Safe is actually deployed
          // For new users, we don't want to show a non-existent address
          proxyAddress: isDeployed ? derivedAddress : null,
          hasDeployedSafe: isDeployed,
          walletMode: mode,
        }));
      } catch (err) {
        log.error("deployment.check_error", err);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isInitialized: true,
          error: err instanceof Error ? err.message : "Failed to check Safe",
          proxyAddress: null,
          hasDeployedSafe: false,
          walletMode: mode,
        }));
      }
    },
    [address, mode, deriveSafeAddress, checkIsDeployed, isEoaMode]
  );

  /**
   * Force check deployment with cache clearing
   */
  const forceCheckSafeDeployment = useCallback(async () => {
    // Clear the deployment cache for this address
    const derivedAddress = await deriveSafeAddress();
    if (derivedAddress && mode !== "eoa") {
      clearDeploymentCache(derivedAddress);
    }
    return checkSafeDeployment({ force: true });
  }, [deriveSafeAddress, checkSafeDeployment, mode]);

  /**
   * Full onboarding flow:
   * 1. Deploy Safe wallet (if not exists)
   * 2. Approve pUSD/USDC.e/CTF for trading
   * 3. Return the proxy address
   */
  const onboardUser = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Step 1: Deploy Safe
      const deployResult = await deploySafe();
      if (!deployResult.success) {
        return deployResult;
      }

      // Step 2: Approve V2 trading and CTF-operation allowances
      const approveResult = await approveUsdcForTrading();
      if (!approveResult.success) {
        return {
          success: false,
          error: approveResult.error,
          proxyAddress: deployResult.proxyAddress,
        };
      }

      return {
        success: true,
        proxyAddress: deployResult.proxyAddress,
        message: "Onboarding complete! You can now trade on Polymarket.",
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Onboarding failed";
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return { success: false, error: errorMessage };
    }
  }, [deploySafe, approveUsdcForTrading]);

  // Check Safe deployment when address changes (with cleanup)
  useEffect(() => {
    if (isConnected && address) {
      checkSafeDeployment();
    } else {
      lastCheckKeyRef.current = null;
      setState({
        isInitialized: false,
        isLoading: false,
        error: null,
        proxyAddress: null,
        hasDeployedSafe: false,
        walletMode: null,
      });
    }

    return () => {
      if (checkTimeoutRef.current) {
        clearTimeout(checkTimeoutRef.current);
      }
    };
  }, [isConnected, address, checkSafeDeployment]);

  const stateMatchesMode = state.walletMode === mode;

  return {
    // State
    ...state,
    proxyAddress: stateMatchesMode ? state.proxyAddress : null,
    hasDeployedSafe: stateMatchesMode ? state.hasDeployedSafe : false,
    isConnected,

    // Actions
    deploySafe,
    approveUsdcForTrading,
    onboardUser,
    forceCheckSafeDeployment,
    checkSafeDeployment,

    // Constants
    contracts: CONTRACTS,
    relayerUrl: POLYMARKET_RELAYER_URL,
    chainId: CHAIN_ID,
  };
}
