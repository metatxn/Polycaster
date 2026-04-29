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
import Decimal from "decimal.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWalletClient } from "wagmi";

const log = createLogger("relayer-client");

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
  getPublicClient,
  checkIsDeployed as rpcCheckIsDeployed,
} from "@/lib/rpc";
import { useTradingWalletMode } from "./use-trading-wallet-mode";

const POLYMARKET_RELAYER_URL = RELAYER_API_URL;
const CHAIN_ID = POLYGON_CHAIN_ID;
const DEFAULT_APPROVAL_AMOUNT = "100";
const APPROVAL_DECIMALS = 6;

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

function normalizeApprovalAmount(amount?: string): string {
  const decimal = new Decimal(amount || DEFAULT_APPROVAL_AMOUNT);
  if (!decimal.isFinite() || decimal.lte(0)) {
    throw new Error("Approval amount must be greater than 0");
  }
  return decimal
    .toDecimalPlaces(APPROVAL_DECIMALS, Decimal.ROUND_DOWN)
    .toFixed();
}

export function useRelayerClient() {
  const { address, isConnected } = useConnection();
  const { data: walletClient } = useWalletClient();
  const { mode, isEoaMode } = useTradingWalletMode();

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
    if (isEoaMode) return address;
    try {
      return derivePolymarketSafe(address as `0x${string}`);
    } catch (err) {
      log.warn("derive.failed", err);
      return null;
    }
  }, [address, isEoaMode]);

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
      }));
      return {
        success: true,
        transactionHash: "",
        proxyAddress: address,
        alreadyDeployed: true,
      };
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await relayerDeploySafe(
        walletClient,
        address as `0x${string}`
      );
      const safe = derivePolymarketSafe(address as `0x${string}`);

      log.info("safe.deployed", {
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

      log.error("deploy.error", deployErr);
      const errorMessage = errMessage || "Failed to deploy Safe";
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return { success: false, error: errorMessage };
    }
  }, [walletClient, address, isEoaMode]);

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
  const approveUsdcForTrading = useCallback(
    async (approvalAmount?: string) => {
      if (!walletClient || !address) {
        return { success: false, error: "Wallet not connected" };
      }
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const { encodeFunctionData, parseUnits } = await import("viem");
        const { polygon } = await import("viem/chains");
        const { checkAllApprovals } = await import("@/lib/approvals");
        const normalizedApprovalAmount =
          normalizeApprovalAmount(approvalAmount);
        const approvalAmountRaw = parseUnits(
          normalizedApprovalAmount,
          APPROVAL_DECIMALS
        );

        // First, verify the Safe is deployed
        const expectedSafe = await deriveSafeAddress();
        if (!expectedSafe) {
          throw new Error(
            "Could not derive Safe address. Please ensure your wallet is connected."
          );
        }

        const isDeployed = isEoaMode
          ? true
          : await getDeployed(expectedSafe as `0x${string}`);
        log.debug("approvals.safe_check", { expectedSafe, isDeployed });

        // Check if approvals are already set
        log.debug("approvals.checking");
        const approvalStatus = await checkAllApprovals(expectedSafe);
        log.debug("approvals.status", approvalStatus);

        if (approvalStatus.allApproved) {
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
          const { erc20Abi } = await import("viem");
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

          const txHashes: `0x${string}`[] = [];
          const writeErc20Approval = async (
            token: `0x${string}`,
            spender: `0x${string}`
          ) => {
            const hash = await walletClient.writeContract({
              account: address as `0x${string}`,
              chain: polygon,
              address: token,
              abi: erc20Abi,
              functionName: "approve",
              args: [spender, approvalAmountRaw],
            });
            txHashes.push(hash);
            await publicClient.waitForTransactionReceipt({ hash });
          };
          const writeErc1155Approval = async (operator: `0x${string}`) => {
            const hash = await walletClient.writeContract({
              account: address as `0x${string}`,
              chain: polygon,
              address: CONTRACTS.CTF,
              abi: erc1155ApprovalAbi,
              functionName: "setApprovalForAll",
              args: [operator, true],
            });
            txHashes.push(hash);
            await publicClient.waitForTransactionReceipt({ hash });
          };

          if (!approvalStatus.pusdCtfExchange) {
            await writeErc20Approval(CONTRACTS.PUSD, CONTRACTS.CTF_EXCHANGE);
          }
          if (!approvalStatus.pusdNegRiskExchange) {
            await writeErc20Approval(
              CONTRACTS.PUSD,
              CONTRACTS.NEG_RISK_CTF_EXCHANGE
            );
          }
          if (!approvalStatus.pusdNegRiskAdapter) {
            await writeErc20Approval(
              CONTRACTS.PUSD,
              CONTRACTS.NEG_RISK_ADAPTER
            );
          }
          if (!approvalStatus.usdcOnramp) {
            await writeErc20Approval(
              CONTRACTS.USDC_E,
              CONTRACTS.COLLATERAL_ONRAMP
            );
          }
          if (!approvalStatus.ctfExchangeApproval) {
            await writeErc1155Approval(CONTRACTS.CTF_EXCHANGE);
          }
          if (!approvalStatus.ctfNegRiskExchangeApproval) {
            await writeErc1155Approval(CONTRACTS.NEG_RISK_CTF_EXCHANGE);
          }
          if (!approvalStatus.ctfNegRiskAdapterApproval) {
            await writeErc1155Approval(CONTRACTS.NEG_RISK_ADAPTER);
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
        const erc20Approve = (
          token: `0x${string}`,
          spender: `0x${string}`
        ) => ({
          to: token,
          data: encodeFunctionData({
            abi: erc20ApproveAbi,
            functionName: "approve",
            args: [spender, approvalAmountRaw],
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
          // pUSD → V2 exchanges (BUY settlement)
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

        log.debug("approvals.submitting", {
          pusdTargets: PUSD_APPROVAL_TARGETS,
          amount: normalizedApprovalAmount,
          usdcEOnramp: CONTRACTS.COLLATERAL_ONRAMP,
          ctfOperators: CTF_APPROVAL_OPERATORS,
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

            result = await executeViaRelayer(
              walletClient,
              address as `0x${string}`,
              approvalTxs.map((t) => ({
                to: t.to as `0x${string}`,
                data: t.data as `0x${string}`,
                value: t.value,
              }))
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
    [walletClient, address, deriveSafeAddress, isEoaMode]
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
        if (isEoaMode) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isInitialized: true,
            hasDeployedSafe: true,
            proxyAddress: address ?? null,
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
        }));
      } catch (err) {
        log.error("deployment.check_error", err);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isInitialized: true,
          error: err instanceof Error ? err.message : "Failed to check Safe",
        }));
      }
    },
    [address, deriveSafeAddress, checkIsDeployed, isEoaMode]
  );

  /**
   * Force check deployment with cache clearing
   */
  const forceCheckSafeDeployment = useCallback(async () => {
    // Clear the deployment cache for this address
    const derivedAddress = await deriveSafeAddress();
    if (derivedAddress && mode === "safe") {
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
