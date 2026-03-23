"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "wagmi";
import {
  OrderType as ClobOrderType,
  Side,
  useClobClient,
} from "@/hooks/use-clob-client";
import {
  PROXY_WALLET_QUERY_KEY,
  useProxyWallet,
} from "@/hooks/use-proxy-wallet";
import { calculatePotentialPnL, OrderSide } from "@/lib/polymarket";
import { clearBalanceCache } from "@/lib/rpc";
import {
  calculateSlippage,
  roundDownToTick,
  roundUpToTick,
} from "@/lib/slippage";
import type { OrderTypeSelection, TradingSide } from "@/types/market";
import type { TradingFormProps } from "../types";

const DEFAULT_MAX_SLIPPAGE_PERCENT = 2;
const MIN_MARKETABLE_BUY_NOTIONAL_USD = 1;

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
    error: clobError,
    hasCredentials,
    canTrade,
    updateAllowance,
    getUsdcBalance,
    getUsdcAllowance,
  } = useClobClient();

  const { proxyAddress, isDeployed: hasProxyWallet } = useProxyWallet();

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

  // Type for user positions response
  interface UserPositionsResponse {
    positions?: Array<{
      asset?: string;
      size?: number;
    }>;
  }

  // Fetch user's position for the current token (for SELL max shares)
  const { data: userPositionData } = useQuery<UserPositionsResponse | null>({
    queryKey: ["userPositions", proxyAddress],
    queryFn: async (): Promise<UserPositionsResponse | null> => {
      if (!proxyAddress) return null;
      const response = await fetch(
        `/api/user/positions?user=${proxyAddress}&active=true`
      );
      if (!response.ok) return null;
      return response.json() as Promise<UserPositionsResponse>;
    },
    enabled: !!proxyAddress && hasProxyWallet,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const [side, setSide] = useState<TradingSide>(initialSide ?? "BUY");
  const [orderType, setOrderType] = useState<OrderTypeSelection>("MARKET");
  const [limitPrice, setLimitPrice] = useState<number>(0.5);
  const [shares, setShares] = useState<number>(initialShares ?? 10);
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

  // Set initial limit price when outcome changes, but allow user to override
  useEffect(() => {
    if (selectedOutcome && orderType === "LIMIT" && !hasUserEditedPrice) {
      setLimitPrice(Number(selectedOutcome.price.toFixed(2)));
    }
  }, [selectedOutcome, orderType, hasUserEditedPrice]);

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

  const handleLimitPriceChange = useCallback((price: number) => {
    setHasUserEditedPrice(true);
    setLimitPrice(price);
  }, []);

  const slippageResult = useMemo(() => {
    if (!orderBook || orderType !== "MARKET" || shares <= 0) return null;
    try {
      return calculateSlippage(orderBook, side, shares);
    } catch {
      return null;
    }
  }, [orderBook, orderType, side, shares]);

  const marketOrderPrice = useMemo(() => {
    if (slippageResult?.canFill) {
      if (side === "BUY") {
        const priceWithBuffer = slippageResult.worstPrice * 1.005;
        return Math.min(0.99, roundUpToTick(priceWithBuffer, tickSize));
      } else {
        const priceWithBuffer = slippageResult.worstPrice * 0.995;
        return Math.max(0.01, roundDownToTick(priceWithBuffer, tickSize));
      }
    }

    const maxSlippageFraction = maxSlippagePercent / 100;
    if (side === "BUY") {
      const basePrice = bestAsk ?? selectedOutcome?.price ?? 0.5;
      const priceWithSlippage = basePrice * (1 + maxSlippageFraction);
      return Math.min(0.99, roundUpToTick(priceWithSlippage, tickSize));
    } else {
      const basePrice = bestBid ?? selectedOutcome?.price ?? 0.5;
      const priceWithSlippage = basePrice * (1 - maxSlippageFraction);
      return Math.max(0.01, roundDownToTick(priceWithSlippage, tickSize));
    }
  }, [
    slippageResult,
    side,
    tickSize,
    maxSlippagePercent,
    bestAsk,
    bestBid,
    selectedOutcome?.price,
  ]);

  const calculations = useMemo(() => {
    const price = orderType === "MARKET" ? marketOrderPrice : limitPrice;
    const orderSide = side === "BUY" ? OrderSide.BUY : OrderSide.SELL;
    const pnl = calculatePotentialPnL(price, shares, orderSide);
    const total =
      orderType === "MARKET" && slippageResult
        ? slippageResult.totalNotional
        : pnl.cost;

    return {
      price,
      total,
      potentialWin: pnl.potentialWin,
      potentialLoss: pnl.potentialLoss,
      returnPercent:
        total > 0 ? ((pnl.potentialWin / total) * 100).toFixed(1) : "0",
    };
  }, [side, orderType, limitPrice, marketOrderPrice, shares, slippageResult]);

  const { data: onChainBalance, refetch: refetchBalance } = useQuery({
    queryKey: ["usdcBalance", proxyAddress, hasProxyWallet],
    queryFn: () => getUsdcBalance(proxyAddress || undefined),
    enabled: isConnected && hasProxyWallet && !!proxyAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: onChainAllowance, refetch: refetchAllowance } = useQuery({
    queryKey: ["usdcAllowance", proxyAddress, hasProxyWallet],
    queryFn: () => getUsdcAllowance(proxyAddress || undefined),
    enabled: isConnected && hasProxyWallet && !!proxyAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const usdcBalance = onChainBalance?.balance;
  const allowance = onChainAllowance?.allowance;
  const effectiveBalance = usdcBalance ?? userBalance;

  const hasInsufficientBalance =
    effectiveBalance !== undefined && calculations.total > effectiveBalance;
  const hasInsufficientAllowance =
    allowance !== undefined && calculations.total > allowance;
  const hasNoAllowance = allowance !== undefined && allowance === 0;

  const isMarketableBuy = useMemo(() => {
    if (side !== "BUY") return false;
    if (orderType === "MARKET") return true;
    if (bestAsk === undefined) return false;
    return limitPrice >= bestAsk;
  }, [side, orderType, bestAsk, limitPrice]);

  const isBelowMarketableBuyMinNotional = useMemo(() => {
    if (!isMarketableBuy) return false;
    return calculations.total < MIN_MARKETABLE_BUY_NOTIONAL_USD;
  }, [isMarketableBuy, calculations.total]);

  const handleSetAllowance = useCallback(async () => {
    setIsUpdatingAllowance(true);
    try {
      await updateAllowance();
      await Promise.all([refetchBalance(), refetchAllowance()]);
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Failed to set allowance");
      onOrderError?.(error);
    } finally {
      setIsUpdatingAllowance(false);
    }
  }, [updateAllowance, refetchBalance, refetchAllowance, onOrderError]);

  const handleSharesChange = useCallback(
    (delta: number) => {
      // For SELL, minimum is 1. For BUY, use minShares from market.
      const effectiveMin = side === "SELL" ? 1 : minShares;
      setShares((prev) => Math.max(effectiveMin, prev + delta));
    },
    [minShares, side]
  );

  const handleSubmit = useCallback(async () => {
    if (!canTrade || !selectedOutcome || !hasValidTokenId) return;

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

      const orderPrice = orderType === "MARKET" ? marketOrderPrice : limitPrice;

      const result = await createOrder({
        tokenId: selectedOutcome.tokenId,
        price: orderPrice,
        size: shares,
        side: side === "BUY" ? Side.BUY : Side.SELL,
        orderType: clobOrderType,
        expiration,
        negRisk,
      });

      if (result.success) {
        onOrderSuccess?.(result.order);
        setShares(initialShares ?? 10);
        if (proxyAddress) {
          // Clear the RPC-level balance cache FIRST before any refetching
          clearBalanceCache(proxyAddress);

          // Invalidate all related queries
          await Promise.all([
            // Use exact query key match for proxy wallet (includes address)
            queryClient.invalidateQueries({
              queryKey: [PROXY_WALLET_QUERY_KEY],
              exact: false, // Match all queries starting with this key
            }),
            queryClient.invalidateQueries({ queryKey: ["usdcBalance"] }),
            queryClient.invalidateQueries({ queryKey: ["userPositions"] }),
            queryClient.invalidateQueries({ queryKey: ["openOrders"] }),
          ]);

          // Immediate refetch after cache is cleared
          await Promise.all([
            queryClient.refetchQueries({
              queryKey: [PROXY_WALLET_QUERY_KEY],
              exact: false,
            }),
            queryClient.refetchQueries({ queryKey: ["usdcBalance"] }),
            queryClient.refetchQueries({ queryKey: ["userPositions"] }),
          ]);

          // Multiple delayed refetches to catch backend updates
          // Also clear RPC cache again before each refetch to ensure fresh data
          const refetchAll = async () => {
            clearBalanceCache(proxyAddress);
            await Promise.all([
              queryClient.refetchQueries({
                queryKey: [PROXY_WALLET_QUERY_KEY],
                exact: false,
              }),
              queryClient.refetchQueries({ queryKey: ["usdcBalance"] }),
              queryClient.refetchQueries({ queryKey: ["userPositions"] }),
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
      } else {
        throw new Error("Order failed");
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Order failed");
      onOrderError?.(error);
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
    shares,
    side,
    negRisk,
    createOrder,
    onOrderSuccess,
    proxyAddress,
    queryClient,
    onOrderError,
    initialShares,
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
    allowPartialFill,
    setAllowPartialFill,
    expirationType,
    setExpirationType,
    expirationTime,
    setExpirationTime,
    tickSize,
    isUpdatingAllowance,
    isLoading: isClobLoading || isUpdatingAllowance,
    error: clobError,
    calculations,
    slippageResult,
    effectiveBalance,
    hasInsufficientBalance,
    hasInsufficientAllowance,
    hasNoAllowance,
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
    canFullyFill: slippageResult?.canFill ?? true,
  };
}
