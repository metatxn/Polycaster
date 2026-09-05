"use client";

import { createLogger } from "@knoww/logger";
import {
  buildClobOrderApprovalTransactions,
  buildFullTradingApprovalTransactions,
  type ClobOrderApprovalRequirement,
  isClobOrderApproved,
  readClobOrderPusdAllowance,
  readTradingApprovalStatus,
} from "@knoww/shared-types/approvals";
import {
  type ClobBuilderFeeRates,
  fetchClobBuilderFeeRates,
} from "@knoww/shared-types/clob";
import {
  assertClobPostOrderSuccess,
  CLOB_ASSET_TYPES,
  CLOB_ORDER_TYPES,
  type ClobBalanceAllowanceClient,
  type ClobBalanceAllowanceTarget,
  type ClobOrderType,
  getClobPostOrderError,
  syncClobBalanceAllowance,
  TRADING_SIDES,
  type TradingSide,
} from "@knoww/shared-types/polymarket";
import {
  adaptUnifiedSecureClientForLegacyClob,
  createUnifiedPolymarketCredentialsOnlySigner,
  createUnifiedPolymarketSecureClient,
  createUnifiedPolymarketViemSigner,
  isPolymarketFreshAuthenticationRequiredError,
  type LegacyClobCompatibleClient,
  type UnifiedSdkTradingClient,
} from "@knoww/shared-types/polymarket-unified";
import { assertOrderCancelled } from "@knoww/shared-types/product-analytics";
import {
  buildClobOrderPreflightPlan,
  buildPusdAutoWrapTransactions,
  estimateBuyTakerFeeRaw,
  formatConditionalShares,
  parseApprovalAmountRaw,
  planPusdAutoWrap,
} from "@knoww/shared-types/trading";
import { isWalletRejectionError } from "@knoww/shared-types/trading-errors";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { useConnection, useWalletClient } from "wagmi";
import {
  captureTradingEvent,
  pollConfirmedOrders,
  rememberAcceptedOrder,
} from "@/lib/order-analytics";

const log = createLogger("clob-client");

import {
  PUSD_ADDRESS,
  PUSD_DECIMALS,
  USDC_E_ADDRESS,
  USDC_E_DECIMALS,
} from "@/constants/contracts";
import { CLOB_BASE_URL } from "@/constants/polymarket";
import { checkAllApprovals } from "@/lib/approvals";
import {
  executeViaDepositWallet,
  executeViaRelayer,
} from "@/lib/relayer-client";
import { getRpcUrl } from "@/lib/rpc";
import {
  getViemWalletClient,
  hasViemWalletProvider,
} from "@/lib/viem-wallet-client";
import {
  readConditionalBalanceRaw,
  readPusdAllowance,
  readPusdBalance,
  readUsdcBalance,
} from "./clob/balances";
import {
  checkOrderScoring,
  checkOrdersScoring,
  fetchOpenOrders,
  fetchOrderBook,
} from "./clob/market-data";
import {
  CLOB_BALANCE_SYNC_DELAYS_MS,
  type ClobOperationStep,
  DEFAULT_TRADING_APPROVAL_RAW,
  isBalanceAllowanceError,
  parseRawUnits,
  wait,
} from "./clob/shared";
import { useClobCredentials } from "./use-clob-credentials";
import { useProxyWallet } from "./use-proxy-wallet";
import { useRelayerClient } from "./use-relayer-client";

export const Side = TRADING_SIDES;
export type Side = TradingSide;

/**
 * Order type enum
 * @see https://docs.polymarket.com/developers/CLOB/orders/create-order
 */
export const OrderType = CLOB_ORDER_TYPES;
export type OrderType = ClobOrderType;

/**
 * Order parameters for creating a new order
 */
export interface CreateOrderParams {
  tokenId: string;
  conditionId?: string;
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

// Builder rates are set by Polymarket per builder code and effectively static,
// so one fetch per page load is enough. Mirrors the extension's cache in
// `background/trading-handler.ts` so both surfaces price a trade identically.
const builderFeeRatesCache = new Map<string, Promise<ClobBuilderFeeRates>>();

function getBuilderFeeRates(builderCode: string): Promise<ClobBuilderFeeRates> {
  const cached = builderFeeRatesCache.get(builderCode);
  if (cached) return cached;

  const pending = fetchClobBuilderFeeRates(builderCode, {
    host: CLOB_HOST,
  }).catch((err) => {
    // Don't poison the cache on a transient failure — let the next call retry.
    builderFeeRatesCache.delete(builderCode);
    throw err;
  });
  builderFeeRatesCache.set(builderCode, pending);
  return pending;
}

// `getBalanceAllowance` is not optional: the unified-SDK shim always attaches
// it (falling back to the standalone `@polymarket/client/actions` function when
// the client carries no method), so the SELL pre-flight below can rely on it.
type ClobBalanceAllowanceReadableClient = ClobBalanceAllowanceClient & {
  getBalanceAllowance: (
    args: ClobBalanceAllowanceTarget
  ) => Promise<{ balance?: string | number | bigint }>;
};

type ReadOnlyClientCache = {
  key: string;
  promise: Promise<LegacyClobCompatibleClient>;
};

function buildReadOnlyClientCacheKey(
  signerAddress: string,
  walletAddress: string,
  apiKey: string
): string {
  return `${signerAddress.toLowerCase()}:${walletAddress.toLowerCase()}:${apiKey}`;
}

/**
 * Hook for interacting with Polymarket CLOB using the official SDK
 */
export function useClobClient() {
  const { address, isConnected } = useConnection();
  const { data: walletClient } = useWalletClient();
  const { credentials, hasCredentials, deriveCredentials, clearCredentials } =
    useClobCredentials();
  const {
    proxyAddress,
    isDeployed: hasProxyWallet,
    isEoaMode,
    walletMode,
  } = useProxyWallet();
  const { approveUsdcForTrading } = useRelayerClient();

  const [isLoading, setIsLoading] = useState(false);
  const [operationStep, setOperationStep] = useState<ClobOperationStep>("idle");
  const [error, setError] = useState<Error | null>(null);
  const readOnlyClientCacheRef = useRef<ReadOnlyClientCache | null>(null);

  /**
   * Internal helper to initialize the ClobClient
   */
  const getClient = useCallback(async () => {
    if (!credentials) throw new Error("API credentials not available");
    if (!proxyAddress) throw new Error("Trading wallet not found");
    if (isEoaMode && !address) throw new Error("Wallet not connected");

    const signer = await getViemWalletClient(
      walletClient,
      address as `0x${string}` | undefined
    );

    const builderCode = process.env.NEXT_PUBLIC_POLY_BUILDER_CODE;

    const { client } = await createUnifiedPolymarketSecureClient({
      signer: createUnifiedPolymarketViemSigner(signer),
      wallet: isEoaMode ? address : proxyAddress,
      credentials,
    });

    return adaptUnifiedSecureClientForLegacyClob(
      client as unknown as UnifiedSdkTradingClient,
      { builderCode }
    );
  }, [credentials, proxyAddress, isEoaMode, address, walletClient]);

  /**
   * Internal helper for passive CLOB reads. It reuses existing credentials only
   * and must never ask the wallet to sign fresh auth during polling.
   */
  const getReadOnlyClient = useCallback(async () => {
    if (!credentials) throw new Error("API credentials not available");
    if (!proxyAddress) throw new Error("Trading wallet not found");
    if (!address) throw new Error("Wallet not connected");

    const builderCode = process.env.NEXT_PUBLIC_POLY_BUILDER_CODE;
    const walletAddress = isEoaMode ? address : proxyAddress;
    const cacheKey = buildReadOnlyClientCacheKey(
      address,
      walletAddress,
      credentials.apiKey
    );

    if (readOnlyClientCacheRef.current?.key === cacheKey) {
      return readOnlyClientCacheRef.current.promise;
    }

    let promise: Promise<LegacyClobCompatibleClient>;
    promise = createUnifiedPolymarketSecureClient({
      signer: createUnifiedPolymarketCredentialsOnlySigner(address),
      wallet: walletAddress,
      credentials,
      allowFreshAuthentication: false,
    })
      .then(({ client }) =>
        adaptUnifiedSecureClientForLegacyClob(
          client as unknown as UnifiedSdkTradingClient,
          { builderCode }
        )
      )
      .catch((err) => {
        if (readOnlyClientCacheRef.current?.promise === promise) {
          readOnlyClientCacheRef.current = null;
        }
        throw err;
      });

    readOnlyClientCacheRef.current = { key: cacheKey, promise };
    return promise;
  }, [credentials, proxyAddress, isEoaMode, address]);

  /**
   * Check if the client can be used. All signing should route through the active
   * wagmi wallet client so WalletConnect sessions keep signing on mobile.
   */
  const canTrade = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      isConnected &&
      hasCredentials &&
      hasProxyWallet &&
      !!proxyAddress &&
      hasViemWalletProvider(walletClient)
    );
  }, [isConnected, hasCredentials, hasProxyWallet, proxyAddress, walletClient]);

  useEffect(() => {
    if (!canTrade || !address) return;
    const poll = () => {
      void getReadOnlyClient()
        .then((client) => pollConfirmedOrders(address, client))
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 30_000);
    return () => clearInterval(timer);
  }, [canTrade, address, getReadOnlyClient]);

  /**
   * Estimate the taker fee a BUY would incur, in pUSD base units.
   *
   * This is the same computation `buildClobOrderPreflightPlan` runs at submit
   * time, exposed so the ticket can show the number *before* the user commits.
   * Returns `null` when the market's fee details cannot be read — callers
   * should fall back to `estimateFallbackFeeRaw` rather than showing "$0.00",
   * because a missing fee is not a zero fee.
   */
  const estimateBuyFee = useCallback(
    async (params: {
      conditionId?: string;
      size: number;
      price: number;
      notional: number;
      isMarketableBuy?: boolean;
    }): Promise<bigint | null> => {
      if (!params.conditionId) return null;
      const client = await getReadOnlyClient();
      return estimateBuyTakerFeeRaw(
        client,
        params.conditionId,
        params.size,
        params.price,
        params.notional,
        {
          // The SDK's parsed market info drops the `tbf` builder bps, so the
          // builder half has to come from `/fees/builder-fees/{code}` — same
          // source the extension pre-flight and the CLOB itself use.
          builderCode: process.env.NEXT_PUBLIC_POLY_BUILDER_CODE,
          getBuilderFeeRates,
          isMarketableBuy: params.isMarketableBuy,
          onError: (err) =>
            log.warn("fee_info.fetch_failed", {
              conditionId: params.conditionId,
              error: err instanceof Error ? err.message : String(err),
            }),
        }
      );
    },
    [getReadOnlyClient]
  );

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
    async (
      requiredPusdRaw: bigint,
      reservedPusdRaw: bigint = BigInt(0),
      estimatedFeeRaw: bigint | null = null
    ) => {
      if (!proxyAddress) throw new Error("Proxy wallet not found");
      if (requiredPusdRaw <= BigInt(0)) return;

      const { createPublicClient, erc20Abi, formatUnits, http } = await import(
        "viem"
      );
      const { polygon } = await import("@/lib/chains");

      const publicClient = createPublicClient({
        chain: polygon,
        transport: http(getRpcUrl()),
      });

      const pusdBalanceOnChain = (await publicClient.readContract({
        address: PUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [proxyAddress as `0x${string}`],
      })) as bigint;

      const usdcBalance = (await publicClient.readContract({
        address: USDC_E_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [proxyAddress as `0x${string}`],
      })) as bigint;

      const wrapPlan = planPusdAutoWrap({
        pusdBalanceRaw: pusdBalanceOnChain,
        usdcEBalanceRaw: usdcBalance,
        requiredPusdRaw,
        reservedPusdRaw,
        estimatedFeeRaw,
      });

      // Decision inputs/outputs only, raw units (the logger stringifies
      // bigints); formatted duplicates are derivable and this runs on every
      // BUY preflight.
      log.debug("buy_collateral.preflight", {
        proxyAddress,
        walletMode,
        pusdBalanceRaw: pusdBalanceOnChain,
        usdcEBalanceRaw: usdcBalance,
        requiredPusdRaw,
        reservedPusdRaw,
        estimatedFeeRaw,
        shortfallRaw: wrapPlan.shortfallRaw,
        wrapAmountRaw: wrapPlan.wrapAmountRaw,
        needsWrap: wrapPlan.needsWrap,
        hasEnoughBaseCollateral: wrapPlan.hasEnoughBaseCollateral,
      });

      if (!wrapPlan.hasEnoughBaseCollateral) {
        const needed = formatUnits(wrapPlan.baseShortfallRaw, PUSD_DECIMALS);
        const haveUsdc = formatUnits(usdcBalance, USDC_E_DECIMALS);
        const haveAvailable = formatUnits(
          wrapPlan.availablePusdRaw,
          PUSD_DECIMALS
        );
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

      if (!wrapPlan.needsWrap) return;

      const txns = buildPusdAutoWrapTransactions(
        proxyAddress as `0x${string}`,
        wrapPlan.wrapAmountRaw
      );

      if (!walletClient) throw new Error("Wallet not connected");
      if (!address) throw new Error("Wallet not connected");

      if (isEoaMode) {
        const { polygon } = await import("@/lib/chains");
        const { getPublicClient } = await import("@/lib/rpc");
        const publicClient = getPublicClient();

        for (const tx of txns) {
          const hash = await walletClient.sendTransaction({
            account: address as `0x${string}`,
            chain: polygon,
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
          });
          await publicClient.waitForTransactionReceipt({ hash });
        }
        return;
      }

      if (walletMode === "deposit") {
        await executeViaDepositWallet(
          walletClient,
          address as `0x${string}`,
          txns,
          proxyAddress as `0x${string}`
        );
        return;
      }

      await executeViaRelayer(walletClient, address as `0x${string}`, txns);
    },
    [proxyAddress, walletClient, address, isEoaMode, walletMode]
  );

  /**
   * Ensure the default app trading approvals are set on the Safe. If any are
   * missing, submit the approval batch via the relayer before the order call.
   *
   * This makes the trade flow self-healing: a user who skipped onboarding
   * or was onboarded pre-V2 can place an order and the app will submit the
   * one-time approval batch transparently rather than failing with a
   * cryptic "not enough balance / allowance" from the server.
   */
  const ensureV2Approvals = useCallback(
    async (
      required?: { requiredPusdRaw: bigint; negRisk?: boolean },
      onApprovalStart?: () => void
    ) => {
      if (!proxyAddress) throw new Error("Proxy wallet not found");
      const status = await checkAllApprovals(proxyAddress);
      const markApproving = () => {
        onApprovalStart?.();
        setOperationStep("approving");
      };

      let hasRequiredPusdAllowance = true;
      if (required) {
        const [{ createPublicClient, formatUnits, http }, { polygon }] =
          await Promise.all([import("viem"), import("@/lib/chains")]);
        const client = createPublicClient({
          chain: polygon,
          transport: http(getRpcUrl()),
        });
        const orderAllowance = await readClobOrderPusdAllowance(
          client,
          proxyAddress as Address,
          required.negRisk
        );
        hasRequiredPusdAllowance = orderAllowance >= required.requiredPusdRaw;

        const orderApproved = isClobOrderApproved(status, {
          side: "BUY",
          negRisk: required.negRisk,
        });

        if (!(orderApproved && hasRequiredPusdAllowance)) {
          markApproving();
          const approvalAmountRaw =
            required.requiredPusdRaw > DEFAULT_TRADING_APPROVAL_RAW
              ? required.requiredPusdRaw
              : DEFAULT_TRADING_APPROVAL_RAW;
          const result = await approveUsdcForTrading(
            formatUnits(approvalAmountRaw, PUSD_DECIMALS)
          );
          if (!result.success) {
            throw new Error(
              result.error ||
                "Failed to update trading approvals for this order."
            );
          }
          return;
        }
      }

      if (status.allApproved) return;

      markApproving();
      const result = await approveUsdcForTrading();
      if (!result.success) {
        throw new Error(
          result.error ||
            "Failed to grant trading approvals. Please open trading setup and try again."
        );
      }
    },
    [proxyAddress, approveUsdcForTrading]
  );

  /**
   * SELL orders require ERC-1155 operator approval from the CTF contract to
   * every operator that moves outcome tokens for the fill — the exchange,
   * plus the NegRiskAdapter for neg-risk markets. Gate on the shared
   * `isClobOrderApproved` model (the single owner of that operator-pair rule)
   * rather than a single-operator read, so a wallet with the exchange
   * approved but the adapter missing is repaired before CLOB returns its
   * generic "not enough balance / allowance" rejection.
   */
  const ensureSellCtfApproval = useCallback(
    async (negRisk?: boolean, onApprovalStart?: () => void) => {
      if (!proxyAddress) throw new Error("Proxy wallet not found");

      const approvalScope: ClobOrderApprovalRequirement = {
        side: "SELL",
        negRisk,
      };
      const status = await checkAllApprovals(proxyAddress);
      if (isClobOrderApproved(status, approvalScope)) return;

      onApprovalStart?.();
      setOperationStep("approving");
      const result = await approveUsdcForTrading(undefined, { approvalScope });
      if (!result.success) {
        throw new Error(
          result.error ||
            "Failed to approve outcome-token trading for this sell order."
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

      const analytics = {
        surface: "trading_service",
        attempt_id: crypto.randomUUID(),
        side: params.side,
        order_type:
          params.orderType === "GTC" || params.orderType === "GTD"
            ? "LIMIT"
            : "MARKET",
        clob_order_type: params.orderType,
        token_id: params.tokenId,
        condition_id: params.conditionId,
        requested_shares: params.size,
        requested_amount: params.amount,
      };
      captureTradingEvent("order_attempted", address, analytics);
      setIsLoading(true);
      const activeStepRef: { current: ClobOperationStep } = {
        current: "checking",
      };
      const setActiveStep = (step: ClobOperationStep) => {
        activeStepRef.current = step;
        setOperationStep(step);
      };
      setActiveStep("checking");
      setError(null);
      let requiredConditionalRaw: bigint | null = null;
      let sellBalanceBeforePostRaw: bigint | null = null;
      let didPostOrder = false;
      let confirmedRejection = false;

      try {
        const client = await getClient();
        const orderOptions = params.negRisk ? { negRisk: true } : undefined;
        const balanceAllowanceClient =
          client as unknown as ClobBalanceAllowanceReadableClient;

        const syncBalanceAllowance = async (options?: {
          requireSellBalance?: boolean;
        }) => {
          // Now that the shim routes this through the SDK actions it is a real
          // network call, so a single failure is not proof the shares are
          // missing — keep walking the ladder and only surface the error if
          // every attempt failed.
          let lastSyncError: unknown;

          for (const delayMs of CLOB_BALANCE_SYNC_DELAYS_MS) {
            if (delayMs > 0) await wait(delayMs);

            try {
              await syncClobBalanceAllowance(balanceAllowanceClient, {
                tokenId: params.tokenId,
                includeCollateral: !options?.requireSellBalance,
              });

              if (
                !options?.requireSellBalance ||
                requiredConditionalRaw === null
              ) {
                return;
              }

              const balanceAllowance =
                await balanceAllowanceClient.getBalanceAllowance({
                  assetType: CLOB_ASSET_TYPES.CONDITIONAL,
                  tokenId: params.tokenId,
                });
              const clobBalanceRaw = parseRawUnits(balanceAllowance?.balance);

              // A clean read means any earlier failure was transient: the
              // shares really are missing, so the friendly message wins.
              lastSyncError = undefined;

              if (clobBalanceRaw >= requiredConditionalRaw) return;
            } catch (err) {
              if (options?.requireSellBalance) {
                lastSyncError = err;
                continue;
              }
              // Non-fatal for legacy paths: the server may still accept the
              // order if its cache is already fresh; postOrder surfaces any
              // real issue.
              return;
            }
          }

          if (options?.requireSellBalance && requiredConditionalRaw !== null) {
            if (lastSyncError) throw lastSyncError;
            throw new Error(
              "Polymarket has not indexed these shares for trading yet. Please try again in a few seconds."
            );
          }
        };

        const preflight = await buildClobOrderPreflightPlan({
          side: params.side,
          orderType: params.orderType,
          amount: params.amount,
          size: params.size,
          price: params.price,
          conditionId: params.conditionId,
          marketInfoClient: client,
          // Same builder-rate source as `estimateBuyFee`, so the collateral we
          // reserve at submit time matches the fee the ticket previewed.
          builderCode: process.env.NEXT_PUBLIC_POLY_BUILDER_CODE,
          getBuilderFeeRates,
          getOpenOrders: () => client.getOpenOrders(),
          onFeeError: (err) =>
            log.warn("fee_info.fetch_failed", {
              conditionId: params.conditionId,
              error: err instanceof Error ? err.message : String(err),
            }),
        });
        const isMarket = preflight.isMarketOrder;
        requiredConditionalRaw = preflight.sell?.requiredConditionalRaw ?? null;

        if (params.side === Side.SELL && requiredConditionalRaw !== null) {
          if (!proxyAddress) throw new Error("Trading wallet not found");

          const onChainBalanceRaw = await readConditionalBalanceRaw(
            params.tokenId,
            proxyAddress
          );
          sellBalanceBeforePostRaw = onChainBalanceRaw;

          if (onChainBalanceRaw < requiredConditionalRaw) {
            throw new Error(
              `Insufficient shares: this wallet holds ${formatConditionalShares(
                onChainBalanceRaw
              )}, but this sell order needs ${formatConditionalShares(
                requiredConditionalRaw
              )}. Refresh your portfolio and try again.`
            );
          }
        }

        // Approvals pre-flight: if any V2 allowance is missing, or if a finite
        // pUSD allowance is below this BUY's notional, update it before posting.
        // SELL needs CTF.setApprovalForAll → exchanges to transfer outcome
        // tokens; BUY needs sufficient pUSD → exchange allowance for settlement.
        if (params.side === Side.SELL) {
          await ensureSellCtfApproval(params.negRisk, () => {
            activeStepRef.current = "approving";
          });
        }

        if (preflight.buy) {
          await ensureV2Approvals(
            {
              requiredPusdRaw: preflight.buy.requiredCollateralRaw,
              negRisk: params.negRisk,
            },
            () => {
              activeStepRef.current = "approving";
            }
          );
        }

        // Wrap-on-trade pre-flight (BUY only). SELL receives pUSD and does
        // not need collateral wrapped beforehand.
        if (params.side === Side.BUY) {
          if (!preflight.buy) {
            throw new Error("Failed to determine required pUSD amount");
          }

          setActiveStep("preparing");
          await ensurePusdSufficient(
            preflight.buy.requiredPusdRaw,
            preflight.buy.reservedPusdRaw,
            preflight.buy.estimatedFeeRaw
          );
        }

        setActiveStep("placing");

        // Push the latest on-chain balances into the CLOB cache before
        // building/posting. SELL orders depend on the conditional-token cache;
        // wait until CLOB reports enough shares so we do not submit an order
        // that the server immediately rejects as balance 0.
        await syncBalanceAllowance({
          requireSellBalance: params.side === Side.SELL,
        });

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
              tokenId: params.tokenId,
              amount: marketAmount,
              side: params.side,
              // feeRateBps removed (V2: protocol-determined at match time)
              // FAK/FOK is signed into the order at creation time in V2; it is
              // no longer a postOrder argument.
              ...(params.orderType ? { orderType: params.orderType } : {}),
              // `params.price` is already the slippage-buffered worst price, so
              // it becomes the maxPrice/minPrice bound the SDK signs in.
              ...(params.price > 0 ? { price: params.price } : {}),
              // No `maxSpend`: the SDK's default is to sign the full `amount`
              // and charge fees on top, which is what the ticket quotes and
              // what `buildClobOrderPreflightPlan` reserves collateral for.
              // Passing `maxSpend === amount` instead shrinks the signed
              // `makerAmount` below the entered amount on every BUY, and the
              // CLOB's `min size: 1` floor is checked against that reduced
              // number — so small tickets on cheap outcomes were rejected.
            },
            orderOptions
          );

          // Resync once more after signing; keep this best-effort because the
          // strict SELL cache check already happened immediately above.
          await syncBalanceAllowance();

          didPostOrder = true;
          const response = await client.postOrder(order, params.orderType);
          confirmedRejection = !!getClobPostOrderError(response);
          assertClobPostOrderSuccess(response);
          void rememberAcceptedOrder(response, address, analytics).then(() =>
            pollConfirmedOrders(address, client)
          );
          return { success: true, order: response };
        }

        const order = await client.createOrder(
          {
            tokenId: params.tokenId,
            price: params.price,
            size: params.size,
            side: params.side,
            // feeRateBps removed (V2: protocol-determined at match time)
            expiration:
              params.orderType === OrderType.GTD ? params.expiration : 0,
          },
          orderOptions
        );

        // Resync once more after signing; keep this best-effort because the
        // strict SELL cache check already happened immediately above.
        await syncBalanceAllowance();

        didPostOrder = true;
        const response = await client.postOrder(order, params.orderType);
        confirmedRejection = !!getClobPostOrderError(response);
        assertClobPostOrderSuccess(response);
        void rememberAcceptedOrder(response, address, analytics).then(() =>
          pollConfirmedOrders(address, client)
        );
        return { success: true, order: response };
      } catch (err) {
        captureTradingEvent(
          didPostOrder && !confirmedRejection
            ? "order_submission_unknown"
            : "order_failed",
          address,
          { ...analytics, failure_stage: activeStepRef.current }
        );
        if (
          didPostOrder &&
          params.side === Side.SELL &&
          proxyAddress &&
          sellBalanceBeforePostRaw !== null &&
          requiredConditionalRaw !== null &&
          isBalanceAllowanceError(err)
        ) {
          try {
            const sellBalanceAfterPostRaw = await readConditionalBalanceRaw(
              params.tokenId,
              proxyAddress
            );

            if (sellBalanceAfterPostRaw < sellBalanceBeforePostRaw) {
              setError(null);
              log.warn("sell.post_order_error_after_fill", {
                tokenId: params.tokenId,
                before: sellBalanceBeforePostRaw.toString(),
                after: sellBalanceAfterPostRaw.toString(),
                requested: requiredConditionalRaw.toString(),
                error: err instanceof Error ? err.message : String(err),
              });
              return {
                success: true,
                order: {
                  status: "matched_with_stale_balance_error",
                  error: err instanceof Error ? err.message : String(err),
                },
              };
            }
          } catch (balanceReadError) {
            log.warn("sell.post_error_balance_check_failed", {
              tokenId: params.tokenId,
              error:
                balanceReadError instanceof Error
                  ? balanceReadError.message
                  : String(balanceReadError),
            });
          }
        }

        const error =
          isWalletRejectionError(err) && activeStepRef.current !== "approving"
            ? new Error("Wallet request was rejected. No order was placed.")
            : err instanceof Error
              ? err
              : new Error("Failed to create order");
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
        setOperationStep("idle");
      }
    },
    [
      address,
      canTrade,
      getClient,
      ensurePusdSufficient,
      ensureSellCtfApproval,
      ensureV2Approvals,
      proxyAddress,
    ]
  );

  /**
   * Get the order book for a token
   */
  const getOrderBook = useCallback(async (tokenId: string) => {
    try {
      return await fetchOrderBook(tokenId, CLOB_HOST);
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
      const client = await getReadOnlyClient();
      return fetchOpenOrders(client);
    } catch (err) {
      if (isPolymarketFreshAuthenticationRequiredError(err)) {
        readOnlyClientCacheRef.current = null;
        clearCredentials();
        log.debug("open_orders.fetch_skipped", {
          reason: "credentials_invalid",
        });
      } else {
        log.error("open_orders.fetch_failed", { error: err });
      }
      return [];
    }
  }, [canTrade, getReadOnlyClient, clearCredentials]);

  /**
   * Update (set) the default app trading allowance set for the connected EOA.
   *
   * V2 moves collateral through pUSD, so the manual approve flow must:
   *   - Approve pUSD → CTF, standard CTF Exchange V2, and Neg Risk Exchange V2
   *   - Approve USDC.e → CollateralOnramp for auto-wrap
   *   - Approve CTF outcome-token operators for standard/neg-risk sells
   *
   * Note: The gasless onboarding path in `use-relayer-client.ts` already
   * sets approvals on the user's Safe. This callback is the fallback for
   * manual EOA approvals.
   */
  const updateAllowance = useCallback(
    async (
      approvalAmount?: string,
      approvalScope?: ClobOrderApprovalRequirement
    ) => {
      if (!address) throw new Error("Wallet not connected");

      setIsLoading(true);
      setOperationStep("approving");
      setError(null);

      try {
        if (!isEoaMode) {
          const result = approvalScope
            ? await approveUsdcForTrading(approvalAmount, { approvalScope })
            : await approveUsdcForTrading(approvalAmount);
          if (!result.success) {
            throw new Error(
              result.error ||
                "Failed to grant trading approvals. Please try again."
            );
          }
          return {
            success: true,
            hashes: result.transactionHashes ?? [result.transactionHash],
            message:
              result.message ||
              "Approved app trading pUSD, USDC.e Onramp, and outcome-token operators",
          };
        }

        const [{ createPublicClient, http }, { polygon }] = await Promise.all([
          import("viem"),
          import("@/lib/chains"),
        ]);
        const approvalAmountRaw = parseApprovalAmountRaw(approvalAmount);

        const approveWalletClient = await getViemWalletClient(
          walletClient,
          address as `0x${string}`
        );

        const publicClient = createPublicClient({
          chain: polygon,
          transport: http(getRpcUrl()),
        });

        const approvalTxs = approvalScope
          ? buildClobOrderApprovalTransactions(
              await readTradingApprovalStatus(
                publicClient,
                address as Address,
                {
                  approvalAmountRaw,
                }
              ),
              approvalScope
            )
          : buildFullTradingApprovalTransactions(approvalAmountRaw);
        if (approvalTxs.length === 0) {
          return {
            success: true,
            hashes: [],
            message: "All approvals already set",
          };
        }
        const hashes: `0x${string}`[] = [];
        for (const tx of approvalTxs) {
          const hash = await approveWalletClient.sendTransaction({
            account: address as `0x${string}`,
            chain: polygon,
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
          });
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            pollingInterval: 5_000,
            timeout: 120_000,
            confirmations: 1,
          });
          if (receipt.status !== "success") {
            throw new Error(`Approval failed for ${tx.to}`);
          }
          hashes.push(hash);
        }

        return {
          success: true,
          hashes,
          message:
            "Approved app trading pUSD, USDC.e Onramp, and outcome-token operators",
        };
      } catch (err) {
        const error = isWalletRejectionError(err)
          ? new Error("Approval was rejected. No order was placed.")
          : err instanceof Error
            ? err
            : new Error("Failed to approve");
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
        setOperationStep("idle");
      }
    },
    [address, walletClient, isEoaMode, approveUsdcForTrading]
  );

  /**
   * Cancel an order
   */
  const cancelOrder = useCallback(
    async (orderId: string) => {
      if (!canTrade) throw new Error("Trading setup incomplete");

      setIsLoading(true);
      setError(null);

      if (address)
        captureTradingEvent("order_cancel_attempted", address, {
          order_id: orderId,
        });
      try {
        const client = await getClient();
        const response = await client.cancelOrder({ orderId });
        assertOrderCancelled(response, orderId);
        if (address)
          captureTradingEvent("order_cancelled", address, {
            order_id: orderId,
            $insert_id: `cancel:${address}:${orderId}`,
          });
        return { success: true, response };
      } catch (err) {
        if (address)
          captureTradingEvent("order_cancel_failed", address, {
            order_id: orderId,
          });
        const error =
          err instanceof Error ? err : new Error("Failed to cancel order");
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [canTrade, getClient, address]
  );

  /**
   * Get USDC.e balance
   */
  const getUsdcBalance = useCallback(
    async (walletAddress?: string) => {
      const targetAddress = walletAddress || address;
      if (!targetAddress) throw new Error("Wallet not connected");

      try {
        return await readUsdcBalance(targetAddress);
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

      return readPusdBalance(targetAddress);
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
        return await readPusdAllowance(targetAddress, negRisk);
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
        const client = await getReadOnlyClient();
        return checkOrderScoring(client, orderId);
      } catch (err) {
        if (isPolymarketFreshAuthenticationRequiredError(err)) {
          readOnlyClientCacheRef.current = null;
          clearCredentials();
          log.debug("order_scoring.check_skipped", {
            reason: "credentials_invalid",
          });
        } else {
          log.error("order_scoring.check_failed", { error: err });
        }
        return false;
      }
    },
    [canTrade, getReadOnlyClient, clearCredentials]
  );

  /**
   * Check if multiple orders are scoring for rewards
   */
  const areOrdersScoring = useCallback(
    async (orderIds: string[]): Promise<Record<string, boolean>> => {
      if (!canTrade || orderIds.length === 0) return {};
      try {
        const client = await getReadOnlyClient();
        return checkOrdersScoring(client, orderIds);
      } catch (err) {
        if (isPolymarketFreshAuthenticationRequiredError(err)) {
          readOnlyClientCacheRef.current = null;
          clearCredentials();
          log.debug("order_scoring.batch_check_skipped", {
            reason: "credentials_invalid",
          });
        } else {
          log.error("order_scoring.batch_check_failed", { error: err });
        }
        return {};
      }
    },
    [canTrade, getReadOnlyClient, clearCredentials]
  );

  return {
    // State
    isConnected,
    canTrade,
    hasCredentials,
    hasProxyWallet,
    proxyAddress,
    isLoading,
    operationStep,
    error,

    // Actions
    createOrder,
    cancelOrder,
    estimateBuyFee,
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
