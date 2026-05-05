"use client";

import { createLogger } from "@knoww/logger";
import {
  buildFullTradingApprovalTransactions,
  getPusdExchangeApprovalSpender,
  readErc1155Approval,
  readPusdExchangeAllowance,
} from "@knoww/shared-types/approvals";
import { fetchClobOrderBook } from "@knoww/shared-types/clob";
import { CTF_JSON_ABI } from "@knoww/shared-types/ctf";
import {
  assertClobPostOrderSuccess,
  CLOB_ASSET_TYPES,
  CLOB_ORDER_TYPES,
  type ClobBalanceAllowanceClient,
  type ClobBalanceAllowanceTarget,
  type ClobOrderType,
  getPolymarketSignatureType,
  syncClobBalanceAllowance,
  TRADING_SIDES,
  type TradingSide,
} from "@knoww/shared-types/polymarket";
import {
  buildClobOrderPreflightPlan,
  buildPusdAutoWrapTransactions,
  DEFAULT_APPROVAL_AMOUNT,
  formatConditionalShares,
  parseApprovalAmountRaw,
  planPusdAutoWrap,
} from "@knoww/shared-types/trading";
import { isWalletRejectionError } from "@knoww/shared-types/trading-errors";
import type {
  OrderType as SdkOrderType,
  Side as SdkSide,
} from "@polymarket/clob-client-v2";
import { useCallback, useMemo, useState } from "react";
import type { Address } from "viem";
import { useConnection, useWalletClient } from "wagmi";

const log = createLogger("clob-client");

import {
  CTF_ADDRESS,
  PUSD_ADDRESS,
  PUSD_DECIMALS,
  USDC_E_ADDRESS,
  USDC_E_DECIMALS,
} from "@/constants/contracts";
import { CLOB_BASE_URL, POLYMARKET_CHAIN_ID } from "@/constants/polymarket";
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
const CHAIN_ID = POLYMARKET_CHAIN_ID;
const DEFAULT_TRADING_APPROVAL_RAW = parseApprovalAmountRaw(
  DEFAULT_APPROVAL_AMOUNT
);
const CLOB_BALANCE_SYNC_DELAYS_MS = [0, 250, 750, 1500, 2500] as const;

type ClobBalanceAllowanceReadableClient = ClobBalanceAllowanceClient & {
  getBalanceAllowance?: (
    args: ClobBalanceAllowanceTarget
  ) => Promise<{ balance?: string | number | bigint }>;
};

function parseRawUnits(value: string | number | bigint | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0
      ? BigInt(Math.trunc(value))
      : BigInt(0);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return BigInt(0);
}

function isBalanceAllowanceError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /not enough balance\s*\/\s*allowance|balance is not enough/i.test(
    message
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ClobOperationStep =
  | "idle"
  | "checking"
  | "approving"
  | "preparing"
  | "placing";

/**
 * Hook for interacting with Polymarket CLOB using the official SDK
 */
export function useClobClient() {
  const { address, isConnected } = useConnection();
  const { data: walletClient } = useWalletClient();
  const { credentials, hasCredentials, deriveCredentials } =
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

  /**
   * Internal helper to initialize the ClobClient
   */
  const getClient = useCallback(async () => {
    if (!credentials) throw new Error("API credentials not available");
    if (!proxyAddress) throw new Error("Trading wallet not found");
    if (isEoaMode && !address) throw new Error("Wallet not connected");

    const [{ ClobClient }, signer] = await Promise.all([
      import("@polymarket/clob-client-v2"),
      getViemWalletClient(walletClient, address as `0x${string}` | undefined),
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
      signatureType: getPolymarketSignatureType(
        walletMode
      ) as unknown as number,
      funderAddress: isEoaMode ? address : proxyAddress,
      ...(builderCode ? { builderConfig: { builderCode } } : {}),
    });
  }, [credentials, proxyAddress, isEoaMode, walletMode, address, walletClient]);

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

  const readConditionalBalanceRaw = useCallback(
    async (tokenId: string, owner: string): Promise<bigint> => {
      const { createPublicClient, http } = await import("viem");
      const { polygon } = await import("viem/chains");

      const publicClient = createPublicClient({
        chain: polygon,
        transport: http(getRpcUrl()),
      });

      const balances = (await publicClient.readContract({
        address: CTF_ADDRESS as Address,
        abi: CTF_JSON_ABI,
        functionName: "balanceOfBatch",
        args: [[owner as Address], [BigInt(tokenId)]],
      })) as readonly bigint[];

      return balances[0] ?? BigInt(0);
    },
    []
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
      const { polygon } = await import("viem/chains");

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

      if (!wrapPlan.needsWrap) return;

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

      const txns = buildPusdAutoWrapTransactions(
        proxyAddress as `0x${string}`,
        wrapPlan.wrapAmountRaw
      );

      if (!walletClient) throw new Error("Wallet not connected");
      if (!address) throw new Error("Wallet not connected");

      if (isEoaMode) {
        const { polygon } = await import("viem/chains");
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
          await Promise.all([import("viem"), import("viem/chains")]);
        const client = createPublicClient({
          chain: polygon,
          transport: http(getRpcUrl()),
        });
        const allowance = await readPusdExchangeAllowance(
          client,
          proxyAddress as Address,
          required.negRisk
        );
        hasRequiredPusdAllowance = allowance >= required.requiredPusdRaw;

        if (!(status.allApproved && hasRequiredPusdAllowance)) {
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
   * the exact exchange that will fill the order. Check that approval directly
   * so a missing SELL allowance is repaired before CLOB returns its generic
   * "not enough balance / allowance" rejection.
   */
  const ensureSellCtfApproval = useCallback(
    async (negRisk?: boolean, onApprovalStart?: () => void) => {
      if (!proxyAddress) throw new Error("Proxy wallet not found");

      const [{ createPublicClient, http }, { polygon }] = await Promise.all([
        import("viem"),
        import("viem/chains"),
      ]);
      const client = createPublicClient({
        chain: polygon,
        transport: http(getRpcUrl()),
      });
      const exchange = getPusdExchangeApprovalSpender(negRisk);
      const approved = await readErc1155Approval(
        client,
        proxyAddress as Address,
        exchange
      );

      if (approved) return;

      onApprovalStart?.();
      setOperationStep("approving");
      const result = await approveUsdcForTrading();
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

      try {
        const client = await getClient();
        const orderOptions = params.negRisk ? { negRisk: true } : undefined;
        const balanceAllowanceClient =
          client as unknown as ClobBalanceAllowanceReadableClient;

        const syncBalanceAllowance = async (options?: {
          requireSellBalance?: boolean;
        }) => {
          for (const delayMs of CLOB_BALANCE_SYNC_DELAYS_MS) {
            if (delayMs > 0) await wait(delayMs);

            try {
              await syncClobBalanceAllowance(balanceAllowanceClient, {
                tokenId: params.tokenId,
                includeCollateral: !options?.requireSellBalance,
              });

              if (
                !options?.requireSellBalance ||
                requiredConditionalRaw === null ||
                !balanceAllowanceClient.getBalanceAllowance
              ) {
                return;
              }

              const balanceAllowance =
                await balanceAllowanceClient.getBalanceAllowance({
                  asset_type: CLOB_ASSET_TYPES.CONDITIONAL,
                  token_id: params.tokenId,
                });
              const clobBalanceRaw = parseRawUnits(balanceAllowance?.balance);

              if (clobBalanceRaw >= requiredConditionalRaw) return;
            } catch (err) {
              if (options?.requireSellBalance) throw err;
              // Non-fatal for legacy paths: the server may still accept the
              // order if its cache is already fresh; postOrder surfaces any
              // real issue.
              return;
            }
          }

          if (options?.requireSellBalance && requiredConditionalRaw !== null) {
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

        await ensureV2Approvals(
          preflight.buy
            ? {
                requiredPusdRaw: preflight.buy.requiredCollateralRaw,
                negRisk: params.negRisk,
              }
            : undefined,
          () => {
            activeStepRef.current = "approving";
          }
        );

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
              tokenID: params.tokenId,
              amount: marketAmount,
              side: params.side as SdkSide,
              // feeRateBps removed (V2: protocol-determined at match time)
              ...(params.price > 0 ? { price: params.price } : {}),
            },
            orderOptions
          );

          // Resync once more after signing; keep this best-effort because the
          // strict SELL cache check already happened immediately above.
          await syncBalanceAllowance();

          didPostOrder = true;
          const response = await client.postOrder(
            order,
            params.orderType as SdkOrderType | undefined
          );
          assertClobPostOrderSuccess(response);
          return { success: true, order: response };
        }

        const order = await client.createOrder(
          {
            tokenID: params.tokenId,
            price: params.price,
            size: params.size,
            side: params.side as SdkSide,
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
        const response = await client.postOrder(
          order,
          params.orderType as SdkOrderType | undefined
        );
        assertClobPostOrderSuccess(response);
        return { success: true, order: response };
      } catch (err) {
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
      readConditionalBalanceRaw,
    ]
  );

  /**
   * Get the order book for a token
   */
  const getOrderBook = useCallback(async (tokenId: string) => {
    try {
      return await fetchClobOrderBook(tokenId, { host: CLOB_HOST });
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
    async (approvalAmount?: string) => {
      if (!address) throw new Error("Wallet not connected");

      setIsLoading(true);
      setOperationStep("approving");
      setError(null);

      try {
        if (!isEoaMode) {
          const result = await approveUsdcForTrading(approvalAmount);
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
          import("viem/chains"),
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

        const approvalTxs =
          buildFullTradingApprovalTransactions(approvalAmountRaw);
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

        const client = createPublicClient({
          chain: polygon,
          transport: http(getRpcUrl()),
        });

        const allowance = await readPusdExchangeAllowance(
          client,
          targetAddress as Address,
          negRisk
        );

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
    operationStep,
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
