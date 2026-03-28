"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { encodeFunctionData, parseUnits } from "viem";
import { useConnection, useWalletClient } from "wagmi";
import { USDC_E_ADDRESS, USDC_E_DECIMALS } from "@/constants/contracts";
import { POLYGON_CHAIN_ID, RELAYER_API_URL } from "@/constants/polymarket";
import { createBuilderConfig } from "@/lib/remote-builder-config";
import { getBuilderSignProxyUrl } from "@/lib/sign-proxy-url";
import type { DepositStatus, QuoteResponse } from "./use-bridge";
import { useBridge } from "./use-bridge";
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

// ────────────────────────────────────────────────────────────
// Legacy Uniswap swap path (kept for reference — replaced by Polymarket Bridge API)
// ────────────────────────────────────────────────────────────
//
// const ERC20_APPROVE_ABI = [
//   {
//     name: "approve",
//     type: "function",
//     inputs: [
//       { name: "spender", type: "address" },
//       { name: "amount", type: "uint256" },
//     ],
//     outputs: [{ name: "", type: "bool" }],
//   },
// ] as const;
//
// const UNISWAP_V3_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
// const NATIVE_USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
// const POOL_FEE = 100;
// const MAX_SLIPPAGE_BPS = BigInt(10);
//
// const SWAP_ROUTER_ABI = [
//   {
//     name: "exactInputSingle",
//     type: "function",
//     inputs: [
//       {
//         name: "params",
//         type: "tuple",
//         components: [
//           { name: "tokenIn", type: "address" },
//           { name: "tokenOut", type: "address" },
//           { name: "fee", type: "uint24" },
//           { name: "recipient", type: "address" },
//           { name: "deadline", type: "uint256" },
//           { name: "amountIn", type: "uint256" },
//           { name: "amountOutMinimum", type: "uint256" },
//           { name: "sqrtPriceLimitX96", type: "uint160" },
//         ],
//       },
//     ],
//     outputs: [{ name: "amountOut", type: "uint256" }],
//   },
// ] as const;
// ────────────────────────────────────────────────────────────

/**
 * Withdrawal transaction states.
 * idle → signing → submitting → pending → confirmed → bridging → bridge_complete
 *                                                   ↘ failed
 */
export type WithdrawState =
  | "idle"
  | "signing"
  | "submitting"
  | "pending"
  | "confirmed"
  | "bridging"
  | "bridge_complete"
  | "failed";

/**
 * Withdrawal result
 */
export interface WithdrawResult {
  success: boolean;
  /** Indicates the transaction was submitted but confirmation status is unknown */
  pending?: boolean;
  transactionHash?: string;
  /** The bridge deposit address — used to poll GET /status/{address} */
  bridgeDepositAddress?: string;
  error?: string;
}

/**
 * Live bridge tracking info exposed to the UI
 */
export interface BridgeTrackingInfo {
  status: DepositStatus | null;
  depositAddress: string | null;
}

/**
 * Supported tokens for withdrawal
 */
export type WithdrawTokenId =
  | "usdc"
  | "usdc-e"
  | "usdt"
  | "dai"
  | "eth"
  | "pol"
  | "sol";

export interface WithdrawTokenConfig {
  id: WithdrawTokenId;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

/**
 * Token configurations.
 * Polymarket uses USDC.e (Bridged USDC) internally.
 * The `address` is the Polygon contract address for display / config purposes.
 * Destination-chain addresses are resolved dynamically from /supported-assets.
 */
export const WITHDRAW_TOKEN_CONFIGS: Record<
  WithdrawTokenId,
  WithdrawTokenConfig
> = {
  "usdc-e": {
    id: "usdc-e",
    symbol: "USDC.e",
    name: "Bridged USDC",
    address: USDC_E_ADDRESS,
    decimals: USDC_E_DECIMALS,
  },
  usdc: {
    id: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
  },
  usdt: {
    id: "usdt",
    symbol: "USDT",
    name: "Tether USD",
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    decimals: 6,
  },
  dai: {
    id: "dai",
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    decimals: 18,
  },
  eth: {
    id: "eth",
    symbol: "ETH",
    name: "Ether",
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    decimals: 18,
  },
  pol: {
    id: "pol",
    symbol: "POL",
    name: "Polygon",
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    decimals: 18,
  },
  sol: {
    id: "sol",
    symbol: "SOL",
    name: "Solana",
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    decimals: 9,
  },
};

/**
 * Chain IDs for withdrawal via the Polymarket Bridge API.
 * All chains (including Polygon) route through the bridge.
 */
export const WITHDRAW_CHAIN_IDS: Record<string, string> = {
  polygon: "137",
  ethereum: "1",
  base: "8453",
  arbitrum: "42161",
  optimism: "10",
  bsc: "56",
  solana: "1151111081099710",
};

/**
 * Maps a token symbol from the Bridge API to our internal WithdrawTokenId.
 */
const SYMBOL_TO_TOKEN_ID: Record<string, WithdrawTokenId> = {
  USDC: "usdc",
  "USDC.e": "usdc-e",
  USDT: "usdt",
  DAI: "dai",
  ETH: "eth",
  POL: "pol",
  SOL: "sol",
};

type SupportedAssetLike = {
  chainId: string;
  token: { symbol: string; address: string };
};

/**
 * Build a `chainId -> tokenId -> address` index from the live supported-assets API data.
 * When the API returns multiple addresses for the same symbol on a chain,
 * the first match wins (the API orders preferred contracts first).
 */
export function buildBridgeTokenIndex(
  supportedAssets: SupportedAssetLike[]
): Record<string, Partial<Record<WithdrawTokenId, string>>> {
  const index: Record<string, Partial<Record<WithdrawTokenId, string>>> = {};

  for (const asset of supportedAssets) {
    const tokenId = SYMBOL_TO_TOKEN_ID[asset.token.symbol];
    if (!tokenId) continue;

    if (!index[asset.chainId]) {
      index[asset.chainId] = {};
    }
    if (!index[asset.chainId][tokenId]) {
      index[asset.chainId][tokenId] = asset.token.address;
    }
  }

  return index;
}

/**
 * Resolve the destination token address for a given chain + token pair.
 * Falls back to USDC on the chain if the specific token isn't mapped.
 */
export function resolveDestTokenAddress(
  bridgeTokenIndex: Record<string, Partial<Record<WithdrawTokenId, string>>>,
  toChainId: string,
  tokenId: WithdrawTokenId
): string {
  const chainTokens = bridgeTokenIndex[toChainId];
  if (chainTokens?.[tokenId]) return chainTokens[tokenId] as string;
  if (chainTokens?.usdc) return chainTokens.usdc as string;
  return "";
}

/**
 * Which tokens are available for a given chain, derived from live API data.
 * Polygon always includes usdc/usdc-e (relayer path) plus any bridge-supported tokens.
 */
export function getAvailableTokensForChain(
  bridgeTokenIndex: Record<string, Partial<Record<WithdrawTokenId, string>>>,
  chainKey: string
): WithdrawTokenId[] {
  const chainId = WITHDRAW_CHAIN_IDS[chainKey] || "1";
  const chainTokens = bridgeTokenIndex[chainId];

  if (chainKey === "polygon") {
    const bridgeTokenIds = chainTokens
      ? (Object.keys(chainTokens) as WithdrawTokenId[])
      : [];
    const combined = new Set<WithdrawTokenId>([
      "usdc",
      "usdc-e",
      ...bridgeTokenIds,
    ]);
    return [...combined];
  }

  if (!chainTokens || Object.keys(chainTokens).length === 0) return ["usdc"];
  return Object.keys(chainTokens) as WithdrawTokenId[];
}

// All tokens (including Polygon USDC/USDC.e) now go through the Polymarket Bridge API.

/**
 * Parameters for initiating a withdrawal
 */
export interface WithdrawParams {
  /** Amount to withdraw in USDC (human-readable, e.g., "100.50") */
  amount: string;
  /** Destination address (external wallet) */
  destinationAddress: string;
  /** Token to receive (defaults to usdc-e) */
  tokenId?: WithdrawTokenId;
  /** Chain key (e.g. "polygon", "ethereum"). Defaults to "polygon". */
  chainId?: string;
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
  const {
    getWithdrawalAddresses,
    getQuote,
    getDepositStatus,
    supportedAssets,
  } = useBridge();
  const queryClient = useQueryClient();

  const [state, setState] = useState<WithdrawState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [bridgeTracking, setBridgeTracking] = useState<BridgeTrackingInfo>({
    status: null,
    depositAddress: null,
  });

  const bridgeStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  const bridgeTokenIndex = useMemo(
    () => buildBridgeTokenIndex(supportedAssets),
    [supportedAssets]
  );

  /**
   * Fetch a quote from the Polymarket Bridge API.
   * Call this when the user changes amount / chain / token.
   */
  const fetchWithdrawQuote = useCallback(
    async (
      amount: string,
      toChainId: string,
      toTokenAddress: string,
      recipientAddress: string
    ) => {
      if (!proxyAddress) return;

      const parsedAmount = Number.parseFloat(amount);
      if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        setQuote(null);
        setQuoteError(null);
        return;
      }

      setIsLoadingQuote(true);
      setQuoteError(null);

      try {
        const amountBaseUnit = parseUnits(amount, USDC_E_DECIMALS).toString();
        const result = await getQuote({
          fromAmountBaseUnit: amountBaseUnit,
          fromChainId: "137",
          fromTokenAddress: USDC_E_ADDRESS,
          recipientAddress,
          toChainId,
          toTokenAddress,
        });
        setQuote(result);
      } catch (err) {
        console.error("[Withdraw] Quote error:", err);
        setQuoteError(
          err instanceof Error ? err.message : "Failed to fetch quote"
        );
        setQuote(null);
      } finally {
        setIsLoadingQuote(false);
      }
    },
    [proxyAddress, getQuote]
  );

  /**
   * Start polling the bridge status endpoint after the relayer confirms.
   */
  const startBridgeStatusPolling = useCallback(
    (depositAddress: string) => {
      if (bridgeStatusPollRef.current) {
        clearInterval(bridgeStatusPollRef.current);
      }

      setBridgeTracking({ status: null, depositAddress });
      setState("bridging");

      const poll = async () => {
        try {
          const txns = await getDepositStatus(depositAddress);
          if (txns.length > 0) {
            const latest = txns[txns.length - 1];
            setBridgeTracking({ status: latest.status, depositAddress });

            if (latest.status === "COMPLETED") {
              setState("bridge_complete");
              if (bridgeStatusPollRef.current) {
                clearInterval(bridgeStatusPollRef.current);
                bridgeStatusPollRef.current = null;
              }
            } else if (latest.status === "FAILED") {
              setState("failed");
              setError(
                "Bridge transfer failed. Your funds may be recoverable — contact Polymarket support."
              );
              if (bridgeStatusPollRef.current) {
                clearInterval(bridgeStatusPollRef.current);
                bridgeStatusPollRef.current = null;
              }
            }
          }
        } catch (err) {
          console.error("[Withdraw] Bridge status poll error:", err);
        }
      };

      poll();
      bridgeStatusPollRef.current = setInterval(poll, 5000);
    },
    [getDepositStatus]
  );

  const stopBridgeStatusPolling = useCallback(() => {
    if (bridgeStatusPollRef.current) {
      clearInterval(bridgeStatusPollRef.current);
      bridgeStatusPollRef.current = null;
    }
  }, []);

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

  // ────────────────────────────────────────────────────────────
  // Legacy Polygon-only withdrawal via direct transfer / Uniswap swap
  // Replaced by the Polymarket Bridge API path for all tokens and chains.
  // ────────────────────────────────────────────────────────────
  //
  // const buildPolygonWithdrawTxs = (
  //   destinationAddress: string,
  //   amountInWei: bigint,
  //   tokenId: WithdrawTokenId
  // ): Array<{ to: string; data: string; value: string }> => {
  //   const transactions: Array<{ to: string; data: string; value: string }> = [];
  //
  //   if (tokenId === "usdc") {
  //     const approveData = encodeFunctionData({
  //       abi: ERC20_APPROVE_ABI,
  //       functionName: "approve",
  //       args: [UNISWAP_V3_ROUTER as `0x${string}`, amountInWei],
  //     });
  //     transactions.push({
  //       to: USDC_E_ADDRESS,
  //       data: approveData,
  //       value: "0",
  //     });
  //
  //     const amountOutMinimum =
  //       amountInWei - (amountInWei * MAX_SLIPPAGE_BPS) / BigInt(10000);
  //     const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  //     const swapData = encodeFunctionData({
  //       abi: SWAP_ROUTER_ABI,
  //       functionName: "exactInputSingle",
  //       args: [
  //         {
  //           tokenIn: USDC_E_ADDRESS as `0x${string}`,
  //           tokenOut: NATIVE_USDC_ADDRESS as `0x${string}`,
  //           fee: POOL_FEE,
  //           recipient: destinationAddress as `0x${string}`,
  //           deadline,
  //           amountIn: amountInWei,
  //           amountOutMinimum,
  //           sqrtPriceLimitX96: BigInt(0),
  //         },
  //       ],
  //     });
  //     transactions.push({
  //       to: UNISWAP_V3_ROUTER,
  //       data: swapData,
  //       value: "0",
  //     });
  //   } else {
  //     const transferData = encodeFunctionData({
  //       abi: ERC20_TRANSFER_ABI,
  //       functionName: "transfer",
  //       args: [destinationAddress as `0x${string}`, amountInWei],
  //     });
  //     transactions.push({
  //       to: USDC_E_ADDRESS,
  //       data: transferData,
  //       value: "0",
  //     });
  //   }
  //
  //   return transactions;
  // };
  // ────────────────────────────────────────────────────────────

  /**
   * Submit transactions via relayer and poll for confirmation.
   */
  const submitAndPollRelayer = async (
    transactions: Array<{ to: string; data: string; value: string }>
  ): Promise<WithdrawResult> => {
    const client = await getClient();

    setState("submitting");
    const response = await client.execute(transactions, "funwithdraw");

    console.log("[Withdraw] Transaction submitted:", {
      transactionID: response.transactionID,
      state: response.state,
    });

    setState("pending");

    const result = await response.wait();

    if (
      result &&
      (result.state === "STATE_CONFIRMED" || result.state === "STATE_MINED")
    ) {
      console.log("[Withdraw] Transaction confirmed:", result.transactionHash);
      setState("confirmed");
      await refreshBalance();
      return { success: true, transactionHash: result.transactionHash };
    }

    const maxAttempts = 15;
    const pollInterval = 2000;
    const successStates = ["STATE_EXECUTED", "STATE_MINED", "STATE_CONFIRMED"];

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
          console.log("[Withdraw] Withdrawal confirmed:", tx.transactionHash);
          setState("confirmed");
          await refreshBalance();
          return { success: true, transactionHash: tx.transactionHash };
        }
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    console.log(
      "[Withdraw] Polling timed out, transaction status unknown - treating as pending"
    );
    setState("pending");

    return {
      success: false,
      pending: true,
      transactionHash: response.transactionHash || response.transactionID,
    };
  };

  /**
   * Execute a withdrawal from the proxy wallet via the Polymarket Bridge API.
   *
   * All withdrawals (including Polygon USDC/USDC.e) call `POST /withdraw`
   * to obtain a bridge deposit address, then transfer USDC.e to that address
   * via the relayer. The bridge handles routing, swapping, and delivery to
   * the recipient on the destination chain.
   */
  const withdrawMutation = useMutation({
    mutationFn: async ({
      amount,
      destinationAddress,
      tokenId = "usdc-e",
      chainId = "polygon",
    }: WithdrawParams): Promise<WithdrawResult> => {
      const parsedAmount = Number.parseFloat(amount);
      if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Invalid withdrawal amount");
      }

      const toChainId = WITHDRAW_CHAIN_IDS[chainId] || "137";

      if (chainId === "solana") {
        if (!destinationAddress || destinationAddress.length < 10) {
          throw new Error("Invalid Solana address");
        }
      } else if (
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

      const tokenConfig = WITHDRAW_TOKEN_CONFIGS[tokenId];
      if (!tokenConfig) {
        throw new Error(`Unsupported token: ${tokenId}`);
      }

      // Bridge requires a minimum of ~$2 per the /supported-assets minCheckoutUsd
      const MIN_BRIDGE_AMOUNT_USD = 2;
      if (parsedAmount < MIN_BRIDGE_AMOUNT_USD) {
        throw new Error(
          `Minimum withdrawal is $${MIN_BRIDGE_AMOUNT_USD}. The Polymarket Bridge requires at least $${MIN_BRIDGE_AMOUNT_USD} to process.`
        );
      }

      setState("signing");
      setError(null);

      try {
        const amountInWei = parseUnits(amount, USDC_E_DECIMALS);

        // ─── Bridge path (all tokens, all chains) ───
        const toTokenAddress = resolveDestTokenAddress(
          bridgeTokenIndex,
          toChainId,
          tokenId
        );

        if (!toTokenAddress) {
          throw new Error(
            `Token ${tokenId} is not supported on this chain. Please try a different token.`
          );
        }

        console.log("[Withdraw] Requesting bridge withdrawal addresses:", {
          address: proxyAddress,
          toChainId,
          toTokenAddress,
          recipientAddr: destinationAddress,
        });

        const bridgeResponse = await getWithdrawalAddresses({
          address: proxyAddress,
          toChainId,
          toTokenAddress,
          recipientAddr: destinationAddress,
        });

        const bridgeDepositAddress =
          toChainId === "1151111081099710"
            ? bridgeResponse.address.svm
            : bridgeResponse.address.evm;

        if (!bridgeDepositAddress) {
          throw new Error(
            "Bridge did not return a deposit address for the selected chain"
          );
        }

        console.log("[Withdraw] Bridge deposit address:", bridgeDepositAddress);

        const transferData = encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [bridgeDepositAddress as `0x${string}`, amountInWei],
        });

        const transactions = [
          {
            to: USDC_E_ADDRESS,
            data: transferData,
            value: "0",
          },
        ];

        console.log("[Withdraw] Bridge withdrawal:", {
          from: proxyAddress,
          bridgeAddress: bridgeDepositAddress,
          recipient: destinationAddress,
          chain: chainId,
          toChainId,
          token: tokenId,
          toTokenAddress,
          amount,
        });

        const relayerResult = await submitAndPollRelayer(transactions);

        if (relayerResult.success) {
          startBridgeStatusPolling(bridgeDepositAddress);
        }

        return {
          ...relayerResult,
          bridgeDepositAddress,
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
    setQuote(null);
    setQuoteError(null);
    setBridgeTracking({ status: null, depositAddress: null });
    stopBridgeStatusPolling();
  }, [stopBridgeStatusPolling]);

  return {
    // Actions
    withdraw,
    reset,
    fetchWithdrawQuote,

    // State
    state,
    error,
    isWithdrawing: withdrawMutation.isPending,
    isConnected,
    proxyAddress,
    usdcBalance,

    // Quote
    quote,
    isLoadingQuote,
    quoteError,

    // Bridge status tracking
    bridgeTracking,

    // Dynamic token index built from /supported-assets
    bridgeTokenIndex,

    // Validation helpers
    canWithdraw: isConnected && !!proxyAddress && usdcBalance > 0,
    maxWithdrawAmount: usdcBalance,
  };
}
