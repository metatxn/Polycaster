"use client";

import { useCallback, useMemo, useState } from "react";
import { useConnection, useWalletClient } from "wagmi";
import { COLLATERAL_ONRAMP_ABI } from "@/constants/abi";
import {
  COLLATERAL_ONRAMP_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  PUSD_ADDRESS,
  PUSD_DECIMALS,
  USDC_E_ADDRESS,
  USDC_E_DECIMALS,
} from "@/constants/contracts";
import { SignatureType } from "@/lib/polymarket";
import { executeViaRelayer } from "@/lib/relayer-client";
import { getRpcUrl } from "@/lib/rpc";
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
  amount?: number;
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
  const { data: walletClient } = useWalletClient();
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
    // biome-ignore lint/suspicious/noExplicitAny: window.ethereum is the wallet provider
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
      import("@polymarket/clob-client-v2"),
      getEthersSigner(),
    ]);

    const creds = {
      key: credentials.apiKey,
      secret: credentials.apiSecret,
      passphrase: credentials.apiPassphrase,
    };

    const builderCode = process.env.NEXT_PUBLIC_POLY_BUILDER_CODE;

    return new ClobClient({
      host: CLOB_HOST,
      chain: CHAIN_ID,
      signer,
      creds,
      signatureType: SignatureType.POLY_GNOSIS_SAFE as unknown as number,
      funderAddress: proxyAddress,
      ...(builderCode ? { builderConfig: { builderCode } } : {}),
    });
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
   * Ensure the proxy wallet has enough pUSD to cover a BUY order.
   *
   * Polymarket CLOB V2 settles BUY orders in pUSD (wrapped USDC.e). Most
   * users only hold USDC.e, so before posting a BUY we check the pUSD
   * balance and, if short, dispatch a gasless relayer batch that:
   *   1. approves USDC.e → CollateralOnramp (the shortfall)
   *   2. calls CollateralOnramp.wrap(USDC.e, proxy, shortfall)
   *
   * The Onramp converts USDC.e → pUSD 1:1 and credits the proxy, so when
   * the order is matched the CTF Exchange V2 can pull the pUSD directly.
   *
   * SELL orders receive pUSD and never need this, so callers should only
   * invoke this for BUY paths.
   *
   * @param requiredPusdRaw - Required pUSD amount in base units (6 decimals).
   */
  const ensurePusdSufficient = useCallback(
    async (requiredPusdRaw: bigint) => {
      if (!proxyAddress) throw new Error("Proxy wallet not found");
      if (requiredPusdRaw <= BigInt(0)) return;

      const { createPublicClient, http, encodeFunctionData, formatUnits } =
        await import("viem");
      const { polygon } = await import("viem/chains");

      const ERC20_READ_APPROVE_ABI = [
        {
          inputs: [{ name: "owner", type: "address" }],
          name: "balanceOf",
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
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

      const publicClient = createPublicClient({
        chain: polygon,
        transport: http(getRpcUrl()),
      });

      const pusdBalance = (await publicClient.readContract({
        address: PUSD_ADDRESS,
        abi: ERC20_READ_APPROVE_ABI,
        functionName: "balanceOf",
        args: [proxyAddress as `0x${string}`],
      })) as bigint;

      if (pusdBalance >= requiredPusdRaw) return;

      const shortfall = requiredPusdRaw - pusdBalance;

      const usdcBalance = (await publicClient.readContract({
        address: USDC_E_ADDRESS,
        abi: ERC20_READ_APPROVE_ABI,
        functionName: "balanceOf",
        args: [proxyAddress as `0x${string}`],
      })) as bigint;

      if (usdcBalance < shortfall) {
        const needed = formatUnits(shortfall, PUSD_DECIMALS);
        const haveUsdc = formatUnits(usdcBalance, USDC_E_DECIMALS);
        const havePusd = formatUnits(pusdBalance, PUSD_DECIMALS);
        throw new Error(
          `Insufficient collateral: need $${needed} more to place this order. ` +
            `Proxy holds $${havePusd} pUSD and $${haveUsdc} USDC.e — ` +
            "please deposit more USDC.e."
        );
      }

      const approveData = encodeFunctionData({
        abi: ERC20_READ_APPROVE_ABI,
        functionName: "approve",
        args: [COLLATERAL_ONRAMP_ADDRESS, shortfall],
      });
      const wrapData = encodeFunctionData({
        abi: COLLATERAL_ONRAMP_ABI,
        functionName: "wrap",
        args: [USDC_E_ADDRESS, proxyAddress as `0x${string}`, shortfall],
      });

      if (!walletClient) throw new Error("Wallet not connected");
      if (!address) throw new Error("Wallet not connected");

      await executeViaRelayer(walletClient, address as `0x${string}`, [
        {
          to: USDC_E_ADDRESS as `0x${string}`,
          data: approveData,
          value: "0",
        },
        {
          to: COLLATERAL_ONRAMP_ADDRESS as `0x${string}`,
          data: wrapData,
          value: "0",
        },
      ]);
    },
    [proxyAddress, walletClient, address]
  );

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
        const orderOptions = params.negRisk ? { negRisk: true } : undefined;

        const isMarket =
          params.orderType === OrderType.FAK ||
          params.orderType === OrderType.FOK;

        // Wrap-on-trade pre-flight (BUY only). SELL receives pUSD and does
        // not need collateral wrapped beforehand.
        if (params.side === Side.BUY) {
          const { parseUnits } = await import("viem");
          let requiredPusdRaw: bigint;
          if (isMarket) {
            const notional = params.amount;
            if (notional == null) {
              throw new Error(
                "BUY market orders require a notional amount (params.amount)"
              );
            }
            requiredPusdRaw = parseUnits(notional.toString(), PUSD_DECIMALS);
          } else {
            // Limit BUY: price (dollars) * size (shares) = notional dollars.
            const notional = params.price * params.size;
            requiredPusdRaw = parseUnits(notional.toString(), PUSD_DECIMALS);
          }
          await ensurePusdSufficient(requiredPusdRaw);
        }

        if (isMarket) {
          const buyAmount = params.amount;

          if (params.side !== Side.SELL && buyAmount == null) {
            throw new Error(
              "BUY market orders require a notional amount (params.amount)"
            );
          }

          // BUY market orders use notional USDC amount; SELL market orders use shares.
          const marketAmount =
            params.side === Side.SELL ? params.size : buyAmount;

          if (marketAmount == null) {
            throw new Error("Failed to determine market order amount");
          }

          const order = await client.createMarketOrder(
            {
              tokenID: params.tokenId,
              amount: marketAmount,
              side: params.side,
              // feeRateBps removed (V2: protocol-determined at match time)
              ...(params.price > 0 ? { price: params.price } : {}),
            },
            orderOptions
          );

          const response = await client.postOrder(order, params.orderType);
          return { success: true, order: response };
        }

        const order = await client.createOrder(
          {
            tokenID: params.tokenId,
            price: params.price,
            size: params.size,
            side: params.side,
            // feeRateBps removed (V2: protocol-determined at match time)
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
    [address, canTrade, getClient, ensurePusdSufficient]
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
   * Update (set) the CLOB V2 allowance set for the connected EOA.
   *
   * V2 moves collateral through pUSD, so the manual approve flow must:
   *   - Approve USDC.e → CollateralOnramp (so the Onramp can pull USDC.e
   *     when wrapping to pUSD)
   *   - Approve pUSD → standard CTF Exchange V2
   *   - Approve pUSD → Neg Risk CTF Exchange V2
   *
   * Note: The gasless onboarding path in `use-relayer-client.ts` already
   * sets approvals on the user's Safe. This callback is the fallback for
   * manual EOA approvals.
   */
  const updateAllowance = useCallback(async () => {
    if (!address) throw new Error("Wallet not connected");

    setIsLoading(true);
    setError(null);

    try {
      const [{ createWalletClient, custom, maxUint256 }, { polygon }] =
        await Promise.all([import("viem"), import("viem/chains")]);

      const ERC20_APPROVE_ABI = [
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
        // biome-ignore lint/suspicious/noExplicitAny: window.ethereum is the wallet provider
        transport: custom(window.ethereum as any),
        account: address,
      });

      const { createPublicClient, http } = await import("viem");
      const publicClient = createPublicClient({
        chain: polygon,
        transport: http(getRpcUrl()),
      });

      await walletClient.requestAddresses();

      const approve = async (token: `0x${string}`, spender: `0x${string}`) => {
        const hash = await walletClient.writeContract({
          account: address,
          address: token,
          abi: ERC20_APPROVE_ABI,
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
        approve(USDC_E_ADDRESS, COLLATERAL_ONRAMP_ADDRESS),
        approve(PUSD_ADDRESS, CTF_EXCHANGE_ADDRESS),
        approve(PUSD_ADDRESS, NEG_RISK_CTF_EXCHANGE_ADDRESS),
      ]);

      return {
        success: true,
        hashes,
        message:
          "Approved USDC.e → Onramp and pUSD → CTF Exchange V2 + Neg Risk Exchange V2",
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to approve");
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
   * Get pUSD balance for the given address (defaults to the proxy wallet).
   *
   * pUSD is what CLOB V2 actually settles against — BUY orders debit it,
   * SELL orders credit it. Use this together with `getUsdcBalance` to
   * determine whether a wrap (USDC.e → pUSD) is needed before posting.
   */
  const getPusdBalance = useCallback(
    async (walletAddress?: string) => {
      const targetAddress = walletAddress || proxyAddress;
      if (!targetAddress) throw new Error("No wallet address");

      const { createPublicClient, http, formatUnits } = await import("viem");
      const { polygon } = await import("viem/chains");

      const ERC20_BALANCE_ABI = [
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
        address: PUSD_ADDRESS,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [targetAddress as `0x${string}`],
      });

      return {
        balance: Number(formatUnits(balance, PUSD_DECIMALS)),
        balanceRaw: balance.toString(),
        decimals: PUSD_DECIMALS,
      };
    },
    [proxyAddress]
  );

  /**
   * Get the fee rate in basis points for a specific token
   */
  const getFeeRateBps = useCallback(
    async (tokenId: string): Promise<number> => {
      try {
        const { ClobClient } = await import("@polymarket/clob-client-v2");
        const client = new ClobClient({ host: CLOB_HOST, chain: CHAIN_ID });
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
    getPusdBalance,
    getUsdcAllowance,
    getFeeRateBps,
    isOrderScoring,
    areOrdersScoring,
  };
}
