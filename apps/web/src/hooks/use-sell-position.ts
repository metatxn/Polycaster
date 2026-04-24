"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { useCallback, useMemo, useState } from "react";
import type { Position } from "@/components/portfolio/types";
import { CLOB_BASE_URL } from "@/constants/polymarket";
import {
  OrderType as ClobOrderType,
  Side,
  useClobClient,
} from "@/hooks/use-clob-client";
import {
  useOrderBook as useOrderBookFromStore,
  useOrderBookStore,
} from "@/hooks/use-orderbook-store";
import {
  PROXY_WALLET_QUERY_KEY,
  useProxyWallet,
} from "@/hooks/use-proxy-wallet";
import { useOrderBookWebSocket } from "@/hooks/use-shared-websocket";
import { clearBalanceCache } from "@/lib/rpc";
import { calculateSlippage, roundDownToTick } from "@/lib/slippage";

const CLOB_HOST = CLOB_BASE_URL;

interface OrderBookData {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

interface SellResult {
  shares: number;
  estimatedProceeds: number;
  estimatedPrice: number;
}

interface UseSellPositionOptions {
  position: Position | null;
  onSellSuccess?: (result: SellResult) => void;
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

  const tokenId = useMemo(() => {
    if (!position) return "";
    return position.asset || "";
  }, [position]);

  // Subscribe to the WebSocket orderbook for this token while the modal is
  // open, and read book state from the shared store. Previously this hook
  // owned its own REST-only snapshot refreshing every 5s, which disagreed
  // with the market page's trading panel (WebSocket-backed). Sharing the
  // store means both UIs show identical live depth, so a sell that the
  // trading panel says is fillable will also be fillable here.
  const wsAssetIds = useMemo(() => (tokenId ? [tokenId] : []), [tokenId]);
  useOrderBookWebSocket(wsAssetIds);

  const setOrderBookFromRest = useOrderBookStore((s) => s.setOrderBookFromRest);

  // REST bootstrap: seeds the store before the first WebSocket snapshot
  // arrives so the modal has data to render immediately on open. Once the
  // WebSocket delivers the first `book` event, live updates take over.
  const { isLoading: isLoadingOrderBook } = useQuery<OrderBookData | null>({
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
      const bids = Array.isArray(data?.bids) ? data.bids : [];
      const asks = Array.isArray(data?.asks) ? data.asks : [];
      setOrderBookFromRest(tokenId, bids, asks);
      return { bids, asks };
    },
    enabled: !!tokenId,
    staleTime: 30_000,
  });

  const storeOrderBook = useOrderBookFromStore(tokenId);

  const orderBookData = useMemo<OrderBookData | null>(() => {
    if (!storeOrderBook) return null;
    return {
      bids: storeOrderBook.bids,
      asks: storeOrderBook.asks,
    };
  }, [storeOrderBook]);

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

      const bestBid = orderBookData.bids?.[0];
      const bestBidPrice = bestBid
        ? new Decimal(bestBid.price)
        : new Decimal(0);
      const estimatedProceeds = bestBidPrice.mul(shares);
      return {
        canFill: false,
        estimatedPrice: bestBidPrice.toNumber(),
        estimatedProceeds: estimatedProceeds.toNumber(),
        slippagePercent: 0,
      };
    } catch {
      const bestBid = orderBookData.bids?.[0];
      const bestBidPrice = bestBid
        ? new Decimal(bestBid.price)
        : new Decimal(0);
      const estimatedProceeds = bestBidPrice.mul(shares);
      return {
        canFill: false,
        estimatedPrice: bestBidPrice.toNumber(),
        estimatedProceeds: estimatedProceeds.toNumber(),
        slippagePercent: 0,
      };
    }
  }, [orderBookData, shares, position?.currentPrice]);

  const bestBid = useMemo(() => {
    const bids = orderBookData?.bids ?? [];
    if (!bids.length) return undefined;
    const sortedBids = [...bids].sort(
      (a, b) => Number.parseFloat(b.price) - Number.parseFloat(a.price)
    );
    return Number.parseFloat(sortedBids[0].price);
  }, [orderBookData]);

  const handleSharesChange = useCallback(
    (delta: number) => {
      const maxShares = position?.size ?? 0;
      setShares((prev) => Math.max(1, Math.min(maxShares, prev + delta)));
    },
    [position?.size]
  );

  const setMaxShares = useCallback(() => {
    if (position?.size) {
      setShares(position.size);
    }
  }, [position?.size]);

  const executeSell = useCallback(async () => {
    if (!canTrade || !tokenId || shares <= 0) {
      const error = new Error("Cannot execute sell: missing requirements");
      onSellError?.(error);
      return { success: false, error };
    }

    setIsSubmitting(true);

    try {
      const tickSize = 0.01;
      const buffer = new Decimal("0.995");
      let sellPrice: number;

      if (sellEstimate.canFill && sellEstimate.worstPrice) {
        const buffered = new Decimal(sellEstimate.worstPrice).mul(buffer);
        sellPrice = Math.max(
          0.01,
          roundDownToTick(buffered.toNumber(), tickSize)
        );
      } else if (bestBid) {
        const buffered = new Decimal(bestBid).mul(buffer);
        sellPrice = Math.max(
          0.01,
          roundDownToTick(buffered.toNumber(), tickSize)
        );
      } else {
        const buffered = new Decimal(position?.currentPrice ?? 0.5).mul(buffer);
        sellPrice = Math.max(
          0.01,
          roundDownToTick(buffered.toNumber(), tickSize)
        );
      }

      // Multi-outcome markets use the Neg Risk CTF Exchange contract, so the
      // signed order's verifying contract must match. Pull the flag from the
      // position (surfaced by /api/user/positions) — hardcoding `false` here
      // caused neg-risk Quick Sells to be signed against the wrong exchange
      // and rejected server-side. See docs.polymarket.com/trading/orders
      // /overview#negative-risk.
      const negRisk = position?.negRisk ?? false;

      const result = await createOrder({
        tokenId,
        price: sellPrice,
        size: shares,
        side: Side.SELL,
        orderType: ClobOrderType.FAK,
        negRisk,
      });

      if (result.success) {
        if (proxyAddress) {
          clearBalanceCache(proxyAddress);

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

          setTimeout(refetchAll, 1000);
          setTimeout(refetchAll, 3000);
          setTimeout(refetchAll, 5000);
          setTimeout(refetchAll, 10000);
          setTimeout(refetchAll, 15000);
          setTimeout(refetchAll, 20000);
          setTimeout(refetchAll, 30000);
        }
        onSellSuccess?.({
          shares,
          estimatedProceeds: sellEstimate.estimatedProceeds,
          estimatedPrice: sellEstimate.estimatedPrice,
        });
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
    position?.negRisk,
    createOrder,
    proxyAddress,
    queryClient,
    onSellSuccess,
    onSellError,
  ]);

  const resetShares = useCallback(() => {
    setShares(position?.size ?? 0);
  }, [position?.size]);

  return {
    shares,
    setShares,
    isLoading: isClobLoading || isLoadingOrderBook,
    isSubmitting,
    error: clobError,
    canTrade,

    sellEstimate,
    bestBid,

    handleSharesChange,
    setMaxShares,
    executeSell,
    resetShares,
  };
}
