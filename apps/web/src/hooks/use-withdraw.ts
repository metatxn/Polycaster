"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { encodeFunctionData, parseUnits } from "viem";
import { useConnection, useWalletClient } from "wagmi";
import { USDC_E_ADDRESS, USDC_E_DECIMALS } from "@/constants/contracts";
import { POLYGON_CHAIN_ID, RELAYER_API_URL } from "@/constants/polymarket";
import { createBuilderConfig } from "@/lib/remote-builder-config";
import { getBuilderSignProxyUrl } from "@/lib/sign-proxy-url";
import { PROXY_WALLET_QUERY_KEY, useProxyWallet } from "./use-proxy-wallet";

/**
 * ERC20 transfer ABI for encoding the transfer call
 */
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * ERC20 approve ABI for encoding the approve call
 */
const ERC20_APPROVE_ABI = [
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

/**
 * Uniswap V3 SwapRouter address on Polygon
 * @see https://docs.uniswap.org/contracts/v3/reference/deployments/polygon-deployments
 */
const UNISWAP_V3_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

/**
 * Native USDC address on Polygon (Circle's native USDC)
 */
const NATIVE_USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

/**
 * Pool fee tier for USDC.e/USDC pair (0.01% = 100 in Uniswap terms)
 * This is the lowest fee tier, designed for stablecoin pairs
 */
const POOL_FEE = 100;

/**
 * Maximum slippage tolerance in basis points (10bp = 0.1%)
 * Polymarket enforces less than 10bp difference in output amount
 */
const MAX_SLIPPAGE_BPS = BigInt(10);

/**
 * Uniswap V3 SwapRouter exactInputSingle ABI
 * @see https://docs.uniswap.org/contracts/v3/reference/periphery/interfaces/ISwapRouter
 */
const SWAP_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

/**
 * Withdrawal transaction states
 */
export type WithdrawState =
  | "idle"
  | "signing"
  | "submitting"
  | "pending"
  | "confirmed"
  | "failed";

/**
 * Withdrawal result
 */
export interface WithdrawResult {
  success: boolean;
  /** Indicates the transaction was submitted but confirmation status is unknown */
  pending?: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * Supported tokens for withdrawal
 */
export type WithdrawTokenId = "usdc" | "usdc-e";

export interface WithdrawTokenConfig {
  id: WithdrawTokenId;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

/**
 * Token configurations
 * Note: Polymarket uses USDC.e (Bridged USDC) internally
 */
export const WITHDRAW_TOKEN_CONFIGS: Record<
  WithdrawTokenId,
  WithdrawTokenConfig
> = {
  "usdc-e": {
    id: "usdc-e",
    symbol: "USDC.e",
    name: "Bridged USDC",
    address: USDC_E_ADDRESS, // 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
    decimals: USDC_E_DECIMALS,
  },
  usdc: {
    id: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    // Native USDC on Polygon (Circle's native USDC)
    address: NATIVE_USDC_ADDRESS,
    decimals: 6,
  },
};

/**
 * Parameters for initiating a withdrawal
 */
export interface WithdrawParams {
  /** Amount to withdraw in USDC (human-readable, e.g., "100.50") */
  amount: string;
  /** Destination address (external wallet) */
  destinationAddress: string;
  /** Token to withdraw (defaults to usdc-e) */
  tokenId?: WithdrawTokenId;
}

/**
 * Hook for withdrawing USDC from Polymarket proxy wallet to external wallet
 *
 * Uses the Polymarket relayer to execute gasless transactions from the Safe wallet.
 * The withdrawal is a simple ERC20 transfer from the proxy wallet to the external address.
 *
 * @example
 * ```tsx
 * const { withdraw, isWithdrawing, state, error } = useWithdraw();
 *
 * const handleWithdraw = async () => {
 *   const result = await withdraw({
 *     amount: "100",
 *     destinationAddress: "0x..."
 *   });
 *   if (result.success) {
 *     console.log("Withdrawal successful:", result.transactionHash);
 *   }
 * };
 * ```
 */
export function useWithdraw() {
  const { address, isConnected } = useConnection();
  const { data: walletClient } = useWalletClient();
  const {
    proxyAddress,
    usdcBalance,
    refresh: refreshBalance,
  } = useProxyWallet();
  const queryClient = useQueryClient();

  const [state, setState] = useState<WithdrawState>("idle");
  const [error, setError] = useState<string | null>(null);

  /**
   * Initialize the RelayClient for executing the withdrawal
   */
  const getClient = useCallback(async () => {
    if (!walletClient || !address) {
      throw new Error("Wallet not connected");
    }

    const signProxyUrl = getBuilderSignProxyUrl();

    // Dynamic import to avoid SSR issues
    const { RelayClient } = await import("@polymarket/builder-relayer-client");
    const builderConfig = createBuilderConfig({
      url: signProxyUrl,
    });

    const client = new RelayClient(
      RELAYER_API_URL,
      POLYGON_CHAIN_ID,
      walletClient,
      builderConfig
    );

    return client;
  }, [walletClient, address]);

  /**
   * Execute a withdrawal from the proxy wallet
   */
  const withdrawMutation = useMutation({
    mutationFn: async ({
      amount,
      destinationAddress,
      tokenId = "usdc-e",
    }: WithdrawParams): Promise<WithdrawResult> => {
      // Validate inputs
      const parsedAmount = Number.parseFloat(amount);
      if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Invalid withdrawal amount");
      }

      if (
        !destinationAddress ||
        !/^0x[a-fA-F0-9]{40}$/.test(destinationAddress)
      ) {
        throw new Error("Invalid destination address");
      }

      if (!proxyAddress) {
        throw new Error(
          "Trading wallet not found. Please complete trading setup first."
        );
      }

      if (parsedAmount > usdcBalance) {
        throw new Error(
          `Insufficient balance. Available: $${usdcBalance.toFixed(2)}`
        );
      }

      // Get token config
      const tokenConfig = WITHDRAW_TOKEN_CONFIGS[tokenId];
      if (!tokenConfig) {
        throw new Error(`Unsupported token: ${tokenId}`);
      }

      setState("signing");
      setError(null);

      try {
        // Get the relay client
        const client = await getClient();

        // Convert amount to token base units (always 6 decimals for both USDC variants)
        const amountInWei = parseUnits(amount, USDC_E_DECIMALS);

        // Build transactions based on selected token
        const transactions: Array<{ to: string; data: string; value: string }> =
          [];

        if (tokenId === "usdc") {
          // Native USDC: Need to swap USDC.e -> USDC via Uniswap V3, then it goes directly to recipient
          // Step 1: Approve Uniswap V3 Router to spend USDC.e
          const approveData = encodeFunctionData({
            abi: ERC20_APPROVE_ABI,
            functionName: "approve",
            args: [UNISWAP_V3_ROUTER as `0x${string}`, amountInWei],
          });

          transactions.push({
            to: USDC_E_ADDRESS, // USDC.e address
            data: approveData,
            value: "0",
          });

          // Step 2: Swap USDC.e -> Native USDC via Uniswap V3
          // Calculate minimum output with 10bp slippage tolerance (Polymarket's approach)
          const amountOutMinimum =
            amountInWei - (amountInWei * MAX_SLIPPAGE_BPS) / BigInt(10000);

          // Deadline: 20 minutes from now
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

          const swapData = encodeFunctionData({
            abi: SWAP_ROUTER_ABI,
            functionName: "exactInputSingle",
            args: [
              {
                tokenIn: USDC_E_ADDRESS as `0x${string}`, // USDC.e
                tokenOut: NATIVE_USDC_ADDRESS as `0x${string}`, // Native USDC
                fee: POOL_FEE,
                recipient: destinationAddress as `0x${string}`, // Send directly to user's EOA
                deadline,
                amountIn: amountInWei,
                amountOutMinimum,
                sqrtPriceLimitX96: BigInt(0), // No price limit
              },
            ],
          });

          transactions.push({
            to: UNISWAP_V3_ROUTER,
            data: swapData,
            value: "0",
          });

          console.log("[Withdraw] Submitting swap withdrawal transaction:", {
            from: proxyAddress,
            to: destinationAddress,
            tokenIn: "USDC.e",
            tokenOut: "USDC",
            amount,
            amountInWei: amountInWei.toString(),
            amountOutMinimum: amountOutMinimum.toString(),
            slippageBps: MAX_SLIPPAGE_BPS.toString(),
          });
        } else {
          // USDC.e: Direct transfer (no swap needed)
          const transferData = encodeFunctionData({
            abi: ERC20_TRANSFER_ABI,
            functionName: "transfer",
            args: [destinationAddress as `0x${string}`, amountInWei],
          });

          transactions.push({
            to: USDC_E_ADDRESS, // USDC.e address
            data: transferData,
            value: "0",
          });

          console.log("[Withdraw] Submitting direct transfer transaction:", {
            from: proxyAddress,
            to: destinationAddress,
            token: "USDC.e",
            amount,
            amountInWei: amountInWei.toString(),
          });
        }

        setState("submitting");

        // Execute the withdrawal via relayer (gasless)
        // For native USDC, this batches approve + swap atomically
        // For USDC.e, this is a single transfer
        const response = await client.execute(transactions, "funwithdraw");

        console.log("[Withdraw] Transaction submitted:", {
          transactionID: response.transactionID,
          state: response.state,
        });

        setState("pending");

        // Wait for confirmation
        const result = await response.wait();

        if (
          result &&
          (result.state === "STATE_CONFIRMED" || result.state === "STATE_MINED")
        ) {
          console.log(
            "[Withdraw] Transaction confirmed:",
            result.transactionHash
          );
          setState("confirmed");

          // Refresh balance after successful withdrawal
          await refreshBalance();

          return {
            success: true,
            transactionHash: result.transactionHash,
          };
        }

        // If not confirmed, poll for status
        const maxAttempts = 15;
        const pollInterval = 2000;
        const successStates = [
          "STATE_EXECUTED",
          "STATE_MINED",
          "STATE_CONFIRMED",
        ];

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          console.log(
            `[Withdraw] Polling attempt ${attempt + 1}/${maxAttempts}...`
          );
          const txns = await client.getTransaction(response.transactionID);

          if (txns && txns.length > 0) {
            const tx = txns[0];
            console.log(`[Withdraw] Transaction state: ${tx.state}`);

            if (tx.state === "STATE_FAILED" || tx.state === "STATE_INVALID") {
              throw new Error(`Withdrawal failed with state: ${tx.state}`);
            }

            if (successStates.includes(tx.state)) {
              console.log(
                "[Withdraw] Withdrawal confirmed:",
                tx.transactionHash
              );
              setState("confirmed");

              // Refresh balance
              await refreshBalance();

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

        // If polling times out but transaction was submitted, it's still pending (not confirmed)
        // Return success: false with pending: true to indicate the transaction was submitted
        // but we couldn't confirm it within the timeout period
        console.log(
          "[Withdraw] Polling timed out, transaction status unknown - treating as pending"
        );
        setState("pending");

        return {
          success: false,
          pending: true,
          transactionHash: response.transactionHash || response.transactionID,
        };
      } catch (err) {
        console.error("[Withdraw] Error:", err);
        const errorMessage =
          err instanceof Error ? err.message : "Withdrawal failed";
        setState("failed");
        setError(errorMessage);
        throw err;
      }
    },
    onSuccess: () => {
      // Invalidate proxy wallet query to refresh balance
      queryClient.invalidateQueries({
        queryKey: [PROXY_WALLET_QUERY_KEY, address],
      });
    },
    onError: (err) => {
      const errorMessage =
        err instanceof Error ? err.message : "Withdrawal failed";
      setState("failed");
      setError(errorMessage);
    },
  });

  /**
   * Execute a withdrawal
   */
  const withdraw = useCallback(
    async (params: WithdrawParams): Promise<WithdrawResult> => {
      try {
        return await withdrawMutation.mutateAsync(params);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Withdrawal failed",
        };
      }
    },
    [withdrawMutation]
  );

  /**
   * Reset the withdrawal state
   */
  const reset = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);

  return {
    // Actions
    withdraw,
    reset,

    // State
    state,
    error,
    isWithdrawing: withdrawMutation.isPending,
    isConnected,
    proxyAddress,
    usdcBalance,

    // Validation helpers
    canWithdraw: isConnected && !!proxyAddress && usdcBalance > 0,
    maxWithdrawAmount: usdcBalance,
  };
}
