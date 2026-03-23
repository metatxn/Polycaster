"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { Position } from "@/components/portfolio/types";
import {
  OrderType as ClobOrderType,
  Side,
  useClobClient,
} from "@/hooks/use-clob-client";
import {
  PROXY_WALLET_QUERY_KEY,
  useProxyWallet,
} from "@/hooks/use-proxy-wallet";
import { clearBalanceCache } from "@/lib/rpc";
import { calculateSlippage, roundDownToTick } from "@/lib/slippage";

const CLOB_HOST =
  process.env.NEXT_PUBLIC_POLYMARKET_HOST || "https://clob.polymarket.com";

interface OrderBookData {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

interface UseSellPositionOptions {
  position: Position | null;
  onSellSuccess?: () => void;
  onSellError?: (error: Error) => void;
}

export function useSellPosition({
  position,
  onSellSuccess,
  onSellError,
}: UseSellPositionOptions) {
  const queryClient = useQueryClient();
  const { proxyAddress } = useProxyWallet();
  const {
    createOrder,
    isLoading: isClobLoading,
    error: clobError,
    canTrade,
  } = useClobClient();

  const [shares, setShares] = useState<number>(position?.size ?? 0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get token ID for the position (we need to sell the token we own)
  const tokenId = useMemo(() => {
    if (!position) return "";
    // The position should have the asset/tokenId from the market
    // For Yes positions, we sell Yes tokens; for No positions, we sell No tokens
    return position.asset || "";
  }, [position]);

  // Fetch order book for the position's token
  const { data: orderBookData, isLoading: isLoadingOrderBook } =
    useQuery<OrderBookData | null>({
      queryKey: ["orderBook", tokenId],
      queryFn: async (): Promise<OrderBookData | null> => {
        if (!tokenId) return null;
        const response = await fetch(`${CLOB_HOST}/book?token_id=${tokenId}`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return null;
        const data = (await response.json()) as {
          bids?: Array<{ price: string; size: string }>;
          asks?: Array<{ price: string; size: string }>;
        };
        return {
          bids: data.bids || [],
          asks: data.asks || [],
        };
      },
      enabled: !!tokenId,
      staleTime: 5000, // Refresh every 5 seconds for fresh pricing
      refetchInterval: 5000,
    });

  // Calculate estimated proceeds based on order book depth
  const sellEstimate = useMemo(() => {
    if (!orderBookData || shares <= 0) {
      return {
        canFill: false,
        estimatedPrice: position?.currentPrice ?? 0,
        estimatedProceeds: 0,
        slippagePercent: 0,
      };
    }

    try {
      const slippageResult = calculateSlippage(orderBookData, "SELL", shares);

      if (slippageResult.canFill) {
        return {
          canFill: true,
          estimatedPrice: slippageResult.avgFillPrice,
          estimatedProceeds: slippageResult.totalNotional,
          slippagePercent: slippageResult.slippagePercent,
          worstPrice: slippageResult.worstPrice,
        };
      }

      // Can't fully fill - use best bid as estimate
      const bestBid = orderBookData.bids[0];
      const bestBidPrice = bestBid ? Number.parseFloat(bestBid.price) : 0;
      return {
        canFill: false,
        estimatedPrice: bestBidPrice,
        estimatedProceeds: shares * bestBidPrice,
        slippagePercent: 0,
      };
    } catch {
      const bestBid = orderBookData.bids[0];
      const bestBidPrice = bestBid ? Number.parseFloat(bestBid.price) : 0;
      return {
        canFill: false,
        estimatedPrice: bestBidPrice,
        estimatedProceeds: shares * bestBidPrice,
        slippagePercent: 0,
      };
    }
  }, [orderBookData, shares, position?.currentPrice]);

  // Best bid from order book
  const bestBid = useMemo(() => {
    if (!orderBookData?.bids?.length) return undefined;
    const sortedBids = [...orderBookData.bids].sort(
      (a, b) => Number.parseFloat(b.price) - Number.parseFloat(a.price)
    );
    return Number.parseFloat(sortedBids[0].price);
  }, [orderBookData]);

  // Handle shares change with bounds
  const handleSharesChange = useCallback(
    (delta: number) => {
      const maxShares = position?.size ?? 0;
      setShares((prev) => Math.max(1, Math.min(maxShares, prev + delta)));
    },
    [position?.size]
  );

  // Set shares to max (full position)
  const setMaxShares = useCallback(() => {
    if (position?.size) {
      setShares(position.size);
    }
  }, [position?.size]);

  // Execute market sell order
  const executeSell = useCallback(async () => {
    if (!canTrade || !tokenId || shares <= 0) {
      const error = new Error("Cannot execute sell: missing requirements");
      onSellError?.(error);
      return { success: false, error };
    }

    setIsSubmitting(true);

    try {
      // Calculate sell price with buffer (slightly below best bid for guaranteed fill)
      const tickSize = 0.01;
      let sellPrice: number;

      if (sellEstimate.canFill && sellEstimate.worstPrice) {
        // Use worst price from slippage calculation with a small buffer
        const priceWithBuffer = sellEstimate.worstPrice * 0.995;
        sellPrice = Math.max(0.01, roundDownToTick(priceWithBuffer, tickSize));
      } else if (bestBid) {
        // Fallback to best bid with buffer
        const priceWithBuffer = bestBid * 0.995;
        sellPrice = Math.max(0.01, roundDownToTick(priceWithBuffer, tickSize));
      } else {
        // Last resort: use current price with buffer
        const priceWithBuffer = (position?.currentPrice ?? 0.5) * 0.995;
        sellPrice = Math.max(0.01, roundDownToTick(priceWithBuffer, tickSize));
      }

      // Determine if this is a neg risk market
      // We can check from the position's market data if available
      const negRisk = false; // Default to false, can be enhanced if position has this info

      const result = await createOrder({
        tokenId,
        price: sellPrice,
        size: shares,
        side: Side.SELL,
        orderType: ClobOrderType.FAK, // Fill And Kill for market sell
        negRisk,
      });

      if (result.success) {
        // Invalidate and refetch queries aggressively
        if (proxyAddress) {
          clearBalanceCache(proxyAddress);

          // Immediate invalidation - use exact: false to match all queries with this prefix
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: [PROXY_WALLET_QUERY_KEY],
              exact: false,
            }),
            queryClient.invalidateQueries({
              queryKey: ["usdcBalance"],
              exact: false,
            }),
            queryClient.invalidateQueries({
              queryKey: ["userPositions"],
              exact: false,
            }),
            queryClient.invalidateQueries({
              queryKey: ["openOrders"],
              exact: false,
            }),
          ]);

          // Immediate refetch - force fresh data
          await Promise.all([
            queryClient.refetchQueries({
              queryKey: [PROXY_WALLET_QUERY_KEY],
              exact: false,
            }),
            queryClient.refetchQueries({
              queryKey: ["usdcBalance"],
              exact: false,
            }),
          ]);

          // Multiple delayed refetches to catch backend updates
          // Polymarket's Data API can take 10-30 seconds to update positions
          const refetchAll = async () => {
            clearBalanceCache(proxyAddress);
            await Promise.all([
              queryClient.refetchQueries({
                queryKey: ["userPositions"],
                exact: false,
              }),
              queryClient.refetchQueries({
                queryKey: [PROXY_WALLET_QUERY_KEY],
                exact: false,
              }),
              queryClient.refetchQueries({
                queryKey: ["usdcBalance"],
                exact: false,
              }),
            ]);
          };

          // More aggressive refetch schedule: 1s, 3s, 5s, 10s, 15s, 20s, 30s
          // Polymarket's backend can be slow to update
          setTimeout(refetchAll, 1000);
          setTimeout(refetchAll, 3000);
          setTimeout(refetchAll, 5000);
          setTimeout(refetchAll, 10000);
          setTimeout(refetchAll, 15000);
          setTimeout(refetchAll, 20000);
          setTimeout(refetchAll, 30000);
        }
        onSellSuccess?.();
        return { success: true, order: result.order };
      }

      throw new Error("Sell order failed");
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Sell order failed");
      onSellError?.(error);
      return { success: false, error };
    } finally {
      setIsSubmitting(false);
    }
  }, [
    canTrade,
    tokenId,
    shares,
    sellEstimate,
    bestBid,
    position?.currentPrice,
    createOrder,
    proxyAddress,
    queryClient,
    onSellSuccess,
    onSellError,
  ]);

  // Reset shares when position changes
  const resetShares = useCallback(() => {
    setShares(position?.size ?? 0);
  }, [position?.size]);

  return {
    // State
    shares,
    setShares,
    isLoading: isClobLoading || isLoadingOrderBook,
    isSubmitting,
    error: clobError,
    canTrade,

    // Estimates
    sellEstimate,
    bestBid,

    // Actions
    handleSharesChange,
    setMaxShares,
    executeSell,
    resetShares,
  };
}
