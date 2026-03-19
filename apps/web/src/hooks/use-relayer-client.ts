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
import { CONTRACTS } from "@/constants/contracts";
import { POLYGON_CHAIN_ID, RELAYER_API_URL } from "@/constants/polymarket";

import { deriveProxyAddress } from "@/lib/derive-proxy-address";
import { createBuilderConfig } from "@/lib/remote-builder-config";
// Shared RPC utilities
import {
  clearDeploymentCache,
  checkIsDeployed as rpcCheckIsDeployed,
} from "@/lib/rpc";
import { getBuilderSignProxyUrl } from "@/lib/sign-proxy-url";

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
   * Initialize the RelayClient with the user's wallet
   * Uses viem WalletClient directly (supported by @polymarket/builder-relayer-client)
   */
  const getClient = useCallback(async () => {
    if (!walletClient || !address) {
      throw new Error("Wallet not connected");
    }

    const signProxyUrl = getBuilderSignProxyUrl();

    console.log("[RelayerClient] Initializing with:", {
      relayerUrl: POLYMARKET_RELAYER_URL,
      chainId: CHAIN_ID,
      builderServerUrl: signProxyUrl,
      walletAddress: address,
    });

    // Dynamic import to avoid SSR issues
    const { RelayClient } = await import("@polymarket/builder-relayer-client");
    const builderConfig = createBuilderConfig({
      url: signProxyUrl,
    });

    const client = new RelayClient(
      POLYMARKET_RELAYER_URL,
      CHAIN_ID,
      walletClient,
      builderConfig
    );

    return client;
  }, [walletClient, address]);

  /**
   * Derive the Safe address using the SDK's built-in function
   *
   * Uses deriveSafe() from @polymarket/builder-relayer-client which ensures
   * exact compatibility with Polymarket's address derivation.
   *
   * Reference: https://github.com/Polymarket/wagmi-safe-builder-example
   */
  const deriveSafeAddress = useCallback(async (): Promise<string | null> => {
    if (!address) return null;

    try {
      // Use the SDK's deriveSafe function for exact compatibility
      const { deriveSafe } = await import(
        "@polymarket/builder-relayer-client/dist/builder/derive"
      );
      const { getContractConfig } = await import(
        "@polymarket/builder-relayer-client/dist/config"
      );

      const config = getContractConfig(CHAIN_ID);
      const proxyAddress = deriveSafe(
        address,
        config.SafeContracts.SafeFactory
      );

      return proxyAddress;
    } catch (err) {
      console.warn(
        "[RelayerClient] SDK deriveSafe failed, using fallback:",
        err
      );
      try {
        return await deriveProxyAddress(address);
      } catch {
        return null;
      }
    }
  }, [address]);

  /**
   * Deploy a Safe wallet for the user (gasless)
   * Returns the proxy address of the deployed Safe
   * If Safe is already deployed, returns the existing address
   */
  const deploySafe = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const client = await getClient();

      let response: Awaited<ReturnType<typeof client.deploy>> | undefined;
      try {
        response = await client.deploy();
      } catch (deployErr) {
        // Check if the error is "safe already deployed"
        const errMessage =
          deployErr instanceof Error ? deployErr.message : String(deployErr);

        if (errMessage.toLowerCase().includes("safe already deployed")) {
          // Derive the Safe address
          const derivedAddress = await deriveSafeAddress();

          if (derivedAddress) {
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

          // If we can't derive the address, still mark as success since it's deployed
          setState((prev) => ({
            ...prev,
            isLoading: false,
            hasDeployedSafe: true,
          }));

          return {
            success: true,
            transactionHash: "",
            proxyAddress: "",
            alreadyDeployed: true,
            message: "Safe already deployed - address will be computed",
          };
        }

        // Re-throw other errors
        throw deployErr;
      }

      // Use SDK's built-in wait() method as per documentation
      // https://docs.polymarket.com/developers/builders/relayer-client#deploying-safe-wallets
      console.log(
        "[RelayerClient] Waiting for Safe deployment confirmation..."
      );
      const result = await response.wait();

      if (result) {
        console.log("[RelayerClient] Safe deployed successfully:", {
          transactionHash: result.transactionHash,
          proxyAddress: result.proxyAddress,
          state: result.state,
        });

        setState((prev) => ({
          ...prev,
          isLoading: false,
          proxyAddress: result.proxyAddress,
          hasDeployedSafe: true,
        }));

        return {
          success: true,
          transactionHash: result.transactionHash,
          proxyAddress: result.proxyAddress,
        };
      } else {
        throw new Error("Safe deployment failed or timed out");
      }
    } catch (err) {
      console.error("[RelayerClient] Deploy error:", err);
      const errorMessage =
        err instanceof Error ? err.message : "Failed to deploy Safe";
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return { success: false, error: errorMessage };
    }
  }, [getClient, deriveSafeAddress]);

  /**
   * Set all token approvals for trading (gasless)
   *
   * This sets up ALL required approvals for Polymarket trading:
   *
   * ERC-20 (USDC.e) Approvals:
   * - CTF Contract: For split/merge operations
   * - CTF Exchange: For standard binary markets
   * - Neg Risk CTF Exchange: For negative risk markets
   * - Neg Risk Adapter: For converting between market types
   *
   * ERC-1155 (Outcome Token) Approvals:
   * - CTF Exchange: To sell positions in standard markets
   * - Neg Risk CTF Exchange: To sell positions in neg risk markets
   * - Neg Risk Adapter: To convert positions between market types
   *
   * Reference: https://github.com/Polymarket/wagmi-safe-builder-example
   */
  const approveUsdcForTrading = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const client = await getClient();
      const { encodeFunctionData, maxUint256 } = await import("viem");
      const { checkAllApprovals } = await import("@/lib/approvals");

      // First, verify the Safe is deployed
      const expectedSafe = await deriveSafeAddress();
      if (!expectedSafe) {
        throw new Error(
          "Could not derive Safe address. Please ensure your wallet is connected."
        );
      }

      const isDeployed = await client.getDeployed(expectedSafe);
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

      // Create ALL approval transactions
      // The SDK's execute() method expects Transaction objects with: to, data, value
      // It internally converts these to SafeTransactions with operation: Call
      const approvalTxs = [
        // ========== ERC-20 (USDC.e) Approvals ==========
        // Approve CTF Contract (for split/merge operations)
        {
          to: CONTRACTS.USDC_E,
          data: encodeFunctionData({
            abi: erc20ApproveAbi,
            functionName: "approve",
            args: [CONTRACTS.CTF, maxUint256],
          }),
          value: "0",
        },
        // Approve CTF Exchange (for standard binary markets)
        {
          to: CONTRACTS.USDC_E,
          data: encodeFunctionData({
            abi: erc20ApproveAbi,
            functionName: "approve",
            args: [CONTRACTS.CTF_EXCHANGE, maxUint256],
          }),
          value: "0",
        },
        // Approve Neg Risk CTF Exchange (for negative risk markets)
        {
          to: CONTRACTS.USDC_E,
          data: encodeFunctionData({
            abi: erc20ApproveAbi,
            functionName: "approve",
            args: [CONTRACTS.NEG_RISK_CTF_EXCHANGE, maxUint256],
          }),
          value: "0",
        },
        // Approve Neg Risk Adapter (for converting between market types)
        {
          to: CONTRACTS.USDC_E,
          data: encodeFunctionData({
            abi: erc20ApproveAbi,
            functionName: "approve",
            args: [CONTRACTS.NEG_RISK_ADAPTER, maxUint256],
          }),
          value: "0",
        },

        // ========== ERC-1155 (Outcome Token) Approvals ==========
        // Allow CTF Exchange to transfer outcome tokens (for selling positions)
        {
          to: CONTRACTS.CTF,
          data: encodeFunctionData({
            abi: erc1155ApprovalAbi,
            functionName: "setApprovalForAll",
            args: [CONTRACTS.CTF_EXCHANGE, true],
          }),
          value: "0",
        },
        // Allow Neg Risk CTF Exchange to transfer outcome tokens
        {
          to: CONTRACTS.CTF,
          data: encodeFunctionData({
            abi: erc1155ApprovalAbi,
            functionName: "setApprovalForAll",
            args: [CONTRACTS.NEG_RISK_CTF_EXCHANGE, true],
          }),
          value: "0",
        },
        // Allow Neg Risk Adapter to transfer outcome tokens
        {
          to: CONTRACTS.CTF,
          data: encodeFunctionData({
            abi: erc1155ApprovalAbi,
            functionName: "setApprovalForAll",
            args: [CONTRACTS.NEG_RISK_ADAPTER, true],
          }),
          value: "0",
        },
      ];

      console.log("[RelayerClient] Submitting token approval transactions...");
      console.log("[RelayerClient] ERC-20 (USDC) approval targets:", {
        CTF: CONTRACTS.CTF,
        CTF_EXCHANGE: CONTRACTS.CTF_EXCHANGE,
        NEG_RISK_CTF_EXCHANGE: CONTRACTS.NEG_RISK_CTF_EXCHANGE,
        NEG_RISK_ADAPTER: CONTRACTS.NEG_RISK_ADAPTER,
      });
      console.log(
        "[RelayerClient] ERC-1155 (Outcome Token) approval targets:",
        {
          CTF_EXCHANGE: CONTRACTS.CTF_EXCHANGE,
          NEG_RISK_CTF_EXCHANGE: CONTRACTS.NEG_RISK_CTF_EXCHANGE,
          NEG_RISK_ADAPTER: CONTRACTS.NEG_RISK_ADAPTER,
        }
      );

      // Execute the approval transactions with retry logic
      // The Polymarket relayer can sometimes return STATE_FAILED intermittently
      const maxRetries = 3;
      let lastError: Error | null = null;
      let response: Awaited<ReturnType<typeof client.execute>> | null = null;

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

          response = await client.execute(approvalTxs);

          console.log("[RelayerClient] Approval response:", {
            transactionID: response.transactionID,
            state: response.state,
            hash: response.transactionHash,
            retry,
          });

          // Check if the initial response already indicates failure
          if (
            response.state === "STATE_FAILED" ||
            response.state === "STATE_INVALID"
          ) {
            console.warn(
              `[RelayerClient] Approval failed with state: ${response.state}, will retry...`
            );
            lastError = new Error(
              `Approval failed with state: ${response.state}`
            );
            continue; // Try again
          }

          // Success - break out of retry loop
          break;
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

      // If all retries failed, throw the last error
      if (
        !response ||
        response.state === "STATE_FAILED" ||
        response.state === "STATE_INVALID"
      ) {
        throw lastError || new Error("Approval failed after all retries");
      }

      const transactionId = response.transactionID;
      if (!transactionId) {
        throw new Error("No transaction ID returned from execute");
      }

      // Poll for the transaction result - simple polling loop
      const maxAttempts = 15;
      const pollInterval = 2000; // 2 seconds
      const successStates = [
        "STATE_EXECUTED",
        "STATE_MINED",
        "STATE_CONFIRMED",
      ];

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        console.log(
          `[RelayerClient] Polling attempt ${attempt + 1}/${maxAttempts}...`
        );
        const txns = await client.getTransaction(transactionId);

        if (txns && txns.length > 0) {
          const tx = txns[0];
          console.log(`[RelayerClient] Transaction state: ${tx.state}`);

          // Check for failure states
          if (tx.state === "STATE_FAILED" || tx.state === "STATE_INVALID") {
            console.error("[RelayerClient] Transaction failed:", tx);
            throw new Error(
              `Approval failed with state: ${tx.state}. ` +
                `Transaction hash: ${tx.transactionHash || "none"}`
            );
          }

          // Check for success states
          if (successStates.includes(tx.state)) {
            console.log(
              "[RelayerClient] Approval successful:",
              tx.transactionHash
            );
            setState((prev) => ({ ...prev, isLoading: false }));
            return {
              success: true,
              transactionHash: tx.transactionHash,
            };
          }
        }

        // Wait before next poll
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }
      }

      // If we get here, polling timed out but transaction was submitted
      // Consider it a success since the relayer accepted it
      console.log(
        "[RelayerClient] Approval polling timed out, but transaction was submitted"
      );
      setState((prev) => ({ ...prev, isLoading: false }));
      return {
        success: true,
        transactionHash: response.transactionHash || transactionId,
      };
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
  }, [getClient, deriveSafeAddress]);

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
