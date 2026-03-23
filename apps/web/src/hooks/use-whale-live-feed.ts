"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filterValidTokenIds } from "@/lib/token-validation";
import { getWebSocketManager } from "@/lib/websocket-manager";
import type { ConnectionState, WebSocketEvent } from "@/types/websocket";

/**
 * Live Whale Feed via the singleton WebSocket Manager
 *
 * Piggybacks on the shared Polymarket market channel connection
 * (ref-counted subscriptions, heartbeat, reconnect with max-attempt cap)
 * and surfaces `last_trade_price` events above a configurable size threshold.
 */

export interface LiveTrade {
  id: string;
  assetId: string;
  market: string;
  price: number;
  size: number;
  side: "BUY" | "SELL";
  timestamp: string;
  usdcAmount: number;
}

interface UseWhaleLiveFeedOptions {
  /** Minimum trade size (USDC) to surface in the live feed */
  minTradeSize?: number;
  /** Maximum live trades to keep in buffer */
  maxBufferSize?: number;
  /** Whether the feed is active */
  enabled?: boolean;
  /** Token IDs to subscribe to (e.g. from hot markets) */
  assetIds?: string[];
}

export function useWhaleLiveFeed(options: UseWhaleLiveFeedOptions = {}) {
  const {
    minTradeSize = 500,
    maxBufferSize = 50,
    enabled = true,
    assetIds = [],
  } = options;

  const [liveTrades, setLiveTrades] = useState<LiveTrade[]>([]);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [tradeCount, setTradeCount] = useState(0);

  const minTradeSizeRef = useRef(minTradeSize);
  const maxBufferSizeRef = useRef(maxBufferSize);
  minTradeSizeRef.current = minTradeSize;
  maxBufferSizeRef.current = maxBufferSize;

  // Stabilize the asset ID list so we only re-subscribe when content changes
  const stableAssetKey = useMemo(
    () => filterValidTokenIds(assetIds).sort().join(","),
    [assetIds]
  );

  // Subscribe to connection state
  useEffect(() => {
    const manager = getWebSocketManager();
    const unsubscribe = manager.addConnectionListener((state) => {
      setConnectionState(state);
    });
    return unsubscribe;
  }, []);

  // Subscribe to assets and listen for large trades
  useEffect(() => {
    if (!enabled || !stableAssetKey) return;

    const manager = getWebSocketManager();
    const validIds = stableAssetKey.split(",");
    const assetIdSet = new Set(validIds);

    const handleEvent = (event: WebSocketEvent) => {
      if (event.event_type !== "last_trade_price") return;
      if (!assetIdSet.has(event.asset_id)) return;

      const price = Number.parseFloat(event.price);
      const size = Number.parseFloat(event.size);
      if (
        !Number.isFinite(price) ||
        !Number.isFinite(size) ||
        price <= 0 ||
        size <= 0
      )
        return;
      const usdcAmount = price * size;
      if (!Number.isFinite(usdcAmount)) return;

      if (usdcAmount < minTradeSizeRef.current) return;

      const raw = event.timestamp;
      let isoTimestamp = raw;
      if (raw && raw !== "") {
        const numericTs = Number(raw);
        if (Number.isFinite(numericTs) && numericTs > 0) {
          const ms = numericTs > 1e12 ? numericTs : numericTs * 1000;
          const d = new Date(ms);
          if (Number.isFinite(d.getTime())) {
            isoTimestamp = d.toISOString();
          }
        }
      }

      const trade: LiveTrade = {
        id: `live-${event.asset_id}-${event.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        assetId: event.asset_id,
        market: event.market,
        price,
        size,
        side: event.side,
        timestamp: isoTimestamp,
        usdcAmount,
      };

      setLiveTrades((prev) =>
        [trade, ...prev].slice(0, maxBufferSizeRef.current)
      );
      setTradeCount((c) => c + 1);
    };

    const removeEventListener = manager.addEventListener(handleEvent);
    const unsubscribe = manager.subscribe(validIds);

    return () => {
      removeEventListener();
      unsubscribe();
    };
  }, [enabled, stableAssetKey]);

  const clearFeed = useCallback(() => {
    setLiveTrades([]);
    setTradeCount(0);
  }, []);

  const reconnect = useCallback(() => {
    getWebSocketManager().reconnect();
  }, []);

  return {
    liveTrades,
    tradeCount,
    connectionState,
    isConnected: connectionState === "connected",
    clearFeed,
    reconnect,
  };
}
