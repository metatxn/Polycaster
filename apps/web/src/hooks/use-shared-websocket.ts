"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOrderBookStore } from "@/hooks/use-orderbook-store";
import { filterValidTokenIds } from "@/lib/token-validation";
import { getWebSocketManager } from "@/lib/websocket-manager";
import type {
  BookEvent,
  ConnectionState,
  LastTradePriceEvent,
  PriceChangeEvent,
  TickSizeChangeEvent,
  WebSocketEvent,
} from "@/types/websocket";

export type {
  BookEvent,
  ConnectionState,
  LastTradePriceEvent,
  PriceChangeEvent,
  TickSizeChangeEvent,
};

/**
 * Options for useSharedWebSocket hook
 */
export interface UseSharedWebSocketOptions {
  /** Asset IDs to subscribe to */
  assetIds: string[];
  /** Callback for book events */
  onBook?: (event: BookEvent) => void;
  /** Callback for price change events */
  onPriceChange?: (event: PriceChangeEvent) => void;
  /** Callback for last trade price events */
  onLastTradePrice?: (event: LastTradePriceEvent) => void;
  /** Callback for tick size change events */
  onTickSizeChange?: (event: TickSizeChangeEvent) => void;
}

/**
 * Hook that uses the singleton WebSocket manager
 *
 * Unlike useMarketWebSocket, this hook:
 * - Does NOT create its own WebSocket connection
 * - Uses a shared singleton connection
 * - Reference-counted subscriptions (auto cleanup)
 * - Much more memory/CPU efficient
 */
export function useSharedWebSocket(options: UseSharedWebSocketOptions) {
  const {
    assetIds,
    onBook,
    onPriceChange,
    onLastTradePrice,
    onTickSizeChange,
  } = options;

  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const callbacksRef = useRef({
    onBook,
    onPriceChange,
    onLastTradePrice,
    onTickSizeChange,
  });

  // Keep callbacks up to date
  useEffect(() => {
    callbacksRef.current = {
      onBook,
      onPriceChange,
      onLastTradePrice,
      onTickSizeChange,
    };
  }, [onBook, onPriceChange, onLastTradePrice, onTickSizeChange]);

  // Subscribe to connection state changes
  useEffect(() => {
    const manager = getWebSocketManager();

    const unsubscribe = manager.addConnectionListener((state) => {
      setConnectionState(state);
    });

    return unsubscribe;
  }, []);

  // Stabilize assetIds: only re-subscribe when the actual IDs change,
  // not when the parent passes a new array reference with the same items.
  const stableAssetKey = useMemo(
    () => filterValidTokenIds(assetIds).sort().join(","),
    [assetIds]
  );

  // Subscribe to events and filter by our asset IDs
  useEffect(() => {
    const manager = getWebSocketManager();
    const validIds = stableAssetKey ? stableAssetKey.split(",") : [];
    const assetIdSet = new Set(validIds);

    if (assetIdSet.size === 0) return;

    const handleEvent = (event: WebSocketEvent) => {
      const { onBook, onPriceChange, onLastTradePrice, onTickSizeChange } =
        callbacksRef.current;

      switch (event.event_type) {
        case "book":
          if (assetIdSet.has(event.asset_id)) {
            onBook?.(event);
          }
          break;
        case "price_change": {
          // Price change can affect multiple assets
          const relevantChanges = event.price_changes.filter((c) =>
            assetIdSet.has(c.asset_id)
          );
          if (relevantChanges.length > 0) {
            onPriceChange?.({ ...event, price_changes: relevantChanges });
          }
          break;
        }
        case "last_trade_price":
          if (assetIdSet.has(event.asset_id)) {
            onLastTradePrice?.(event);
          }
          break;
        case "tick_size_change":
          if (assetIdSet.has(event.asset_id)) {
            onTickSizeChange?.(event);
          }
          break;
      }
    };

    // Add event listener
    const removeEventListener = manager.addEventListener(handleEvent);

    // Subscribe to assets
    const unsubscribe = manager.subscribe(Array.from(assetIdSet));

    return () => {
      removeEventListener();
      unsubscribe();
    };
  }, [stableAssetKey]);

  return {
    connectionState,
    isConnected: connectionState === "connected",
    reconnect: useCallback(() => {
      getWebSocketManager().reconnect();
    }, []),
  };
}

/**
 * Hook that connects to WebSocket and automatically updates the order book store
 * This is the recommended way to use WebSocket for order books
 */
export function useOrderBookWebSocket(assetIds: string[]) {
  // Select only the action functions we need. Actions are stable references in
  // Zustand so these selectors won't cause re-renders when order book data changes.
  const handleBookEvent = useOrderBookStore((s) => s.handleBookEvent);
  const handlePriceChangeEvent = useOrderBookStore(
    (s) => s.handlePriceChangeEvent
  );
  const handleLastTradePriceEvent = useOrderBookStore(
    (s) => s.handleLastTradePriceEvent
  );
  const clearOrderBook = useOrderBookStore((s) => s.clearOrderBook);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { connectionState, isConnected, reconnect } = useSharedWebSocket({
    assetIds,
    onBook: handleBookEvent,
    onPriceChange: handlePriceChangeEvent,
    onLastTradePrice: handleLastTradePriceEvent,
  });

  // Stabilize the asset list for cleanup (same pattern as useSharedWebSocket)
  const stableCleanupKey = useMemo(
    () => filterValidTokenIds(assetIds).sort().join(","),
    [assetIds]
  );

  // Clean up order book data when this component unmounts or asset list changes.
  // Only clears assets that are no longer subscribed by any other component
  // (checked via the WebSocket manager's reference-counted subscriptions).
  //
  // Deferred via setTimeout so the check runs after React has executed the new
  // subscription effect. Without deferral, the synchronous cleanup sees the gap
  // between the old unsubscribe and the new subscribe, incorrectly treating
  // overlapping assets as unsubscribed.
  useEffect(() => {
    const previousIds = stableCleanupKey ? stableCleanupKey.split(",") : [];

    return () => {
      if (cleanupTimerRef.current !== null) {
        clearTimeout(cleanupTimerRef.current);
      }
      cleanupTimerRef.current = setTimeout(() => {
        cleanupTimerRef.current = null;
        const manager = getWebSocketManager();
        const stillSubscribed = new Set(manager.getSubscribedAssets());

        for (const assetId of previousIds) {
          if (!stillSubscribed.has(assetId)) {
            clearOrderBook(assetId);
          }
        }
      }, 0);
    };
  }, [stableCleanupKey, clearOrderBook]);

  return { connectionState, isConnected, reconnect };
}
