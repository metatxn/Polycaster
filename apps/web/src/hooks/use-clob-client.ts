"use client";

import { createLogger } from "@knoww/logger";
import Decimal from "decimal.js";
import { useCallback, useMemo, useState } from "react";
import { useConnection, useWalletClient } from "wagmi";

const log = createLogger("clob-client");
const DEFAULT_APPROVAL_AMOUNT = "100";
const APPROVAL_DECIMALS = 6;

function normalizeApprovalAmount(amount?: string): string {
  const decimal = new Decimal(amount || DEFAULT_APPROVAL_AMOUNT);
  if (!decimal.isFinite() || decimal.lte(0)) {
    throw new Error("Approval amount must be greater than 0");
  }
  return decimal
    .toDecimalPlaces(APPROVAL_DECIMALS, Decimal.ROUND_DOWN)
    .toFixed();
}

import { COLLATERAL_ONRAMP_ABI } from "@/constants/abi";
import {
  COLLATERAL_ONRAMP_ADDRESS,
  CTF_ADDRESS,
  CTF_APPROVAL_OPERATORS,
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  PUSD_ADDRESS,
  PUSD_APPROVAL_TARGETS,
  PUSD_DECIMALS,
  USDC_E_ADDRESS,
  USDC_E_DECIMALS,
} from "@/constants/contracts";
import { CLOB_BASE_URL, POLYMARKET_CHAIN_ID } from "@/constants/polymarket";
import { checkAllApprovals } from "@/lib/approvals";
import { SignatureType } from "@/lib/polymarket";
import { executeViaRelayer } from "@/lib/relayer-client";
import { getRpcUrl } from "@/lib/rpc";
import { useClobCredentials } from "./use-clob-credentials";
import { useProxyWallet } from "./use-proxy-wallet";
import { useRelayerClient } from "./use-relayer-client";

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
const CLOB_HOST = CLOB_BASE_URL;
const CHAIN_ID = POLYMARKET_CHAIN_ID;

/**
 * The V2 ClobClient's `postOrder` does not throw on non-2xx responses — it
 * logs the axios error internally and returns the server's error body as
 * the resolved value (e.g. `{ error: "not enough balance / allowance", status: 400 }`).
 * Detect that shape and raise a proper error so the UI surfaces it instead
 * of silently reporting the order as submitted.
 */
function assertPostOrderSuccess(response: unknown): void {
  if (!response || typeof response !== "object") return;
  const r = response as {
    success?: boolean;
    error?: unknown;
    errorMsg?: unknown;
    status?: unknown;
  };
  const errMsg =
    typeof r.error === "string" && r.error
      ? r.error
      : typeof r.errorMsg === "string" && r.errorMsg
        ? r.errorMsg
        : null;
  if (errMsg || r.success === false) {
    throw new Error(errMsg || "Order rejected by CLOB");
  }
}

/**
 * Hook for interacting with Polymarket CLOB using the official SDK
 */
export function useClobClient() {
  const { address, isConnected } = useConnection();
  const { data: walletClient } = useWalletClient();
  const { credentials, hasCredentials, deriveCredentials } =
    useClobCredentials();
  const { proxyAddress, isDeployed: hasProxyWallet } = useProxyWallet();
  const { approveUsdcForTrading } = useRelayerClient();

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
    async (requiredPusdRaw: bigint, reservedPusdRaw: bigint = BigInt(0)) => {
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

      const pusdBalanceOnChain = (await publicClient.readContract({
        address: PUSD_ADDRESS,
        abi: ERC20_READ_APPROVE_ABI,
        functionName: "balanceOf",
        args: [proxyAddress as `0x${string}`],
      })) as bigint;

      // The CLOB server reserves pUSD against the user's existing open BUY
      // orders (price * unmatched size). A new order's required collateral
      // must fit within the *available* balance, i.e. on-chain balance minus
      // reservations — not the raw on-chain balance.
      const pusdBalance =
        pusdBalanceOnChain > reservedPusdRaw
          ? pusdBalanceOnChain - reservedPusdRaw
          : BigInt(0);

      // V2 Exchange pulls `makerAmount + fees` from the Safe. The V2 SDK
      // could shrink `amount` via `adjustBuyAmountForFees` when
      // `userUSDCBalance` is passed, but that path depends on a valid
      // `builderFeeRates` entry — which 404s in preprod and gets cached as
      // NaN, disabling the adjustment. So we wrap a small buffer above the
      // requested amount to cover fees directly on-chain.
      const FEE_BUFFER_BPS = BigInt(300); // 3% — generous cap for V2 platform + builder fees
      const BPS_DENOMINATOR = BigInt(10_000);
      const targetPusdRaw =
        (requiredPusdRaw * (BPS_DENOMINATOR + FEE_BUFFER_BPS)) /
        BPS_DENOMINATOR;

      if (pusdBalance >= targetPusdRaw) return;

      const shortfall = targetPusdRaw - pusdBalance;

      const usdcBalance = (await publicClient.readContract({
        address: USDC_E_ADDRESS,
        abi: ERC20_READ_APPROVE_ABI,
        functionName: "balanceOf",
        args: [proxyAddress as `0x${string}`],
      })) as bigint;

      // If the user doesn't have enough USDC.e to cover the buffered
      // shortfall, fall back to covering at least the base requirement and
      // let the Exchange reject if fees don't fit — at least the user isn't
      // blocked when the shortfall is satisfiable without a fee buffer.
      const baseShortfall =
        requiredPusdRaw > pusdBalance
          ? requiredPusdRaw - pusdBalance
          : BigInt(0);

      if (usdcBalance < baseShortfall) {
        const needed = formatUnits(baseShortfall, PUSD_DECIMALS);
        const haveUsdc = formatUnits(usdcBalance, USDC_E_DECIMALS);
        const haveAvailable = formatUnits(pusdBalance, PUSD_DECIMALS);
        const reservedHint =
          reservedPusdRaw > BigInt(0)
            ? ` (${formatUnits(reservedPusdRaw, PUSD_DECIMALS)} pUSD is reserved by your open orders — cancel them to free it up)`
            : "";
        throw new Error(
          `Insufficient collateral: need $${needed} more to place this order. ` +
            `Proxy has $${haveAvailable} pUSD available and $${haveUsdc} USDC.e${reservedHint} — ` +
            "please deposit more USDC.e or cancel open orders."
        );
      }

      const wrapAmount = usdcBalance < shortfall ? usdcBalance : shortfall;

      const approveData = encodeFunctionData({
        abi: ERC20_READ_APPROVE_ABI,
        functionName: "approve",
        args: [COLLATERAL_ONRAMP_ADDRESS, wrapAmount],
      });
      const wrapData = encodeFunctionData({
        abi: COLLATERAL_ONRAMP_ABI,
        functionName: "wrap",
        args: [USDC_E_ADDRESS, proxyAddress as `0x${string}`, wrapAmount],
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
   * Ensure every V2 allowance (pUSD → exchanges, USDC.e → onramp, CTF
   * setApprovalForAll → operators) is set on the Safe. If any is missing,
   * submit the full approval batch via the relayer before the order call.
   *
   * This makes the trade flow self-healing: a user who skipped onboarding
   * or was onboarded pre-V2 can place an order and the app will submit the
   * one-time approval batch transparently rather than failing with a
   * cryptic "not enough balance / allowance" from the server.
   */
  const ensureV2Approvals = useCallback(
    async (required?: { requiredPusdRaw: bigint; negRisk?: boolean }) => {
      if (!proxyAddress) throw new Error("Proxy wallet not found");
      const status = await checkAllApprovals(proxyAddress);

      let hasRequiredPusdAllowance = true;
      if (required) {
        const [
          { createPublicClient, erc20Abi, formatUnits, http },
          { polygon },
        ] = await Promise.all([import("viem"), import("viem/chains")]);
        const client = createPublicClient({
          chain: polygon,
          transport: http(getRpcUrl()),
        });
        const exchangeAddress = required.negRisk
          ? NEG_RISK_CTF_EXCHANGE_ADDRESS
          : CTF_EXCHANGE_ADDRESS;
        const allowance = await client.readContract({
          address: PUSD_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [proxyAddress as `0x${string}`, exchangeAddress],
        });
        hasRequiredPusdAllowance = allowance >= required.requiredPusdRaw;

        if (!(status.allApproved && hasRequiredPusdAllowance)) {
          const result = await approveUsdcForTrading(
            formatUnits(required.requiredPusdRaw, PUSD_DECIMALS)
          );
          if (!result.success) {
            throw new Error(
              result.error ||
                "Failed to update V2 trading approvals for this order."
            );
          }
          return;
        }
      }

      if (status.allApproved) return;

      const result = await approveUsdcForTrading();
      if (!result.success) {
        throw new Error(
          result.error ||
            "Failed to grant V2 trading approvals. Please open trading setup and try again."
        );
      }
    },
    [proxyAddress, approveUsdcForTrading]
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

        let requiredPusdRaw: bigint | null = null;
        if (params.side === Side.BUY) {
          const { parseUnits } = await import("viem");
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
            const notional = new Decimal(params.price).mul(params.size);
            requiredPusdRaw = parseUnits(notional.toString(), PUSD_DECIMALS);
          }
        }

        // Approvals pre-flight: if any V2 allowance is missing, or if a finite
        // pUSD allowance is below this BUY's notional, update it before posting.
        // SELL needs CTF.setApprovalForAll → exchanges to transfer outcome
        // tokens; BUY needs sufficient pUSD → exchange allowance for settlement.
        await ensureV2Approvals(
          requiredPusdRaw !== null
            ? { requiredPusdRaw, negRisk: params.negRisk }
            : undefined
        );

        // Wrap-on-trade pre-flight (BUY only). SELL receives pUSD and does
        // not need collateral wrapped beforehand.
        if (params.side === Side.BUY) {
          if (requiredPusdRaw === null) {
            throw new Error("Failed to determine required pUSD amount");
          }

          // The CLOB reserves pUSD against the user's existing open BUY
          // orders (price * unmatched size). Count those reservations so
          // we compare the new order against *available* pUSD, not just
          // on-chain balance.
          let reservedPusdRaw = BigInt(0);
          try {
            const openOrders = await client.getOpenOrders();
            const arr = Array.isArray(openOrders) ? openOrders : [];
            for (const raw of arr) {
              const o = raw as {
                side?: string;
                price?: string | number;
                original_size?: string | number;
                size_matched?: string | number;
              };
              if (o?.side !== "BUY") continue;
              const price = Number(o.price ?? 0);
              const remaining =
                Number(o.original_size ?? 0) - Number(o.size_matched ?? 0);
              if (
                !Number.isFinite(price) ||
                !Number.isFinite(remaining) ||
                remaining <= 0
              )
                continue;
              reservedPusdRaw += BigInt(
                Math.round(price * remaining * 1_000_000)
              );
            }
          } catch {
            // If getOpenOrders fails, proceed with 0 reserved — worst case
            // the server rejects with its own error message.
          }

          await ensurePusdSufficient(requiredPusdRaw, reservedPusdRaw);
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

          // Resync the CLOB server's cached view of this user's on-chain
          // balance/allowance before posting. Without this, the server
          // returns a generic "not enough balance / allowance" 400 even
          // when the Safe holds sufficient pUSD with unlimited allowances
          // — the server simply hasn't observed the latest on-chain state
          // for this funder. Mirrors the extension's trading-handler.ts.
          try {
            await (
              client as unknown as {
                updateBalanceAllowance: (args: {
                  asset_type: string;
                  token_id?: string;
                }) => Promise<unknown>;
              }
            ).updateBalanceAllowance({ asset_type: "COLLATERAL" });
            await (
              client as unknown as {
                updateBalanceAllowance: (args: {
                  asset_type: string;
                  token_id?: string;
                }) => Promise<unknown>;
              }
            ).updateBalanceAllowance({
              asset_type: "CONDITIONAL",
              token_id: params.tokenId,
            });
          } catch {
            // Non-fatal: the server may still accept the order if its
            // cache is already fresh; postOrder surfaces any real issue.
          }

          const response = await client.postOrder(order, params.orderType);
          assertPostOrderSuccess(response);
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

        // Resync server-side cached balance/allowance before posting (V2
        // requires this; without it the server returns a stale "not
        // enough balance / allowance" 400). Mirrors the extension.
        try {
          await (
            client as unknown as {
              updateBalanceAllowance: (args: {
                asset_type: string;
                token_id?: string;
              }) => Promise<unknown>;
            }
          ).updateBalanceAllowance({ asset_type: "COLLATERAL" });
          await (
            client as unknown as {
              updateBalanceAllowance: (args: {
                asset_type: string;
                token_id?: string;
              }) => Promise<unknown>;
            }
          ).updateBalanceAllowance({
            asset_type: "CONDITIONAL",
            token_id: params.tokenId,
          });
        } catch {
          // Non-fatal: the server may still accept the order if its cache
          // is already fresh; postOrder surfaces any real issue.
        }

        const response = await client.postOrder(order, params.orderType);
        assertPostOrderSuccess(response);
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
    [address, canTrade, getClient, ensurePusdSufficient, ensureV2Approvals]
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
      log.error("order_book.fetch_failed", { error: err });
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
      log.error("open_orders.fetch_failed", { error: err });
      return [];
    }
  }, [canTrade, getClient]);

  /**
   * Update (set) the CLOB V2 allowance set for the connected EOA.
   *
   * V2 moves collateral through pUSD, so the manual approve flow must:
   *   - Approve USDC.e → CollateralOnramp (so the Onramp can pull USDC.e
   *     when wrapping to pUSD)
   *   - Approve pUSD → CTF, standard CTF Exchange V2, Neg Risk Exchange V2,
   *     and Neg Risk Adapter
   *   - Approve CTF outcome-token operators for sells/conversions
   *
   * Note: The gasless onboarding path in `use-relayer-client.ts` already
   * sets approvals on the user's Safe. This callback is the fallback for
   * manual EOA approvals.
   */
  const updateAllowance = useCallback(
    async (approvalAmount?: string) => {
      if (!address) throw new Error("Wallet not connected");

      setIsLoading(true);
      setError(null);

      try {
        const [{ createWalletClient, custom, parseUnits }, { polygon }] =
          await Promise.all([import("viem"), import("viem/chains")]);
        const approvalAmountRaw = parseUnits(
          normalizeApprovalAmount(approvalAmount),
          APPROVAL_DECIMALS
        );

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
        const ERC1155_APPROVAL_ABI = [
          {
            inputs: [
              { name: "operator", type: "address" },
              { name: "approved", type: "bool" },
            ],
            name: "setApprovalForAll",
            outputs: [],
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

        const approve = async (
          token: `0x${string}`,
          spender: `0x${string}`
        ) => {
          const hash = await walletClient.writeContract({
            account: address,
            address: token,
            abi: ERC20_APPROVE_ABI,
            functionName: "approve",
            args: [spender, approvalAmountRaw],
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
        const approveOperator = async (operator: `0x${string}`) => {
          const hash = await walletClient.writeContract({
            account: address,
            address: CTF_ADDRESS,
            abi: ERC1155_APPROVAL_ABI,
            functionName: "setApprovalForAll",
            args: [operator, true],
          });
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            pollingInterval: 5_000,
            timeout: 120_000,
            confirmations: 1,
          });
          if (receipt.status !== "success") {
            throw new Error(`Operator approval failed for ${operator}`);
          }
          return hash;
        };

        const hashes = await Promise.all([
          approve(USDC_E_ADDRESS, COLLATERAL_ONRAMP_ADDRESS),
          ...PUSD_APPROVAL_TARGETS.map((spender) =>
            approve(PUSD_ADDRESS, spender)
          ),
          ...CTF_APPROVAL_OPERATORS.map((operator) =>
            approveOperator(operator)
          ),
        ]);

        return {
          success: true,
          hashes,
          message:
            "Approved V2 pUSD, USDC.e Onramp, and outcome-token operators",
        };
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to approve");
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [address]
  );

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
        log.error("usdc_balance.fetch_failed", { error: err });
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
   * Get pUSD exchange allowance
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
          address: PUSD_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [targetAddress as `0x${string}`, exchangeAddress],
        });

        return {
          allowance: Number(formatUnits(allowance, PUSD_DECIMALS)),
          allowanceRaw: allowance.toString(),
          decimals: PUSD_DECIMALS,
          exchange: negRisk ? "NEG_RISK_CTF_EXCHANGE" : "CTF_EXCHANGE",
        };
      } catch (err) {
        log.error("pusd_allowance.fetch_failed", { error: err });
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
        log.error("order_scoring.check_failed", { error: err });
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
        log.error("order_scoring.batch_check_failed", { error: err });
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
    isOrderScoring,
    areOrdersScoring,
  };
}
