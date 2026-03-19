"use client";

import { useCallback, useMemo, useState } from "react";
import { useConnection } from "wagmi";
import {
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  USDC_E_ADDRESS,
  USDC_E_DECIMALS,
} from "@/constants/contracts";
import { SignatureType } from "@/lib/polymarket";
import { createBuilderConfig } from "@/lib/remote-builder-config";
import { getRpcUrl } from "@/lib/rpc";
import { getBuilderSignProxyUrl } from "@/lib/sign-proxy-url";
import { useClobCredentials } from "./use-clob-credentials";
import { useProxyWallet } from "./use-proxy-wallet";

/**
 * Order side enum
 */
export enum Side {
  BUY = "BUY",
  SELL = "SELL",
}

/**
 * Order type enum
 * @see https://docs.polymarket.com/developers/CLOB/orders/create-order
 */
export enum OrderType {
  GTC = "GTC", // Good Till Cancelled - Limit order active until fulfilled or cancelled
  GTD = "GTD", // Good Till Date - Limit order active until specified date
  FOK = "FOK", // Fill Or Kill - Market order that must execute entirely or cancel
  FAK = "FAK", // Fill And Kill - Market order that fills as much as possible, cancels rest
}

/**
 * Order parameters for creating a new order
 */
export interface CreateOrderParams {
  tokenId: string;
  price: number;
  size: number;
  side: Side;
  orderType?: OrderType;
  expiration?: number; // Unix timestamp for GTD orders
  /**
   * Whether this is a Negative Risk market.
   *
   * NegRisk markets use a different exchange contract (NEG_RISK_CTF_EXCHANGE)
   * and require the `negRisk: true` option when creating orders.
   * This ensures the order signature is verified against the correct contract.
   *
   * @see https://docs.polymarket.com/developers/CLOB/neg-risk
   */
  negRisk?: boolean;
}

// Module-level config to avoid hook dependencies
const CLOB_HOST =
  process.env.NEXT_PUBLIC_POLYMARKET_HOST || "https://clob.polymarket.com";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_POLYMARKET_CHAIN_ID || "137");
/**
 * Hook for interacting with Polymarket CLOB using the official SDK
 */
export function useClobClient() {
  const { address, isConnected } = useConnection();
  const { credentials, hasCredentials, deriveCredentials } =
    useClobCredentials();
  const { proxyAddress, isDeployed: hasProxyWallet } = useProxyWallet();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Internal helper to get ethers signer from window.ethereum
   */
  const getEthersSigner = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      throw new Error("No wallet provider found. Please install MetaMask.");
    }
    const { providers } = await import("ethers");
    const provider = new providers.Web3Provider(window.ethereum as any);
    await provider.send("eth_requestAccounts", []);
    return provider.getSigner();
  }, []);

  /**
   * Internal helper to initialize the ClobClient
   */
  const getClient = useCallback(async () => {
    if (!credentials) throw new Error("API credentials not available");
    if (!proxyAddress) throw new Error("Proxy wallet not found");

    const [{ ClobClient }, signer] = await Promise.all([
      import("@polymarket/clob-client"),
      getEthersSigner(),
    ]);

    const builderConfig = createBuilderConfig({
      url: getBuilderSignProxyUrl(),
    });

    const creds = {
      key: credentials.apiKey,
      secret: credentials.apiSecret,
      passphrase: credentials.apiPassphrase,
    };

    return new ClobClient(
      CLOB_HOST,
      CHAIN_ID,
      signer,
      creds,
      SignatureType.POLY_GNOSIS_SAFE,
      proxyAddress,
      undefined,
      false,
      builderConfig
    );
  }, [credentials, proxyAddress, getEthersSigner]);

  /**
   * Check if the client can be used
   */
  const canTrade = useMemo(() => {
    return (
      isConnected &&
      hasCredentials &&
      hasProxyWallet &&
      !!proxyAddress &&
      typeof window !== "undefined" &&
      !!window.ethereum
    );
  }, [isConnected, hasCredentials, hasProxyWallet, proxyAddress]);

  /**
   * Create and post an order
   */
  const createOrder = useCallback(
    async (params: CreateOrderParams) => {
      if (!address) throw new Error("Wallet not connected");
      if (!canTrade) throw new Error("Trading setup incomplete");

      setIsLoading(true);
      setError(null);

      try {
        const client = await getClient();
        const feeRateBps = await client.getFeeRateBps(params.tokenId);
        const orderOptions = params.negRisk ? { negRisk: true } : undefined;

        const order = await client.createOrder(
          {
            tokenID: params.tokenId,
            price: params.price,
            size: params.size,
            side: params.side,
            feeRateBps,
            expiration:
              params.orderType === OrderType.GTD ? params.expiration : 0,
          },
          orderOptions
        );

        const response = await client.postOrder(order, params.orderType);
        return { success: true, order: response };
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to create order");
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [address, canTrade, getClient]
  );

  /**
   * Get the order book for a token
   */
  const getOrderBook = useCallback(async (tokenId: string) => {
    try {
      const response = await fetch(`${CLOB_HOST}/book?token_id=${tokenId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch order book: ${response.statusText}`);
      }
      return await response.json();
    } catch (err) {
      console.error("Failed to get order book:", err);
      throw err;
    }
  }, []);

  /**
   * Get open orders for the connected user
   */
  const getOpenOrders = useCallback(async () => {
    if (!canTrade) return [];

    try {
      const client = await getClient();
      const orders = await client.getOpenOrders();
      return orders || [];
    } catch (err) {
      console.error("Failed to get open orders:", err);
      return [];
    }
  }, [canTrade, getClient]);

  /**
   * Update (set) the allowance for trading
   */
  const updateAllowance = useCallback(async () => {
    if (!address) throw new Error("Wallet not connected");

    setIsLoading(true);
    setError(null);

    try {
      const [{ createWalletClient, custom, maxUint256 }, { polygon }] =
        await Promise.all([import("viem"), import("viem/chains")]);

      const ERC20_ABI = [
        {
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          name: "approve",
          outputs: [{ name: "", type: "bool" }],
          stateMutability: "nonpayable",
          type: "function",
        },
      ] as const;

      const walletClient = createWalletClient({
        chain: polygon,
        transport: custom(window.ethereum as any),
        account: address,
      });

      const { createPublicClient, http } = await import("viem");
      const publicClient = createPublicClient({
        chain: polygon,
        transport: http(getRpcUrl()),
      });

      await walletClient.requestAddresses();

      const approve = async (spender: `0x${string}`) => {
        const hash = await walletClient.writeContract({
          account: address,
          address: USDC_E_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [spender, maxUint256],
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          pollingInterval: 5_000, // Poll every 5 seconds to avoid rate limiting
          timeout: 120_000, // 2 minute timeout
          confirmations: 1, // Wait for 1 confirmation
        });
        if (receipt.status !== "success") {
          throw new Error(`Approval failed for ${spender}`);
        }
        return hash;
      };

      const hashes = await Promise.all([
        approve(CTF_EXCHANGE_ADDRESS),
        approve(NEG_RISK_CTF_EXCHANGE_ADDRESS),
      ]);

      return {
        success: true,
        hashes,
        message: "Approved both CTF Exchange and NegRisk CTF Exchange",
      };
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Failed to approve USDC");
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  /**
   * Cancel an order
   */
  const cancelOrder = useCallback(
    async (orderId: string) => {
      if (!canTrade) throw new Error("Trading setup incomplete");

      setIsLoading(true);
      setError(null);

      try {
        const client = await getClient();
        const response = await client.cancelOrder({ orderID: orderId });
        return { success: true, response };
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to cancel order");
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [canTrade, getClient]
  );

  /**
   * Get USDC.e balance
   */
  const getUsdcBalance = useCallback(
    async (walletAddress?: string) => {
      const targetAddress = walletAddress || address;
      if (!targetAddress) throw new Error("Wallet not connected");

      try {
        const { createPublicClient, http, formatUnits } = await import("viem");
        const { polygon } = await import("viem/chains");

        const ERC20_ABI = [
          {
            inputs: [{ name: "owner", type: "address" }],
            name: "balanceOf",
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
            type: "function",
          },
        ] as const;

        const client = createPublicClient({
          chain: polygon,
          transport: http(getRpcUrl()),
        });

        const balance = await client.readContract({
          address: USDC_E_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [targetAddress as `0x${string}`],
        });

        return {
          balance: Number(formatUnits(balance, USDC_E_DECIMALS)),
          balanceRaw: balance.toString(),
          decimals: USDC_E_DECIMALS,
        };
      } catch (err) {
        console.error("Failed to get USDC balance:", err);
        throw err;
      }
    },
    [address]
  );

  /**
   * Get the fee rate in basis points for a specific token
   */
  const getFeeRateBps = useCallback(
    async (tokenId: string): Promise<number> => {
      try {
        const { ClobClient } = await import("@polymarket/clob-client");
        const client = new ClobClient(CLOB_HOST, CHAIN_ID);
        return await client.getFeeRateBps(tokenId);
      } catch (err) {
        console.error("Failed to get fee rate:", err);
        throw err;
      }
    },
    []
  );

  /**
   * Get USDC.e allowance
   */
  const getUsdcAllowance = useCallback(
    async (walletAddress?: string, negRisk = false) => {
      const targetAddress = walletAddress || address;
      if (!targetAddress) throw new Error("Wallet not connected");

      try {
        const { createPublicClient, http, formatUnits } = await import("viem");
        const { polygon } = await import("viem/chains");

        const exchangeAddress = negRisk
          ? NEG_RISK_CTF_EXCHANGE_ADDRESS
          : CTF_EXCHANGE_ADDRESS;

        const ERC20_ABI = [
          {
            inputs: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
            ],
            name: "allowance",
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
            type: "function",
          },
        ] as const;

        const client = createPublicClient({
          chain: polygon,
          transport: http(getRpcUrl()),
        });

        const allowance = await client.readContract({
          address: USDC_E_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [targetAddress as `0x${string}`, exchangeAddress],
        });

        return {
          allowance: Number(formatUnits(allowance, USDC_E_DECIMALS)),
          allowanceRaw: allowance.toString(),
          decimals: USDC_E_DECIMALS,
          exchange: negRisk ? "NEG_RISK_CTF_EXCHANGE" : "CTF_EXCHANGE",
        };
      } catch (err) {
        console.error("Failed to get USDC allowance:", err);
        throw err;
      }
    },
    [address]
  );

  /**
   * Check if an order is scoring for rewards
   * @see https://docs.polymarket.com/developers/CLOB/orders/check-scoring
   */
  const isOrderScoring = useCallback(
    async (orderId: string): Promise<boolean> => {
      if (!canTrade) return false;
      try {
        const client = await getClient();
        // SDK uses snake_case: order_id
        const response = await client.isOrderScoring({ order_id: orderId });
        return !!response.scoring;
      } catch (err) {
        console.error("Failed to check order scoring:", err);
        return false;
      }
    },
    [canTrade, getClient]
  );

  /**
   * Check if multiple orders are scoring for rewards
   */
  const areOrdersScoring = useCallback(
    async (orderIds: string[]): Promise<Record<string, boolean>> => {
      if (!canTrade || orderIds.length === 0) return {};
      try {
        const client = await getClient();
        // The SDK method might return a dictionary/record of orderId -> scoring
        return await client.areOrdersScoring({ orderIds });
      } catch (err) {
        console.error("Failed to check batch order scoring:", err);
        return {};
      }
    },
    [canTrade, getClient]
  );

  return {
    // State
    isConnected,
    canTrade,
    hasCredentials,
    hasProxyWallet,
    proxyAddress,
    isLoading,
    error,

    // Actions
    createOrder,
    cancelOrder,
    getOrderBook,
    getOpenOrders,
    deriveCredentials,
    updateAllowance,
    getUsdcBalance,
    getUsdcAllowance,
    getFeeRateBps,
    isOrderScoring,
    areOrdersScoring,
  };
}
