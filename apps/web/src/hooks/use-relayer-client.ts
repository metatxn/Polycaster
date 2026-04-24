/**
 * Polymarket Relayer Client Hook
 *
 * Uses Polymarket's relayer infrastructure for gasless transactions:
 * - Deploy Safe wallets for users
 * - Set token approvals (USDC for CTF)
 * - Execute CTF operations (split, merge, redeem)
 *
 * Reference: https://docs.polymarket.com/developers/builders/relayer-client
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWalletClient } from "wagmi";

// Contract addresses on Polygon Mainnet
import {
  CONTRACTS,
  CTF_APPROVAL_OPERATORS,
  PUSD_APPROVAL_TARGETS,
} from "@/constants/contracts";
import { POLYGON_CHAIN_ID, RELAYER_API_URL } from "@/constants/polymarket";

import {
  derivePolymarketSafe,
  executeViaRelayer,
  getDeployed,
  deploySafe as relayerDeploySafe,
} from "@/lib/relayer-client";
// Shared RPC utilities
import {
  clearDeploymentCache,
  checkIsDeployed as rpcCheckIsDeployed,
} from "@/lib/rpc";

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
}

// Debounce time for deployment checks
const CHECK_DEPLOYMENT_DEBOUNCE_MS = 2000;

export function useRelayerClient() {
  const { address, isConnected } = useConnection();
  const { data: walletClient } = useWalletClient();

  const [state, setState] = useState<RelayerClientState>({
    isInitialized: false,
    isLoading: false,
    error: null,
    proxyAddress: null,
    hasDeployedSafe: false,
  });

  // Ref for debouncing deployment checks
  const lastCheckRef = useRef<number>(0);
  const checkTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Derive the Safe address using the custom relayer client's helper.
   *
   * Kept async to preserve the consumer-facing signature, but the underlying
   * derivation is synchronous (CREATE2) via derivePolymarketSafe().
   */
  const deriveSafeAddress = useCallback(async (): Promise<string | null> => {
    if (!address) return null;
    try {
      return derivePolymarketSafe(address as `0x${string}`);
    } catch (err) {
      console.warn("[RelayerClient] derive failed:", err);
      return null;
    }
  }, [address]);

  /**
   * Deploy a Safe wallet for the user (gasless)
   * Returns the proxy address of the deployed Safe
   * If Safe is already deployed, returns the existing address
   */
  const deploySafe = useCallback(async () => {
    if (!walletClient || !address) {
      return { success: false, error: "Wallet not connected" };
    }
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await relayerDeploySafe(
        walletClient,
        address as `0x${string}`
      );
      const safe = derivePolymarketSafe(address as `0x${string}`);

      console.log("[RelayerClient] Safe deployed successfully:", {
        transactionHash: result.transactionHash,
        proxyAddress: safe,
      });

      setState((prev) => ({
        ...prev,
        isLoading: false,
        proxyAddress: safe,
        hasDeployedSafe: true,
      }));

      return {
        success: true,
        transactionHash: result.transactionHash,
        proxyAddress: safe,
      };
    } catch (deployErr) {
      const errMessage =
        deployErr instanceof Error ? deployErr.message : String(deployErr);

      // Preserve existing "safe already deployed" handling
      if (errMessage.toLowerCase().includes("safe already deployed")) {
        const derivedAddress = derivePolymarketSafe(address as `0x${string}`);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          proxyAddress: derivedAddress,
          hasDeployedSafe: true,
        }));
        return {
          success: true,
          transactionHash: "",
          proxyAddress: derivedAddress,
          alreadyDeployed: true,
        };
      }

      console.error("[RelayerClient] Deploy error:", deployErr);
      const errorMessage = errMessage || "Failed to deploy Safe";
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return { success: false, error: errorMessage };
    }
  }, [walletClient, address]);

  /**
   * Set all token approvals for V2 trading (gasless)
   *
   * V2 settles BUY orders in pUSD, so the Safe must approve pUSD (not USDC.e)
   * to the V2 Exchange contracts. USDC.e is only approved to the Collateral
   * Onramp so that `wrap()` can convert USDC.e → pUSD on demand.
   *
   * ERC-20 Approvals:
   * - pUSD → CTF Exchange V2:            settle BUY on standard markets
   * - pUSD → Neg Risk CTF Exchange V2:   settle BUY on neg-risk markets
   * - pUSD → Neg Risk Adapter:           convert between market types
   * - USDC.e → Collateral Onramp:        allow wrap() to pull USDC.e → mint pUSD
   *
   * ERC-1155 (Outcome Token) Approvals:
   * - CTF → CTF Exchange V2:             sell positions on standard markets
   * - CTF → Neg Risk CTF Exchange V2:    sell positions on neg-risk markets
   * - CTF → Neg Risk Adapter:            convert positions between market types
   *
   * This list must mirror `checkAllApprovals` in `@/lib/approvals` — adding a
   * target there without adding it here leaves users stuck in a loop where
   * the check fails after a "successful" batch.
   */
  const approveUsdcForTrading = useCallback(async () => {
    if (!walletClient || !address) {
      return { success: false, error: "Wallet not connected" };
    }
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const { encodeFunctionData, maxUint256 } = await import("viem");
      const { checkAllApprovals } = await import("@/lib/approvals");

      // First, verify the Safe is deployed
      const expectedSafe = await deriveSafeAddress();
      if (!expectedSafe) {
        throw new Error(
          "Could not derive Safe address. Please ensure your wallet is connected."
        );
      }

      const isDeployed = await getDeployed(expectedSafe as `0x${string}`);
      console.log("[RelayerClient] Safe deployment check:", {
        expectedSafe,
        isDeployed,
      });

      // Check if approvals are already set
      console.log("[RelayerClient] Checking existing approvals...");
      const approvalStatus = await checkAllApprovals(expectedSafe);
      console.log("[RelayerClient] Current approval status:", approvalStatus);

      if (approvalStatus.allApproved) {
        console.log("[RelayerClient] All approvals already set, skipping...");
        setState((prev) => ({ ...prev, isLoading: false }));
        return {
          success: true,
          transactionHash: "",
          message: "All approvals already set",
          alreadyApproved: true,
        };
      }

      if (!isDeployed) {
        throw new Error(
          "Your trading wallet is not deployed yet. Please complete the 'Create Trading Wallet' step first."
        );
      }

      // ERC20 approve ABI
      const erc20ApproveAbi = [
        {
          name: "approve",
          type: "function",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
      ] as const;

      // ERC1155 setApprovalForAll ABI (for outcome tokens)
      const erc1155ApprovalAbi = [
        {
          name: "setApprovalForAll",
          type: "function",
          inputs: [
            { name: "operator", type: "address" },
            { name: "approved", type: "bool" },
          ],
          outputs: [],
        },
      ] as const;

      // Create ALL approval transactions.
      // The SDK's execute() method expects Transaction objects with: to, data,
      // value. It internally converts these to SafeTransactions (operation: Call).
      const erc20Approve = (token: `0x${string}`, spender: `0x${string}`) => ({
        to: token,
        data: encodeFunctionData({
          abi: erc20ApproveAbi,
          functionName: "approve",
          args: [spender, maxUint256],
        }),
        value: "0",
      });
      const erc1155ApproveAll = (operator: `0x${string}`) => ({
        to: CONTRACTS.CTF,
        data: encodeFunctionData({
          abi: erc1155ApprovalAbi,
          functionName: "setApprovalForAll",
          args: [operator, true],
        }),
        value: "0",
      });

      const approvalTxs = [
        // pUSD → V2 exchanges (settles BUY orders)
        ...PUSD_APPROVAL_TARGETS.map((spender) =>
          erc20Approve(CONTRACTS.PUSD, spender)
        ),
        // USDC.e → Onramp (lets wrap() pull USDC.e and mint pUSD)
        erc20Approve(CONTRACTS.USDC_E, CONTRACTS.COLLATERAL_ONRAMP),
        // CTF outcome tokens → operators (needed to SELL positions)
        ...CTF_APPROVAL_OPERATORS.map((operator) =>
          erc1155ApproveAll(operator)
        ),
      ];

      console.log("[RelayerClient] Submitting token approval transactions...");
      console.log(
        "[RelayerClient] pUSD approval targets:",
        PUSD_APPROVAL_TARGETS
      );
      console.log(
        "[RelayerClient] USDC.e approval target:",
        CONTRACTS.COLLATERAL_ONRAMP
      );
      console.log(
        "[RelayerClient] CTF (ERC-1155) approval operators:",
        CTF_APPROVAL_OPERATORS
      );

      // Execute the approval transactions with retry logic.
      // The new relayer client throws on failure states, so wrap in try/catch.
      const maxRetries = 3;
      let lastError: Error | null = null;
      let result: { transactionID: string; transactionHash: string } | null =
        null;

      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          if (retry > 0) {
            console.log(
              `[RelayerClient] Retry attempt ${retry + 1}/${maxRetries}...`
            );
            // Wait before retrying (exponential backoff: 1s, 2s, 4s)
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * 2 ** (retry - 1))
            );
          }

          result = await executeViaRelayer(
            walletClient,
            address as `0x${string}`,
            approvalTxs.map((t) => ({
              to: t.to as `0x${string}`,
              data: t.data as `0x${string}`,
              value: t.value,
            }))
          );

          console.log("[RelayerClient] Approval result:", {
            transactionID: result.transactionID,
            hash: result.transactionHash,
            retry,
          });
          break; // success
        } catch (executeErr) {
          console.error(
            `[RelayerClient] Execute error on attempt ${retry + 1}:`,
            executeErr
          );
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
      console.error("[RelayerClient] Approval error:", err);
      const errorMessage =
        err instanceof Error ? err.message : "Failed to approve USDC";
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return { success: false, error: errorMessage };
    }
  }, [walletClient, address, deriveSafeAddress]);

  /**
   * Check if an address has deployed code (is a contract)
   * Uses shared RPC client with caching to avoid rate limiting
   */
  const checkIsDeployed = useCallback(
    async (proxyAddress: string): Promise<boolean> => {
      try {
        return await rpcCheckIsDeployed(proxyAddress);
      } catch (err) {
        console.error("[RelayerClient] Failed to check deployment:", err);
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
      if (
        !options?.force &&
        now - lastCheckRef.current < CHECK_DEPLOYMENT_DEBOUNCE_MS
      ) {
        return;
      }
      lastCheckRef.current = now;

      // Clear any pending check
      if (checkTimeoutRef.current) {
        clearTimeout(checkTimeoutRef.current);
        checkTimeoutRef.current = null;
      }

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        // Derive the expected Safe address
        const derivedAddress = await deriveSafeAddress();

        if (!derivedAddress) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isInitialized: true,
            hasDeployedSafe: false,
            proxyAddress: null,
          }));
          return;
        }

        // IMPORTANT: Check if the derived address actually has code deployed
        // For new users, this will be FALSE because their Safe doesn't exist yet
        const isDeployed = await checkIsDeployed(derivedAddress);

        console.log(
          "[RelayerClient] Safe check:",
          derivedAddress,
          "deployed:",
          isDeployed,
          isDeployed
            ? "- Safe exists on-chain"
            : "- Safe NOT deployed yet (new user)"
        );

        setState((prev) => ({
          ...prev,
          isLoading: false,
          isInitialized: true,
          // ONLY set proxyAddress if the Safe is actually deployed
          // For new users, we don't want to show a non-existent address
          proxyAddress: isDeployed ? derivedAddress : null,
          hasDeployedSafe: isDeployed,
        }));
      } catch (err) {
        console.error("[RelayerClient] Check deployment error:", err);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isInitialized: true,
          error: err instanceof Error ? err.message : "Failed to check Safe",
        }));
      }
    },
    [address, deriveSafeAddress, checkIsDeployed]
  );

  /**
   * Force check deployment with cache clearing
   */
  const forceCheckSafeDeployment = useCallback(async () => {
    // Clear the deployment cache for this address
    const derivedAddress = await deriveSafeAddress();
    if (derivedAddress) {
      clearDeploymentCache(derivedAddress);
    }
    return checkSafeDeployment({ force: true });
  }, [deriveSafeAddress, checkSafeDeployment]);

  /**
   * Full onboarding flow:
   * 1. Deploy Safe wallet (if not exists)
   * 2. Approve USDC for trading
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

      // Step 2: Approve USDC
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
      setState({
        isInitialized: false,
        isLoading: false,
        error: null,
        proxyAddress: null,
        hasDeployedSafe: false,
      });
    }

    return () => {
      if (checkTimeoutRef.current) {
        clearTimeout(checkTimeoutRef.current);
      }
    };
  }, [isConnected, address, checkSafeDeployment]);

  return {
    // State
    ...state,
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
