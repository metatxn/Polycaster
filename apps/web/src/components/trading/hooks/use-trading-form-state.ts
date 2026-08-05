"use client";

import { isClobOrderApproved } from "@knoww/shared-types/approvals";
import {
  estimateFallbackFeeRaw,
  MIN_MARKETABLE_BUY_TICKET_USD,
  parsePusdUnits,
} from "@knoww/shared-types/trading";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "wagmi";
import { PUSD_DECIMALS } from "@/constants/contracts";
import {
  OrderType as ClobOrderType,
  Side,
  useClobClient,
} from "@/hooks/use-clob-client";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useUserPositions } from "@/hooks/use-user-positions";
import { checkAllApprovals } from "@/lib/approvals";
import { calculatePotentialPnL, OrderSide } from "@/lib/polymarket";
import { qk } from "@/lib/query-keys";
import { clearBalanceCache } from "@/lib/rpc";
import {
  calculateBuySlippageForAmount,
  calculateSellSlippage,
  normalizeLimitPrice,
  roundDownToTick,
  roundUpToTick,
} from "@/lib/slippage";
import type { OrderTypeSelection, TradingSide } from "@/types/market";
import type { TradingFormProps } from "../types";

const DEFAULT_MAX_SLIPPAGE_PERCENT = 2;
// Default USD budget for a MARKET BUY. Market buys are denominated in dollars
// (Polymarket's `createMarketOrder` takes a notional `amount`, not a share
// count). Opens at $0 — an empty state the user fills via the input or a quick
// preset; the summary stays hidden until the amount clears the minimum.
const DEFAULT_MARKET_BUY_AMOUNT_USD = 0;
const APPROVAL_CHECK_BUCKET_RAW = BigInt(10) ** BigInt(PUSD_DECIMALS);

export function useTradingFormState({
  outcomes,
  selectedOutcomeIndex,
  negRisk = false,
  userBalance,
  tickSize = 0.01,
  minOrderSize = 1,
  bestBid,
  bestAsk,
  orderBook,
  maxSlippagePercent = DEFAULT_MAX_SLIPPAGE_PERCENT,
  conditionId,
  onOrderSuccess,
  onOrderError,
  initialSide,
  initialShares,
}: Partial<TradingFormProps> & {
  outcomes: TradingFormProps["outcomes"];
  selectedOutcomeIndex: number;
}) {
  const { isConnected } = useConnection();
  const queryClient = useQueryClient();
  const {
    createOrder,
    isLoading: isClobLoading,
    operationStep,
    error: clobError,
    hasCredentials,
    canTrade,
    updateAllowance,
    getUsdcAllowance,
    estimateBuyFee,
  } = useClobClient();

  const {
    proxyAddress,
    isDeployed: hasProxyWallet,
    usdcBalance: proxyUsdcBalance,
    refresh: refreshProxyWallet,
  } = useProxyWallet();

  // Track pending refetch timers so we can clean them up on unmount
  const pendingTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clean up all pending timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of pendingTimersRef.current) {
        clearTimeout(timer);
      }
      pendingTimersRef.current = [];
    };
  }, []);

  // Shares the React Query cache with other callers of `useUserPositions`
  // (e.g. the outcomes table), so we only pay for one network round trip.
  const { data: userPositionData } = useUserPositions({
    userAddress: proxyAddress ?? undefined,
    enabled: !!proxyAddress && hasProxyWallet,
  });

  const [side, setSide] = useState<TradingSide>(initialSide ?? "BUY");
  const [orderType, setOrderType] = useState<OrderTypeSelection>("MARKET");
  const [limitPrice, setLimitPrice] = useState<number>(0.5);
  const [shares, setShares] = useState<number>(initialShares ?? 10);
  // USD budget for MARKET BUY orders. Independent of `shares` (which still
  // drives LIMIT orders and MARKET SELLs); for a market buy the user spends a
  // dollar amount and the filled share count is derived from the book.
  const [marketBuyAmount, setMarketBuyAmount] = useState<number>(
    DEFAULT_MARKET_BUY_AMOUNT_USD
  );
  const [allowPartialFill, setAllowPartialFill] = useState<boolean>(true);
  const [isUpdatingAllowance, setIsUpdatingAllowance] = useState(false);
  const [hasUserEditedPrice, setHasUserEditedPrice] = useState(false);

  // Expiration settings for Limit orders
  const [expirationType, setExpirationType] = useState<"GTC" | "GTD">("GTC");
  const [expirationTime, setExpirationTime] = useState<number>(3600); // Default 1 hour for GTD

  const selectedOutcome = outcomes[selectedOutcomeIndex];
  const hasValidTokenId = Boolean(
    selectedOutcome?.tokenId && selectedOutcome.tokenId.length > 10
  );

  // Calculate max shares user can sell based on their position
  const maxSellShares = useMemo(() => {
    if (!userPositionData?.positions || !selectedOutcome?.tokenId) return 0;

    // Find position matching the current token
    const position = userPositionData.positions.find(
      (p) => p.asset === selectedOutcome.tokenId
    );

    return position?.size ?? 0;
  }, [userPositionData?.positions, selectedOutcome?.tokenId]);

  const minShares = useMemo(() => {
    const raw = Number.isFinite(minOrderSize) ? minOrderSize : 1;
    return Math.max(1, Math.ceil(raw));
  }, [minOrderSize]);

  // Set initial limit price when outcome changes, but allow user to override.
  // Snapped to the market's tick rather than to a cent: on a 0.001-tick market
  // `toFixed(2)` moved a 9.7¢ outcome to 10¢ before the user touched anything.
  useEffect(() => {
    if (selectedOutcome && orderType === "LIMIT" && !hasUserEditedPrice) {
      setLimitPrice(normalizeLimitPrice(selectedOutcome.price, tickSize));
    }
  }, [selectedOutcome, orderType, hasUserEditedPrice, tickSize]);

  // Reset user edit flag when switching outcomes - using ref to track previous tokenId
  const previousTokenIdRef = useRef(selectedOutcome?.tokenId);
  useEffect(() => {
    if (previousTokenIdRef.current !== selectedOutcome?.tokenId) {
      setHasUserEditedPrice(false);
      previousTokenIdRef.current = selectedOutcome?.tokenId;
    }
  }, [selectedOutcome?.tokenId]);

  // Update side when initialSide changes (e.g., from URL params)
  useEffect(() => {
    if (initialSide) {
      setSide(initialSide);
    }
  }, [initialSide]);

  // Update shares when initialShares changes (e.g., from URL params)
  useEffect(() => {
    if (initialShares !== undefined && initialShares > 0) {
      setShares(initialShares);
    }
  }, [initialShares]);

  // For BUY, ensure shares meet minimum
  useEffect(() => {
    if (side === "BUY") {
      setShares((prev) => (prev < minShares ? minShares : prev));
    }
  }, [minShares, side]);

  // When switching to SELL, auto-fill with user's position size
  const previousSideRef = useRef(side);
  useEffect(() => {
    // Only trigger when side changes TO SELL
    if (
      side === "SELL" &&
      previousSideRef.current === "BUY" &&
      maxSellShares > 0
    ) {
      setShares(maxSellShares);
    }
    previousSideRef.current = side;
  }, [side, maxSellShares]);

  // Also cap shares if they exceed position when on SELL
  useEffect(() => {
    if (side === "SELL" && maxSellShares > 0 && shares > maxSellShares) {
      setShares(maxSellShares);
    }
  }, [side, maxSellShares, shares]);

  // Every limit-price write in the ticket lands here, so this is where the
  // price is put back on the tick grid. The ± stepper does its arithmetic in
  // cents (`price * 100 ± tickCents`, then `/ 100`), and those float
  // round-trips drift off-grid — 10.0¢ stepped down to "9.5¢" arrives as
  // 0.09500000000000001, which the SDK rejects as having more decimal places
  // than the tick allows.
  const handleLimitPriceChange = useCallback(
    (price: number) => {
      setHasUserEditedPrice(true);
      setLimitPrice(normalizeLimitPrice(price, tickSize));
    },
    [tickSize]
  );

  const slippageResult = useMemo(() => {
    if (!orderBook || orderType !== "MARKET") return null;
    try {
      // MARKET BUY walks the book by USD budget (matches on-chain
      // `createMarketOrder`, which takes a notional amount). MARKET SELL walks
      // by share count out of the user's position.
      if (side === "BUY") {
        if (marketBuyAmount <= 0) return null;
        return calculateBuySlippageForAmount(orderBook, marketBuyAmount);
      }
      if (shares <= 0) return null;
      return calculateSellSlippage(orderBook, shares);
    } catch {
      return null;
    }
  }, [orderBook, orderType, side, shares, marketBuyAmount]);

  // `slippageResult` is null in three very different situations: the user has
  // not entered a size yet, the book has not loaded, or the walk threw. Only
  // the case where the book was actually walked and came up short is genuinely
  // "insufficient liquidity" — the others get their own labels so the form
  // never blames a deep market for an empty amount field.
  const hasMarketOrderSize =
    orderType === "MARKET" &&
    (side === "BUY" ? marketBuyAmount > 0 : shares > 0);
  const isMarketOrderSizeEmpty = orderType === "MARKET" && !hasMarketOrderSize;
  const isOrderBookUnavailable =
    orderType === "MARKET" && hasMarketOrderSize && !orderBook;

  // The book came up short, but the user allowed a partial fill (FAK) and the
  // walk did touch real depth. FAK's contract is "fill whatever is available
  // within the price bound, cancel the rest", so this is a placeable order —
  // we just size the ticket down to the fillable portion and say so.
  const isPartialFillAvailable =
    orderType === "MARKET" &&
    allowPartialFill &&
    slippageResult !== null &&
    !slippageResult.canFill &&
    slippageResult.filledSize > 0 &&
    slippageResult.worstPrice > 0;

  // Genuinely un-fillable: either the user demanded all-or-nothing (FOK) or
  // the book has no depth at all to walk into.
  const hasInsufficientLiquidity =
    orderType === "MARKET" &&
    slippageResult !== null &&
    !slippageResult.canFill &&
    !isPartialFillAvailable;

  const marketOrderPrice = useMemo(() => {
    // A partial FAK walk still produces a real worst price — the price of the
    // deepest level the fillable portion reaches — so it gets the same bound
    // as a full fill. This matters: `optionalPriceBound` in the SDK shim drops
    // any non-positive price, so falling through to `0` here would sign the
    // order with NO `maxPrice`/`minPrice` at all (unbounded slippage).
    if (slippageResult && (slippageResult.canFill || isPartialFillAvailable)) {
      const worst = new Decimal(slippageResult.worstPrice);
      if (side === "BUY") {
        const buffered = worst.mul("1.005").toNumber();
        return Math.min(1 - tickSize, roundUpToTick(buffered, tickSize));
      }
      const buffered = worst.mul("0.995").toNumber();
      return Math.max(tickSize, roundDownToTick(buffered, tickSize));
    }

    // MARKET order the book cannot fill, and the user did not allow a partial
    // fill (FOK) — or there is no depth to price against at all. Do NOT
    // synthesize a "reasonable" price from the Gamma/outcome price here: an
    // FOK order that cannot fill in full is killed, so painting a plausible
    // estimate would mislead the user into thinking it will settle there.
    // Returning 0 surfaces an honest "0.0¢ / $0.00" in the summary, and the
    // submit button is already disabled via `canPlaceMarketOrder` in the
    // parent form (labelled by `hasInsufficientLiquidity` /
    // `isOrderBookUnavailable`).
    if (orderType === "MARKET") {
      return 0;
    }

    // Fallback path for non-MARKET orders (LIMIT) where slippageResult is
    // intentionally null — used only to seed an initial price suggestion.
    const maxFrac = new Decimal(maxSlippagePercent).div(100);
    if (side === "BUY") {
      const base = new Decimal(bestAsk ?? selectedOutcome?.price ?? 0.5);
      const withSlippage = base.mul(new Decimal(1).add(maxFrac)).toNumber();
      return Math.min(1 - tickSize, roundUpToTick(withSlippage, tickSize));
    }
    const base = new Decimal(bestBid ?? selectedOutcome?.price ?? 0.5);
    const withSlippage = base.mul(new Decimal(1).sub(maxFrac)).toNumber();
    return Math.max(tickSize, roundDownToTick(withSlippage, tickSize));
  }, [
    slippageResult,
    isPartialFillAvailable,
    orderType,
    side,
    tickSize,
    maxSlippagePercent,
    bestAsk,
    bestBid,
    selectedOutcome?.price,
  ]);

  // What the ticket has to say out loud when FAK sizes the order down: the
  // user asked for one number and only part of it is reachable on the book.
  const partialFill = useMemo(() => {
    if (!isPartialFillAvailable || !slippageResult) return null;
    return {
      filledShares: slippageResult.filledSize,
      filledUsd: slippageResult.totalNotional,
      requestedUsd: side === "BUY" ? marketBuyAmount : null,
      requestedShares: side === "BUY" ? null : shares,
    };
  }, [isPartialFillAvailable, slippageResult, side, marketBuyAmount, shares]);

  const calculations = useMemo(() => {
    const price = orderType === "MARKET" ? marketOrderPrice : limitPrice;
    const orderSide = side === "BUY" ? OrderSide.BUY : OrderSide.SELL;
    // For a MARKET BUY the user controls the dollar budget, so the share count
    // is whatever that budget fills on the book. A MARKET SELL is entered in
    // shares, but on a partial (FAK) fill only `filledSize` of them clear —
    // and that is the number we sign, so it is the number we show. Everywhere
    // else the share count is the canonical input.
    const isMarketBuy = orderType === "MARKET" && side === "BUY";
    const size =
      orderType === "MARKET"
        ? (slippageResult?.filledSize ?? (isMarketBuy ? 0 : shares))
        : shares;
    const pnl = calculatePotentialPnL(price, size, orderSide);
    const total =
      orderType === "MARKET" && slippageResult
        ? slippageResult.totalNotional
        : orderSide === OrderSide.SELL
          ? pnl.proceeds
          : pnl.cost;

    return {
      price,
      total,
      size,
      potentialWin: pnl.potentialWin,
      potentialLoss: pnl.potentialLoss,
      returnPercent:
        total > 0
          ? new Decimal(pnl.potentialWin).div(total).mul(100).toFixed(1)
          : "0",
    };
  }, [side, orderType, limitPrice, marketOrderPrice, shares, slippageResult]);

  const { data: onChainAllowance, refetch: refetchAllowance } = useQuery({
    queryKey: qk.wallet.usdcAllowance(proxyAddress, hasProxyWallet, negRisk),
    queryFn: () => getUsdcAllowance(proxyAddress || undefined, negRisk),
    enabled: isConnected && hasProxyWallet && !!proxyAddress,
    // Allowance only changes when we explicitly update it. Polling every
    // trading form mount creates steady Polygon RPC pressure for no benefit.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // V2 settles in pUSD; legacy USDC.e is auto-wrapped on BUY. The proxy-wallet
  // hook reports the combined spendable balance (pUSD + USDC.e), so the form
  // and the chrome (navbar/portfolio) read the same number.
  const effectiveBalance =
    isConnected && hasProxyWallet ? proxyUsdcBalance : userBalance;
  const allowance = onChainAllowance?.allowance;

  const hasInsufficientBalance =
    effectiveBalance !== undefined && calculations.total > effectiveBalance;
  const hasInsufficientAllowance =
    allowance !== undefined && calculations.total > allowance;
  const hasNoAllowance = allowance !== undefined && allowance === 0;

  const requiredApprovalAmountRaw = useMemo(() => {
    if (side === "SELL") {
      return shares > 0 ? BigInt(1) : BigInt(0);
    }
    if (!Number.isFinite(calculations.total) || calculations.total <= 0) {
      return BigInt(0);
    }
    const requiredRaw = parsePusdUnits(new Decimal(calculations.total));
    return requiredRaw + estimateFallbackFeeRaw(requiredRaw);
  }, [calculations.total, shares, side]);

  const bucketedRequiredApprovalAmountRaw = useMemo(() => {
    if (requiredApprovalAmountRaw <= BigInt(0)) return BigInt(0);
    return (
      ((requiredApprovalAmountRaw + APPROVAL_CHECK_BUCKET_RAW - BigInt(1)) /
        APPROVAL_CHECK_BUCKET_RAW) *
      APPROVAL_CHECK_BUCKET_RAW
    );
  }, [requiredApprovalAmountRaw]);

  const approvalAmount = useMemo(() => {
    return new Decimal(bucketedRequiredApprovalAmountRaw.toString())
      .div(new Decimal(10).pow(PUSD_DECIMALS))
      .toString();
  }, [bucketedRequiredApprovalAmountRaw]);

  // The market order notional can move on every order book tick. Keep approval
  // checks close to the actual required amount, but debounce and bucket them so
  // cent-level quote movement does not create distinct Polygon multicalls.
  const [tradingApprovalCheckAmountRaw, setTradingApprovalCheckAmountRaw] =
    useState(bucketedRequiredApprovalAmountRaw);

  useEffect(() => {
    const timer = setTimeout(() => {
      setTradingApprovalCheckAmountRaw(bucketedRequiredApprovalAmountRaw);
    }, 1500);

    return () => clearTimeout(timer);
  }, [bucketedRequiredApprovalAmountRaw]);

  const shouldCheckTradingApprovals =
    isConnected &&
    hasProxyWallet &&
    !!proxyAddress &&
    tradingApprovalCheckAmountRaw > BigInt(0);

  const {
    data: tradingApprovalStatus,
    refetch: refetchTradingApprovals,
    isLoading: isCheckingTradingApprovals,
  } = useQuery({
    queryKey: qk.wallet.tradingApprovals(
      proxyAddress,
      hasProxyWallet,
      tradingApprovalCheckAmountRaw.toString()
    ),
    queryFn: () =>
      checkAllApprovals(proxyAddress || "", tradingApprovalCheckAmountRaw),
    enabled: shouldCheckTradingApprovals,
    // This query is the ticket's approval gate. Keep it fresh enough that the
    // button matches the order pre-flight, without polling every keystroke.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
  const hasMissingTradingApprovals =
    shouldCheckTradingApprovals &&
    tradingApprovalStatus !== undefined &&
    !isClobOrderApproved(tradingApprovalStatus, {
      side,
      negRisk,
    });
  const useAllowanceFallbackGate =
    side === "BUY" && tradingApprovalStatus === undefined;
  const hasEffectiveInsufficientAllowance =
    useAllowanceFallbackGate && hasInsufficientAllowance;
  const hasEffectiveNoAllowance = useAllowanceFallbackGate && hasNoAllowance;

  const isMarketableBuy = useMemo(() => {
    if (side !== "BUY") return false;
    if (orderType === "MARKET") return true;
    if (bestAsk === undefined) return false;
    return limitPrice >= bestAsk;
  }, [side, orderType, bestAsk, limitPrice]);

  const isBelowMarketableBuyMinNotional = useMemo(() => {
    if (!isMarketableBuy) return false;
    // `calculations.total` is the pre-fee ticket amount. Signed without
    // `maxSpend`, so `makerAmount` equals it and the server's $1 floor applies
    // to it directly — no fee headroom needed. See MIN_MARKETABLE_BUY_TICKET_USD.
    return calculations.total < MIN_MARKETABLE_BUY_TICKET_USD;
  }, [isMarketableBuy, calculations.total]);

  // Round the fee inputs before they reach the query key. The fee is a smooth
  // function of size and price, so a cent of movement never changes the
  // displayed number — but an unrounded key would refetch on every keystroke.
  const feeEstimateInputs = useMemo(() => {
    if (side !== "BUY" || !conditionId) return null;
    if (calculations.size <= 0 || calculations.total <= 0) return null;
    // A market order the book cannot fill prices at 0 (see `marketOrderPrice`),
    // and the protocol fee curve is 0 at that endpoint — quoting it would print
    // a confident "$0.00" for a fee we have no basis to estimate.
    if (calculations.price <= 0) return null;
    return {
      size: calculations.size.toFixed(2),
      price: calculations.price.toFixed(4),
      notional: calculations.total.toFixed(2),
    };
  }, [
    side,
    conditionId,
    calculations.size,
    calculations.price,
    calculations.total,
  ]);

  const { data: estimatedFeeRaw, isFetching: isFeeEstimateFetching } = useQuery(
    {
      queryKey: qk.orders.buyFeeEstimate(
        conditionId,
        feeEstimateInputs?.size ?? "",
        feeEstimateInputs?.price ?? "",
        feeEstimateInputs?.notional ?? ""
      ),
      queryFn: () =>
        estimateBuyFee({
          conditionId,
          size: Number(feeEstimateInputs?.size),
          price: Number(feeEstimateInputs?.price),
          notional: Number(feeEstimateInputs?.notional),
          isMarketableBuy,
        }),
      enabled: !!feeEstimateInputs && hasCredentials && !!proxyAddress,
      // Market fee parameters are effectively static; the ticket inputs are
      // already in the key, so anything cached for this exact ticket is fresh.
      staleTime: 5 * 60 * 1000,
      retry: false,
      // Hold the last known fee while the next one loads. Without this the row
      // would blink out of the ticket on every amount change, which reads as
      // "the fee went away" rather than "the fee is being recomputed".
      placeholderData: (previous: bigint | null | undefined) => previous,
    }
  );

  /**
   * Estimated fee in USD, or `null` when it could not be determined.
   *
   * `null` is deliberately not `0` — the market fee lookup can fail, and
   * rendering "$0.00" for an unknown fee would be a worse lie than rendering
   * nothing. Orders sign without `maxSpend`, so this fee is charged *on top of*
   * the ticket total rather than taken out of it.
   */
  const estimatedFeeUsd = useMemo(() => {
    if (estimatedFeeRaw === null || estimatedFeeRaw === undefined) return null;
    return new Decimal(estimatedFeeRaw.toString())
      .div(new Decimal(10).pow(PUSD_DECIMALS))
      .toNumber();
  }, [estimatedFeeRaw]);

  const handleSetAllowance = useCallback(async () => {
    setIsUpdatingAllowance(true);
    try {
      await updateAllowance(approvalAmount, {
        side,
        negRisk,
      });
      await Promise.all([
        refreshProxyWallet(),
        refetchAllowance(),
        refetchTradingApprovals(),
        queryClient.invalidateQueries({
          queryKey: qk.wallet.allTradingApprovals(),
        }),
        queryClient.invalidateQueries({
          queryKey: qk.wallet.allUsdcAllowances(),
        }),
      ]);

      const scheduleApprovalRefetch = (delay: number) => {
        const timerId = setTimeout(() => {
          void Promise.all([
            refreshProxyWallet(),
            refetchAllowance(),
            refetchTradingApprovals(),
          ]);
          pendingTimersRef.current = pendingTimersRef.current.filter(
            (id) => id !== timerId
          );
        }, delay);
        pendingTimersRef.current.push(timerId);
      };

      scheduleApprovalRefetch(1500);
      scheduleApprovalRefetch(4000);
      return true;
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Failed to set allowance");
      onOrderError?.(error);
      return false;
    } finally {
      setIsUpdatingAllowance(false);
    }
  }, [
    updateAllowance,
    approvalAmount,
    side,
    negRisk,
    refreshProxyWallet,
    refetchAllowance,
    refetchTradingApprovals,
    queryClient,
    onOrderError,
  ]);

  const handleSharesChange = useCallback(
    (delta: number) => {
      // For SELL, minimum is 1. For BUY, use minShares from market.
      const effectiveMin = side === "SELL" ? 1 : minShares;
      setShares((prev) => Math.max(effectiveMin, prev + delta));
    },
    [minShares, side]
  );

  const handleSubmit = useCallback(async (): Promise<boolean> => {
    // The submit button disables itself on all three of these, so reaching
    // here means the UI and this guard have drifted apart. Report it rather
    // than returning a bare `false`: a click that does nothing at all, with
    // no toast and no banner, reads to the user as a broken button.
    if (!canTrade || !selectedOutcome || !hasValidTokenId) {
      onOrderError?.(
        new Error(
          "Trading is not ready yet. Reconnect your wallet and try again."
        )
      );
      return false;
    }

    try {
      let clobOrderType: ClobOrderType;
      let expiration = 0;

      if (orderType === "MARKET") {
        clobOrderType = allowPartialFill
          ? ClobOrderType.FAK
          : ClobOrderType.FOK;
      } else {
        // Limit order
        if (expirationType === "GTC") {
          clobOrderType = ClobOrderType.GTC;
        } else {
          clobOrderType = ClobOrderType.GTD;
          // Set expiration to now + expirationTime + 60 seconds (security buffer)
          // Polymarket has a 1-minute security threshold, so we add 60 seconds
          // to ensure the order lasts the full intended duration
          const SECURITY_BUFFER_SECONDS = 60;
          expiration =
            Math.floor(Date.now() / 1000) +
            expirationTime +
            SECURITY_BUFFER_SECONDS;
        }
      }

      // Re-snapped at the boundary as well as on entry: `limitPrice` survives a
      // tick change (the book can load, or the outcome switch, after the price
      // was set), and an off-grid price is rejected by the SDK before the order
      // is ever signed.
      const orderPrice =
        orderType === "MARKET"
          ? marketOrderPrice
          : normalizeLimitPrice(limitPrice, tickSize);

      // MARKET BUY submits a notional `amount` (USD); the on-chain
      // `createMarketOrder` derives the size from it, so `size` here is the
      // informational filled-share estimate. LIMIT submits the share count.
      // A MARKET order signs the *walked* size/notional, so on an FAK partial
      // the order we sign is exactly the order the ticket quoted — the
      // remainder is never sent rather than sent-and-canceled, which keeps the
      // marketable-BUY minimum (`isBelowMarketableBuyMinNotional`) checking
      // the same number the exchange sees.
      const isMarketBuy = orderType === "MARKET" && side === "BUY";
      const result = await createOrder({
        tokenId: selectedOutcome.tokenId,
        conditionId,
        price: orderPrice,
        size: orderType === "MARKET" ? calculations.size : shares,
        amount: isMarketBuy ? calculations.total : undefined,
        side: side === "BUY" ? Side.BUY : Side.SELL,
        orderType: clobOrderType,
        expiration,
        negRisk,
      });

      if (result.success) {
        onOrderSuccess?.(result.order);
        setShares(initialShares ?? 10);
        setMarketBuyAmount(DEFAULT_MARKET_BUY_AMOUNT_USD);
        if (proxyAddress) {
          // Clear the RPC-level balance cache FIRST before any refetching
          clearBalanceCache(proxyAddress);

          // Invalidate all related queries
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: qk.proxyWallet.all(),
            }),
            queryClient.invalidateQueries({
              queryKey: qk.wallet.allUsdcBalances(),
            }),
            queryClient.invalidateQueries({
              queryKey: qk.wallet.allUsdcAllowances(),
            }),
            queryClient.invalidateQueries({
              queryKey: qk.wallet.allTradingApprovals(),
            }),
            queryClient.invalidateQueries({ queryKey: qk.positions.all() }),
            queryClient.invalidateQueries({ queryKey: qk.orders.all() }),
          ]);

          // Immediate refetch after cache is cleared
          await Promise.all([
            queryClient.refetchQueries({
              queryKey: qk.proxyWallet.all(),
              exact: false,
            }),
            queryClient.refetchQueries({
              queryKey: qk.wallet.allUsdcBalances(),
            }),
            queryClient.refetchQueries({
              queryKey: qk.wallet.allUsdcAllowances(),
            }),
            queryClient.refetchQueries({
              queryKey: qk.wallet.allTradingApprovals(),
            }),
            queryClient.refetchQueries({ queryKey: qk.positions.all() }),
          ]);

          // Multiple delayed refetches to catch backend updates
          // Also clear RPC cache again before each refetch to ensure fresh data
          const refetchAll = async () => {
            clearBalanceCache(proxyAddress);
            await Promise.all([
              queryClient.refetchQueries({
                queryKey: qk.proxyWallet.all(),
                exact: false,
              }),
              queryClient.refetchQueries({
                queryKey: qk.wallet.allUsdcBalances(),
              }),
              queryClient.refetchQueries({
                queryKey: qk.wallet.allUsdcAllowances(),
              }),
              queryClient.refetchQueries({
                queryKey: qk.wallet.allTradingApprovals(),
              }),
              queryClient.refetchQueries({ queryKey: qk.positions.all() }),
            ]);
          };

          // Clear any existing pending timers before scheduling new ones
          // (prevents stale timer IDs from accumulating across repeated submissions)
          for (const timer of pendingTimersRef.current) {
            clearTimeout(timer);
          }
          pendingTimersRef.current = [];

          // Refetch at 1s, 3s, and 5s to catch the update
          // Each timer self-removes from the array after it fires
          const scheduleRefetch = (delay: number) => {
            const timerId = setTimeout(() => {
              void refetchAll();
              pendingTimersRef.current = pendingTimersRef.current.filter(
                (id) => id !== timerId
              );
            }, delay);
            pendingTimersRef.current.push(timerId);
          };

          scheduleRefetch(1000);
          scheduleRefetch(3000);
          scheduleRefetch(5000);
        }
        return true;
      } else {
        throw new Error("Order failed");
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Order failed");
      if (proxyAddress) {
        clearBalanceCache(proxyAddress);
        await Promise.allSettled([
          refreshProxyWallet(),
          refetchAllowance(),
          refetchTradingApprovals(),
          queryClient.invalidateQueries({
            queryKey: qk.wallet.allTradingApprovals(),
          }),
          queryClient.invalidateQueries({
            queryKey: qk.wallet.allUsdcAllowances(),
          }),
        ]);
      }
      onOrderError?.(error);
      return false;
    }
  }, [
    canTrade,
    selectedOutcome,
    hasValidTokenId,
    orderType,
    allowPartialFill,
    expirationType,
    expirationTime,
    marketOrderPrice,
    limitPrice,
    tickSize,
    shares,
    side,
    negRisk,
    conditionId,
    createOrder,
    onOrderSuccess,
    proxyAddress,
    queryClient,
    onOrderError,
    initialShares,
    calculations.total,
    calculations.size,
    refreshProxyWallet,
    refetchAllowance,
    refetchTradingApprovals,
  ]);

  return {
    side,
    setSide,
    orderType,
    setOrderType,
    limitPrice,
    setLimitPrice: handleLimitPriceChange,
    shares,
    setShares,
    marketBuyAmount,
    setMarketBuyAmount,
    minBuyAmount: MIN_MARKETABLE_BUY_TICKET_USD,
    estimatedFeeUsd,
    isFeeEstimateFetching,
    allowPartialFill,
    setAllowPartialFill,
    expirationType,
    setExpirationType,
    expirationTime,
    setExpirationTime,
    tickSize,
    isUpdatingAllowance,
    isLoading: isClobLoading || isUpdatingAllowance,
    operationStep,
    error: clobError,
    calculations,
    slippageResult,
    effectiveBalance,
    hasInsufficientBalance,
    hasInsufficientAllowance: hasEffectiveInsufficientAllowance,
    hasNoAllowance: hasEffectiveNoAllowance,
    hasMissingTradingApprovals,
    isCheckingTradingApprovals:
      shouldCheckTradingApprovals && isCheckingTradingApprovals,
    isBelowMarketableBuyMinNotional,
    minShares,
    maxSellShares,
    canTrade,
    hasCredentials,
    isConnected,
    handleSetAllowance,
    handleSharesChange,
    handleSubmit,
    hasValidTokenId,
    // Not "the book can fill the whole ticket" — that would block every FAK
    // partial. This is "we have something real to sign": a full walk, or a
    // partial one the user opted into. Non-MARKET tickets are gated elsewhere.
    canPlaceMarketOrder:
      orderType !== "MARKET" ||
      Boolean(slippageResult?.canFill) ||
      isPartialFillAvailable,
    partialFill,
    hasInsufficientLiquidity,
    isOrderBookUnavailable,
    isMarketOrderSizeEmpty,
  };
}
