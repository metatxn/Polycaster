"use client";

import { createLogger } from "@knoww/logger";
import {
  buildBridgeTokenIndex,
  type DepositStatus,
  getAvailableTokensForChain,
  type QuoteResponse,
  resolveDestTokenAddress,
  validateWithdrawBridgeDestination,
  WITHDRAW_CHAIN_IDS,
  WITHDRAW_TOKEN_CONFIGS,
  type WithdrawTokenId,
} from "@knoww/shared-types/bridge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { encodeFunctionData, getAddress, parseUnits } from "viem";
import { useConnection, useWalletClient } from "wagmi";
import { PUSD_ADDRESS, PUSD_DECIMALS } from "@/constants/contracts";
import { qk } from "@/lib/query-keys";
import {
  executeViaDepositWallet,
  executeViaRelayer,
} from "@/lib/relayer-client";
import { getViemWalletClient } from "@/lib/viem-wallet-client";
import { useBridge } from "./use-bridge";
import { useProxyWallet } from "./use-proxy-wallet";

const log = createLogger("withdraw");

export type { WithdrawTokenId };
export {
  buildBridgeTokenIndex,
  getAvailableTokensForChain,
  resolveDestTokenAddress,
  WITHDRAW_CHAIN_IDS,
  WITHDRAW_TOKEN_CONFIGS,
};

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
  transactionHash: string | null;
}

// Withdrawals go through the Polymarket Bridge API. For Polygon USDC, the bridge
// owns the Collateral Offramp / Uniswap route after receiving pUSD.

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
 * The Bridge API returns a destination-configured address. We transfer pUSD to
 * that address; Polymarket routes/swaps it to the requested destination token.
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
 *     return result.transactionHash;
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
    isEoaMode,
    walletMode,
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
    transactionHash: null,
  });

  const bridgeStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  const bridgeTokenIndex = useMemo(
    () => buildBridgeTokenIndex(supportedAssets),
    [supportedAssets]
  );

  const resolveWithdrawalSigner = useCallback(async () => {
    const hookAccount = address
      ? (address as `0x${string}`)
      : walletClient?.account?.address;

    if (!walletClient) {
      log.debug("wallet_client.missing.fallback_provider", {
        hasAddress: Boolean(address),
        isConnected,
      });
    }

    const signer = await getViemWalletClient(walletClient, hookAccount);
    const accounts = hookAccount
      ? [hookAccount]
      : await signer.requestAddresses();
    const account = accounts[0];

    if (!account) {
      throw new Error("Wallet not connected. Please reconnect and try again.");
    }

    return {
      signer,
      account: getAddress(account) as `0x${string}`,
    };
  }, [address, isConnected, walletClient]);

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
        const amountBaseUnit = parseUnits(amount, PUSD_DECIMALS).toString();
        const result = await getQuote({
          fromAmountBaseUnit: amountBaseUnit,
          fromChainId: "137",
          fromTokenAddress: PUSD_ADDRESS,
          recipientAddress,
          toChainId,
          toTokenAddress,
        });
        setQuote(result);
      } catch (err) {
        log.error("quote.failed", err);
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

      setBridgeTracking({
        status: null,
        depositAddress,
        transactionHash: null,
      });
      setState("bridging");

      const poll = async () => {
        try {
          const txns = await getDepositStatus(depositAddress);
          if (txns.length > 0) {
            const latest = txns[txns.length - 1];
            setBridgeTracking({
              status: latest.status,
              depositAddress,
              transactionHash: latest.txHash ?? null,
            });

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
          log.error("bridge.status_poll.failed", err);
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
   * Submit transactions via relayer and poll for confirmation.
   *
   * `executeViaRelayer` submits to /api/relayer and polls /transaction until
   * the relayer reports a success state (throws on failure/timeout). We surface
   * the on-chain hash to the caller once the tx lands.
   */
  const submitAndPollRelayer = async (
    transactions: Array<{ to: string; data: string; value: string }>
  ): Promise<WithdrawResult> => {
    const { signer, account } = await resolveWithdrawalSigner();

    setState("submitting");

    if (isEoaMode) {
      const { polygon } = await import("@/lib/chains");
      const { getPublicClient } = await import("@/lib/rpc");
      let lastHash: `0x${string}` | null = null;
      for (const tx of transactions) {
        const hash = await signer.sendTransaction({
          account,
          chain: polygon,
          to: tx.to as `0x${string}`,
          data: tx.data as `0x${string}`,
          value: BigInt(tx.value || "0"),
        });
        lastHash = hash;
        await getPublicClient().waitForTransactionReceipt({ hash });
      }

      if (!lastHash) throw new Error("No withdrawal transaction submitted");
      log.info("tx.confirmed", { transactionHash: lastHash });
      setState("confirmed");
      await refreshBalance();
      return { success: true, transactionHash: lastHash };
    }

    const relayerTransactions = transactions.map((t) => ({
      to: t.to as `0x${string}`,
      data: t.data as `0x${string}`,
      value: t.value,
    }));
    const result =
      walletMode === "deposit"
        ? await executeViaDepositWallet(signer, account, relayerTransactions)
        : await executeViaRelayer(signer, account, relayerTransactions);

    log.info("tx.confirmed", { transactionHash: result.transactionHash });
    setState("confirmed");
    await refreshBalance();
    return { success: true, transactionHash: result.transactionHash };
  };

  /**
   * Execute a withdrawal from the proxy wallet via the Polymarket Bridge API.
   *
   * All withdrawals call `POST /withdraw` to obtain a bridge deposit address,
   * then transfer pUSD (V2 collateral) from the Safe to that address via the
   * relayer. The bridge handles conversion, routing, and delivery to the
   * recipient on the destination chain.
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

      setState("signing");
      setError(null);

      try {
        const amountInWei = parseUnits(amount, PUSD_DECIMALS);

        // ─── Bridge path ───
        // Bridge requires a minimum of ~$2 per the /supported-assets minCheckoutUsd.
        const MIN_BRIDGE_AMOUNT_USD = 2;
        if (parsedAmount < MIN_BRIDGE_AMOUNT_USD) {
          throw new Error(
            `Minimum withdrawal is $${MIN_BRIDGE_AMOUNT_USD}. The Polymarket Bridge requires at least $${MIN_BRIDGE_AMOUNT_USD} to process.`
          );
        }

        const toTokenAddress =
          resolveDestTokenAddress(bridgeTokenIndex, toChainId, tokenId) ||
          (toChainId === "137" ? tokenConfig.address : "");

        if (!toTokenAddress) {
          throw new Error(
            `Token ${tokenId} is not supported on this chain. Please try a different token.`
          );
        }
        try {
          validateWithdrawBridgeDestination({
            toTokenAddress,
            recipientAddress: destinationAddress,
            sourceAddress: proxyAddress,
          });
        } catch (err) {
          log.warn("bridge.destination.rejected", {
            error: err,
            tokenId,
            toChainId,
            toTokenAddress,
            proxyAddress,
            destinationAddress,
          });
          throw err;
        }

        log.info("bridge.addresses.requesting", {
          address: proxyAddress,
          toChainId,
          toTokenAddress,
          recipientAddr: destinationAddress,
          tokenId,
          tokenSymbol: tokenConfig.symbol,
          amountBaseUnit: amountInWei.toString(),
        });

        const bridgeResponse = await getWithdrawalAddresses({
          address: proxyAddress,
          toChainId,
          toTokenAddress,
          recipientAddr: destinationAddress,
        });

        // Always use the EVM deposit address for the on-chain ERC20 transfer
        // on Polygon. For Solana withdrawals, the bridge's EVM address receives
        // the funds and routes them to the recipient's SVM address.
        const bridgeDepositAddress = bridgeResponse.address.evm;

        if (!bridgeDepositAddress) {
          throw new Error(
            "Bridge did not return a deposit address for the selected chain"
          );
        }
        try {
          validateWithdrawBridgeDestination({
            toTokenAddress,
            bridgeAddress: bridgeDepositAddress,
            recipientAddress: destinationAddress,
            sourceAddress: proxyAddress,
          });
        } catch (err) {
          log.warn("bridge.deposit_address.rejected", {
            error: err,
            bridgeDepositAddress,
            proxyAddress,
            destinationAddress,
            tokenId,
            toChainId,
            toTokenAddress,
          });
          throw err;
        }

        log.info("bridge.deposit_address.received", {
          bridgeDepositAddress,
          proxyAddress,
          destinationAddress,
          tokenId,
          tokenSymbol: tokenConfig.symbol,
          toChainId,
          toTokenAddress,
        });

        const transferData = encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [bridgeDepositAddress as `0x${string}`, amountInWei],
        });

        const transactions = [
          {
            to: PUSD_ADDRESS,
            data: transferData,
            value: "0",
          },
        ];

        log.info("bridge.withdrawal.submitting", {
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

        // Start bridge tracking whether the relayer confirmed or timed out
        // (pending). The on-chain transfer may still land and the bridge
        // will eventually report completion or failure.
        if (relayerResult.success || relayerResult.pending) {
          startBridgeStatusPolling(bridgeDepositAddress);
        }

        return {
          ...relayerResult,
          bridgeDepositAddress,
        };
      } catch (err) {
        log.error("withdraw.failed", err);
        const errorMessage =
          err instanceof Error ? err.message : "Withdrawal failed";
        setState("failed");
        setError(errorMessage);
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: qk.proxyWallet.byAddress(address),
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
    setBridgeTracking({
      status: null,
      depositAddress: null,
      transactionHash: null,
    });
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
