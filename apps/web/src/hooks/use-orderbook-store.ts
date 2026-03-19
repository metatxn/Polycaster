"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import type { OrderBookLevel } from "@/types/market";
import type {
  BookEvent,
  LastTradePriceEvent,
  PriceChangeEvent,
} from "@/types/websocket";

/**
 * Stale data threshold in milliseconds (60 seconds)
 */
const STALE_THRESHOLD_MS = 60000;

/**
 * Price history configuration
 */
const PRICE_HISTORY_MAX_AGE_MS = 120000; // Keep 2 minutes of history
const PRICE_HISTORY_MAX_ENTRIES = 500; // Cap entries to prevent memory bloat
const ANOMALY_THRESHOLD_5S = 0.05; // 5% change in 5 seconds = anomaly
const ANOMALY_THRESHOLD_1S = 0.1; // 10% change in 1 second = anomaly

/**
 * Processed order book data with computed values
 */
export interface ProcessedOrderBook {
  /** Asset/token ID */
  assetId: string;
  /** Market condition ID */
  market: string;
  /** Bid levels (sorted descending by price) */
  bids: OrderBookLevel[];
  /** Ask levels (sorted ascending by price) */
  asks: OrderBookLevel[];
  /** Best bid price */
  bestBid: number | null;
  /** Best ask price */
  bestAsk: number | null;
  /** Spread (best ask - best bid) */
  spread: number | null;
  /** Midpoint price */
  midpoint: number | null;
  /** Total bid size */
  totalBidSize: number;
  /** Total ask size */
  totalAskSize: number;
  /** Last update timestamp */
  timestamp: string;
  /** Hash for change detection */
  hash: string;
  /** Data source (websocket or rest) */
  source: "websocket" | "rest";
  /** When the data was received locally (for staleness detection) */
  receivedAt: number;
}

/**
 * Last trade information
 */
export interface LastTrade {
  assetId: string;
  price: number;
  size: number;
  side: "BUY" | "SELL";
  timestamp: string;
}

/**
 * Pending price change for assets that haven't received initial snapshot
 */
interface PendingChange {
  event: PriceChangeEvent;
  receivedAt: number;
}

/**
 * A single price history entry for tracking price over time
 */
export interface PriceHistoryEntry {
  bestBid: number;
  bestAsk: number;
  midpoint: number;
  timestamp: number; // Unix ms
}

/**
 * Price velocity metrics calculated from history
 * Used for detecting sudden price movements (dips/spikes)
 */
export interface PriceVelocity {
  /** Price change in last 1 second (percentage, e.g., -0.05 = -5%) */
  change1s: number;
  /** Price change in last 5 seconds (percentage) */
  change5s: number;
  /** Price change in last 30 seconds (percentage) */
  change30s: number;
  /** Price change in last 60 seconds (percentage) */
  change60s: number;
  /** Is this an unusual/anomalous movement? */
  isAnomaly: boolean;
  /** Direction of movement */
  direction: "UP" | "DOWN" | "STABLE";
  /** Timestamp of last calculation */
  calculatedAt: number;
}

/**
 * Order book store state
 */
interface OrderBookStoreState {
  /** Order books indexed by asset ID */
  orderBooks: Map<string, ProcessedOrderBook>;
  /** Last trades indexed by asset ID */
  lastTrades: Map<string, LastTrade>;
  /** Pending price changes for assets without initial snapshot */
  pendingChanges: Map<string, PendingChange[]>;
  /** Price history for each asset (sliding window) */
  priceHistory: Map<string, PriceHistoryEntry[]>;
  /** Calculated price velocity for each asset */
  priceVelocity: Map<string, PriceVelocity>;
  /** Connection status */
  isConnected: boolean;
  /** Last error */
  lastError: Error | null;

  // Actions
  /** Process a full order book snapshot */
  handleBookEvent: (event: BookEvent) => void;
  /** Process incremental price changes */
  handlePriceChangeEvent: (event: PriceChangeEvent) => void;
  /** Process last trade price event */
  handleLastTradePriceEvent: (event: LastTradePriceEvent) => void;
  /** Set order book from REST API fallback */
  setOrderBookFromRest: (
    assetId: string,
    bids: OrderBookLevel[],
    asks: OrderBookLevel[]
  ) => void;
  /** Clear order book for an asset */
  clearOrderBook: (assetId: string) => void;
  /** Clear all order books */
  clearAllOrderBooks: () => void;
  /** Set connection status */
  setConnected: (connected: boolean) => void;
  /** Set last error */
  setError: (error: Error | null) => void;

  // Selectors
  /** Get order book for a specific asset */
  getOrderBook: (assetId: string) => ProcessedOrderBook | undefined;
  /** Get best bid for a specific asset */
  getBestBid: (assetId: string) => number | null;
  /** Get best ask for a specific asset */
  getBestAsk: (assetId: string) => number | null;
  /** Get spread for a specific asset */
  getSpread: (assetId: string) => number | null;
  /** Get last trade for a specific asset */
  getLastTrade: (assetId: string) => LastTrade | undefined;
  /** Check if order book data is stale */
  isStale: (assetId: string) => boolean;
  /** Get price velocity for a specific asset */
  getVelocity: (assetId: string) => PriceVelocity | undefined;
  /** Get price at a specific timestamp (interpolated if needed) */
  getPriceAt: (assetId: string, timestampMs: number) => number | null;
}

/**
 * Binary search to find insertion index for a price level
 * Returns the index where the new level should be inserted to maintain sort order
 */
function binarySearchInsertIndex(
  levels: OrderBookLevel[],
  price: number,
  ascending: boolean
): number {
  let left = 0;
  let right = levels.length;

  while (left < right) {
    const mid = (left + right) >>> 1;
    const midPrice = Number.parseFloat(levels[mid].price);

    if (ascending ? midPrice < price : midPrice > price) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

/**
 * Insert a level into a sorted array using binary search
 * More efficient than full re-sort for incremental updates (O(n) vs O(n log n))
 */
function insertLevelSorted(
  levels: OrderBookLevel[],
  newLevel: OrderBookLevel,
  ascending: boolean
): OrderBookLevel[] {
  const price = Number.parseFloat(newLevel.price);
  const insertIndex = binarySearchInsertIndex(levels, price, ascending);

  const result = [...levels];
  result.splice(insertIndex, 0, newLevel);
  return result;
}

/**
 * Process raw order book levels into sorted arrays with computed values
 */
function processOrderBook(
  assetId: string,
  market: string,
  rawBids: OrderBookLevel[],
  rawAsks: OrderBookLevel[],
  timestamp: string,
  hash: string,
  source: "websocket" | "rest"
): ProcessedOrderBook {
  // Sort bids descending by price
  const bids = [...rawBids].sort(
    (a, b) => Number.parseFloat(b.price) - Number.parseFloat(a.price)
  );

  // Sort asks ascending by price
  const asks = [...rawAsks].sort(
    (a, b) => Number.parseFloat(a.price) - Number.parseFloat(b.price)
  );

  // Calculate best prices
  const bestBid = bids.length > 0 ? Number.parseFloat(bids[0].price) : null;
  const bestAsk = asks.length > 0 ? Number.parseFloat(asks[0].price) : null;

  // Calculate spread and midpoint
  const spread =
    bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  const midpoint =
    bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;

  // Calculate total sizes
  const totalBidSize = bids.reduce(
    (sum, level) => sum + Number.parseFloat(level.size),
    0
  );
  const totalAskSize = asks.reduce(
    (sum, level) => sum + Number.parseFloat(level.size),
    0
  );

  return {
    assetId,
    market,
    bids,
    asks,
    bestBid,
    bestAsk,
    spread,
    midpoint,
    totalBidSize,
    totalAskSize,
    timestamp,
    hash,
    source,
    receivedAt: Date.now(),
  };
}

/**
 * Apply incremental price change to an order book
 * Uses binary insertion for new levels (O(n) instead of O(n log n) for full re-sort)
 */
function applyPriceChange(
  orderBook: ProcessedOrderBook,
  price: string,
  size: string,
  side: "BUY" | "SELL",
  bestBid: string,
  bestAsk: string,
  timestamp: string
): ProcessedOrderBook {
  let levels = side === "BUY" ? [...orderBook.bids] : [...orderBook.asks];
  const ascending = side === "SELL"; // asks are ascending, bids are descending

  // Find existing level using binary search for better performance
  const existingIndex = levels.findIndex((l) => l.price === price);
  const sizeNum = Number.parseFloat(size);

  if (sizeNum === 0) {
    // Remove level if size is 0
    if (existingIndex !== -1) {
      levels.splice(existingIndex, 1);
    }
  } else if (existingIndex !== -1) {
    // Update existing level (no re-sort needed, price hasn't changed)
    levels[existingIndex] = { price, size };
  } else {
    // Add new level using binary insertion (more efficient than push + sort)
    levels = insertLevelSorted(levels, { price, size }, ascending);
  }

  // Update the order book
  const newBids = side === "BUY" ? levels : orderBook.bids;
  const newAsks = side === "SELL" ? levels : orderBook.asks;

  const newBestBid = Number.parseFloat(bestBid);
  const newBestAsk = Number.parseFloat(bestAsk);
  const newSpread = newBestAsk - newBestBid;
  const newMidpoint = (newBestBid + newBestAsk) / 2;

  return {
    ...orderBook,
    bids: newBids,
    asks: newAsks,
    bestBid: newBestBid,
    bestAsk: newBestAsk,
    spread: newSpread,
    midpoint: newMidpoint,
    totalBidSize: newBids.reduce(
      (sum, l) => sum + Number.parseFloat(l.size),
      0
    ),
    totalAskSize: newAsks.reduce(
      (sum, l) => sum + Number.parseFloat(l.size),
      0
    ),
    timestamp,
    source: "websocket",
    receivedAt: Date.now(),
  };
}

/**
 * Apply any pending price changes to a newly received order book
 */
function applyPendingChanges(
  orderBook: ProcessedOrderBook,
  pendingChanges: PendingChange[]
): ProcessedOrderBook {
  let result = orderBook;

  // Sort pending changes by received time to apply in order
  const sortedChanges = [...pendingChanges].sort(
    (a, b) => a.receivedAt - b.receivedAt
  );

  for (const pending of sortedChanges) {
    for (const change of pending.event.price_changes) {
      if (change.asset_id === orderBook.assetId) {
        result = applyPriceChange(
          result,
          change.price,
          change.size,
          change.side,
          change.best_bid,
          change.best_ask,
          pending.event.timestamp
        );
      }
    }
  }

  return result;
}

// ============================================
// Price History Helper Functions
// ============================================

/**
 * Add a price entry to history and trim old entries
 */
function addPriceHistory(
  history: PriceHistoryEntry[],
  entry: PriceHistoryEntry
): PriceHistoryEntry[] {
  const now = Date.now();
  const cutoff = now - PRICE_HISTORY_MAX_AGE_MS;

  // Add new entry and filter old ones
  const updated = [...history, entry].filter((h) => h.timestamp > cutoff);

  // Cap the array size
  if (updated.length > PRICE_HISTORY_MAX_ENTRIES) {
    return updated.slice(-PRICE_HISTORY_MAX_ENTRIES);
  }

  return updated;
}

/**
 * Get price at a specific timestamp using linear interpolation
 * Note: Assumes history is sorted by timestamp ascending for correct interpolation
 */
function getPriceAtTimestamp(
  history: PriceHistoryEntry[],
  targetTs: number
): number | null {
  if (history.length === 0) return null;

  // Ensure history is sorted by timestamp ascending (handles out-of-order events)
  const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);

  // Find the two entries that bracket the target timestamp
  let before: PriceHistoryEntry | null = null;
  let after: PriceHistoryEntry | null = null;

  for (const entry of sortedHistory) {
    if (entry.timestamp <= targetTs) {
      before = entry;
    } else if (!after) {
      after = entry;
      break;
    }
  }

  // If we only have one side, return that
  if (!before && after) return after.midpoint;
  if (before && !after) return before.midpoint;
  if (!before || !after) return null;

  // If timestamps are the same, return the price directly
  if (before.timestamp === after.timestamp) return before.midpoint;

  // Linear interpolation between the two points
  const ratio =
    (targetTs - before.timestamp) / (after.timestamp - before.timestamp);
  return before.midpoint + ratio * (after.midpoint - before.midpoint);
}

/**
 * Calculate the price change over a specific time window
 */
function calculatePriceChange(
  history: PriceHistoryEntry[],
  windowMs: number
): number {
  if (history.length === 0) return 0;

  const now = Date.now();
  const currentPrice = history[history.length - 1]?.midpoint ?? 0;
  const pastPrice = getPriceAtTimestamp(history, now - windowMs);

  if (!pastPrice || pastPrice === 0) return 0;
  return (currentPrice - pastPrice) / pastPrice;
}

/**
 * Calculate price velocity metrics from history
 */
function calculateVelocity(history: PriceHistoryEntry[]): PriceVelocity {
  const now = Date.now();

  const change1s = calculatePriceChange(history, 1000);
  const change5s = calculatePriceChange(history, 5000);
  const change30s = calculatePriceChange(history, 30000);
  const change60s = calculatePriceChange(history, 60000);

  // Detect anomaly: significant change in short window
  const isAnomaly =
    Math.abs(change5s) > ANOMALY_THRESHOLD_5S ||
    Math.abs(change1s) > ANOMALY_THRESHOLD_1S;

  // Determine direction based on 5-second change
  let direction: "UP" | "DOWN" | "STABLE" = "STABLE";
  if (change5s > 0.01) direction = "UP";
  else if (change5s < -0.01) direction = "DOWN";

  return {
    change1s,
    change5s,
    change30s,
    change60s,
    isAnomaly,
    direction,
    calculatedAt: now,
  };
}

/**
 * Zustand store for order book state management
 *
 * Features:
 * - Stores order books for multiple assets
 * - Handles full snapshots and incremental updates
 * - Provides computed values (spread, midpoint, totals)
 * - Tracks last trades
 * - Supports REST API fallback
 * - Queues incremental updates that arrive before initial snapshot
 * - Detects stale data
 */
export const useOrderBookStore = create<OrderBookStoreState>()(
  subscribeWithSelector((set, get) => ({
    orderBooks: new Map<string, ProcessedOrderBook>(),
    lastTrades: new Map<string, LastTrade>(),
    pendingChanges: new Map<string, PendingChange[]>(),
    priceHistory: new Map<string, PriceHistoryEntry[]>(),
    priceVelocity: new Map<string, PriceVelocity>(),
    isConnected: false,
    lastError: null,

    handleBookEvent: (event: BookEvent) => {
      set((state) => {
        let processed = processOrderBook(
          event.asset_id,
          event.market,
          event.bids,
          event.asks,
          event.timestamp,
          event.hash,
          "websocket"
        );

        // Apply any pending changes that arrived before this snapshot
        const pending = state.pendingChanges.get(event.asset_id);
        const hasPending = pending && pending.length > 0;
        if (hasPending) {
          processed = applyPendingChanges(processed, pending);
        }

        // Only copy the orderBooks map (always changes for book events)
        const newOrderBooks = new Map(state.orderBooks);
        newOrderBooks.set(event.asset_id, processed);

        // Only copy pendingChanges if we actually had pending items to clear
        const newPendingChanges = hasPending
          ? (() => {
              const m = new Map(state.pendingChanges);
              m.delete(event.asset_id);
              return m;
            })()
          : state.pendingChanges;

        // Only copy price history/velocity maps if midpoint exists
        const result: Partial<OrderBookStoreState> = {
          orderBooks: newOrderBooks,
          pendingChanges: newPendingChanges,
        };

        if (processed.midpoint !== null) {
          const history = state.priceHistory.get(event.asset_id) || [];
          const newEntry: PriceHistoryEntry = {
            bestBid: processed.bestBid ?? 0,
            bestAsk: processed.bestAsk ?? 0,
            midpoint: processed.midpoint,
            timestamp: Date.now(),
          };
          const updatedHistory = addPriceHistory(history, newEntry);

          const newPriceHistory = new Map(state.priceHistory);
          newPriceHistory.set(event.asset_id, updatedHistory);
          result.priceHistory = newPriceHistory;

          const newPriceVelocity = new Map(state.priceVelocity);
          newPriceVelocity.set(
            event.asset_id,
            calculateVelocity(updatedHistory)
          );
          result.priceVelocity = newPriceVelocity;
        }

        return result;
      });
    },

    handlePriceChangeEvent: (event: PriceChangeEvent) => {
      set((state) => {
        // Track which maps actually need to change to avoid unnecessary copies
        let newOrderBooks: Map<string, ProcessedOrderBook> | null = null;
        let newPendingChanges: Map<string, PendingChange[]> | null = null;
        let newPriceHistory: Map<string, PriceHistoryEntry[]> | null = null;
        let newPriceVelocity: Map<string, PriceVelocity> | null = null;

        for (const change of event.price_changes) {
          const existing = (newOrderBooks ?? state.orderBooks).get(
            change.asset_id
          );
          if (existing) {
            // Lazily copy orderBooks map on first mutation
            if (!newOrderBooks) newOrderBooks = new Map(state.orderBooks);

            const updated = applyPriceChange(
              existing,
              change.price,
              change.size,
              change.side,
              change.best_bid,
              change.best_ask,
              event.timestamp
            );
            newOrderBooks.set(change.asset_id, updated);

            // Track price history for signal detection
            if (updated.midpoint !== null) {
              if (!newPriceHistory)
                newPriceHistory = new Map(state.priceHistory);
              if (!newPriceVelocity)
                newPriceVelocity = new Map(state.priceVelocity);

              const history =
                newPriceHistory.get(change.asset_id) ||
                state.priceHistory.get(change.asset_id) ||
                [];
              const newEntry: PriceHistoryEntry = {
                bestBid: updated.bestBid ?? 0,
                bestAsk: updated.bestAsk ?? 0,
                midpoint: updated.midpoint,
                timestamp: Date.now(),
              };
              const updatedHistory = addPriceHistory(history, newEntry);
              newPriceHistory.set(change.asset_id, updatedHistory);

              const velocity = calculateVelocity(updatedHistory);
              newPriceVelocity.set(change.asset_id, velocity);
            }
          } else {
            // Queue for later if we don't have the initial snapshot yet
            const pendingSource = newPendingChanges ?? state.pendingChanges;
            const pending = pendingSource.get(change.asset_id) || [];
            if (pending.length < 100) {
              if (!newPendingChanges)
                newPendingChanges = new Map(state.pendingChanges);

              // Create a new array instead of mutating in place - the shallow
              // Map copy may still share inner arrays with previous state.
              const nextPending = [
                ...pending,
                {
                  event: {
                    ...event,
                    price_changes: [change],
                  },
                  receivedAt: Date.now(),
                },
              ];
              newPendingChanges.set(change.asset_id, nextPending);
            }
          }
        }

        // Only return maps that actually changed
        const result: Partial<OrderBookStoreState> = {};
        if (newOrderBooks) result.orderBooks = newOrderBooks;
        if (newPendingChanges) result.pendingChanges = newPendingChanges;
        if (newPriceHistory) result.priceHistory = newPriceHistory;
        if (newPriceVelocity) result.priceVelocity = newPriceVelocity;

        return result;
      });
    },

    handleLastTradePriceEvent: (event: LastTradePriceEvent) => {
      const lastTrade: LastTrade = {
        assetId: event.asset_id,
        price: Number.parseFloat(event.price),
        size: Number.parseFloat(event.size),
        side: event.side,
        timestamp: event.timestamp,
      };

      set((state) => {
        const newLastTrades = new Map(state.lastTrades);
        newLastTrades.set(event.asset_id, lastTrade);
        return { lastTrades: newLastTrades };
      });
    },

    setOrderBookFromRest: (
      assetId: string,
      bids: OrderBookLevel[],
      asks: OrderBookLevel[]
    ) => {
      set((state) => {
        let processed = processOrderBook(
          assetId,
          "",
          bids,
          asks,
          Date.now().toString(),
          "",
          "rest"
        );

        // Apply any pending changes that arrived before this REST data
        const pending = state.pendingChanges.get(assetId);
        if (pending && pending.length > 0) {
          processed = applyPendingChanges(processed, pending);
        }

        const newOrderBooks = new Map(state.orderBooks);
        newOrderBooks.set(assetId, processed);

        // Clear pending changes for this asset
        const newPendingChanges = new Map(state.pendingChanges);
        newPendingChanges.delete(assetId);

        return {
          orderBooks: newOrderBooks,
          pendingChanges: newPendingChanges,
        };
      });
    },

    clearOrderBook: (assetId: string) => {
      set((state) => {
        const newOrderBooks = new Map(state.orderBooks);
        newOrderBooks.delete(assetId);
        const newLastTrades = new Map(state.lastTrades);
        newLastTrades.delete(assetId);
        const newPendingChanges = new Map(state.pendingChanges);
        newPendingChanges.delete(assetId);
        const newPriceHistory = new Map(state.priceHistory);
        newPriceHistory.delete(assetId);
        const newPriceVelocity = new Map(state.priceVelocity);
        newPriceVelocity.delete(assetId);
        return {
          orderBooks: newOrderBooks,
          lastTrades: newLastTrades,
          pendingChanges: newPendingChanges,
          priceHistory: newPriceHistory,
          priceVelocity: newPriceVelocity,
        };
      });
    },

    clearAllOrderBooks: () => {
      set({
        orderBooks: new Map<string, ProcessedOrderBook>(),
        lastTrades: new Map<string, LastTrade>(),
        pendingChanges: new Map<string, PendingChange[]>(),
        priceHistory: new Map<string, PriceHistoryEntry[]>(),
        priceVelocity: new Map<string, PriceVelocity>(),
      });
    },

    setConnected: (connected: boolean) => {
      set({ isConnected: connected });
    },

    setError: (error: Error | null) => {
      set({ lastError: error });
    },

    // Selectors
    getOrderBook: (assetId: string) => {
      return get().orderBooks.get(assetId);
    },

    getBestBid: (assetId: string) => {
      return get().orderBooks.get(assetId)?.bestBid ?? null;
    },

    getBestAsk: (assetId: string) => {
      return get().orderBooks.get(assetId)?.bestAsk ?? null;
    },

    getSpread: (assetId: string) => {
      return get().orderBooks.get(assetId)?.spread ?? null;
    },

    getLastTrade: (assetId: string) => {
      return get().lastTrades.get(assetId);
    },

    isStale: (assetId: string) => {
      const orderBook = get().orderBooks.get(assetId);
      if (!orderBook) return true;
      const age = Date.now() - orderBook.receivedAt;
      return age > STALE_THRESHOLD_MS;
    },

    getVelocity: (assetId: string) => {
      return get().priceVelocity.get(assetId);
    },

    getPriceAt: (assetId: string, timestampMs: number) => {
      const history = get().priceHistory.get(assetId);
      if (!history) return null;
      return getPriceAtTimestamp(history, timestampMs);
    },
  }))
);

/**
 * Hook to get order book for a specific asset with automatic updates
 */
export function useOrderBook(assetId: string | undefined) {
  return useOrderBookStore((state: OrderBookStoreState) =>
    assetId ? state.orderBooks.get(assetId) : undefined
  );
}

/**
 * Hook to get best prices for a specific asset
 * Uses useShallow to prevent infinite re-renders from object creation
 */
export function useBestPrices(assetId: string | undefined) {
  return useOrderBookStore(
    useShallow((state: OrderBookStoreState) => {
      if (!assetId) return { bestBid: null, bestAsk: null, spread: null };
      const orderBook = state.orderBooks.get(assetId);
      return {
        bestBid: orderBook?.bestBid ?? null,
        bestAsk: orderBook?.bestAsk ?? null,
        spread: orderBook?.spread ?? null,
      };
    })
  );
}

/**
 * Hook to get last trade for a specific asset
 */
export function useLastTrade(assetId: string | undefined) {
  return useOrderBookStore((state: OrderBookStoreState) =>
    assetId ? state.lastTrades.get(assetId) : undefined
  );
}

/**
 * Hook to get connection status
 * Uses useShallow to prevent infinite re-renders from object creation
 */
export function useOrderBookConnectionStatus() {
  return useOrderBookStore(
    useShallow((state: OrderBookStoreState) => ({
      isConnected: state.isConnected,
      lastError: state.lastError,
    }))
  );
}

/**
 * Hook to check if order book data is stale
 */
export function useOrderBookStale(assetId: string | undefined) {
  return useOrderBookStore((state: OrderBookStoreState) => {
    if (!assetId) return true;
    const orderBook = state.orderBooks.get(assetId);
    if (!orderBook) return true;
    const age = Date.now() - orderBook.receivedAt;
    return age > STALE_THRESHOLD_MS;
  });
}

/**
 * Hook to get order book with staleness info
 */
export function useOrderBookWithStatus(assetId: string | undefined) {
  return useOrderBookStore(
    useShallow((state: OrderBookStoreState) => {
      if (!assetId) {
        return { orderBook: undefined, isStale: true, source: undefined };
      }
      const orderBook = state.orderBooks.get(assetId);
      if (!orderBook) {
        return { orderBook: undefined, isStale: true, source: undefined };
      }
      const age = Date.now() - orderBook.receivedAt;
      return {
        orderBook,
        isStale: age > STALE_THRESHOLD_MS,
        source: orderBook.source,
      };
    })
  );
}

// ============================================
// Price Velocity Hooks (for signal detection)
// ============================================

/**
 * Hook to get price velocity for a specific asset
 * Returns metrics about how fast the price is changing
 */
export function usePriceVelocity(assetId: string | undefined) {
  return useOrderBookStore((state: OrderBookStoreState) =>
    assetId ? state.priceVelocity.get(assetId) : undefined
  );
}

/**
 * Hook to detect if there's a price anomaly (sudden movement)
 * Useful for triggering alerts
 */
export function usePriceAnomaly(assetId: string | undefined) {
  return useOrderBookStore(
    useShallow((state: OrderBookStoreState) => {
      if (!assetId) {
        return { isAnomaly: false, change: 0, direction: "STABLE" as const };
      }
      const velocity = state.priceVelocity.get(assetId);
      return {
        isAnomaly: velocity?.isAnomaly ?? false,
        change: velocity?.change5s ?? 0,
        direction: velocity?.direction ?? ("STABLE" as const),
      };
    })
  );
}

/**
 * Hook to get price velocity with all metrics
 * Uses useShallow to prevent infinite re-renders
 */
export function usePriceVelocityMetrics(assetId: string | undefined) {
  return useOrderBookStore(
    useShallow((state: OrderBookStoreState) => {
      if (!assetId) {
        return {
          change1s: 0,
          change5s: 0,
          change30s: 0,
          change60s: 0,
          isAnomaly: false,
          direction: "STABLE" as const,
        };
      }
      const velocity = state.priceVelocity.get(assetId);
      return {
        change1s: velocity?.change1s ?? 0,
        change5s: velocity?.change5s ?? 0,
        change30s: velocity?.change30s ?? 0,
        change60s: velocity?.change60s ?? 0,
        isAnomaly: velocity?.isAnomaly ?? false,
        direction: velocity?.direction ?? ("STABLE" as const),
      };
    })
  );
}

/**
 * Hook to get price history for a specific asset
 * Useful for charting or custom analysis
 */
export function usePriceHistory(assetId: string | undefined) {
  return useOrderBookStore((state: OrderBookStoreState) =>
    assetId ? state.priceHistory.get(assetId) : undefined
  );
}
