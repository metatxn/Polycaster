"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  HelpCircle,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useOrderBook as useOrderBookStore,
  useOrderBookStore as useStore,
} from "@/hooks/use-orderbook-store";
import {
  type ConnectionState,
  useOrderBookWebSocket,
} from "@/hooks/use-shared-websocket";
import { isValidTokenId, isValidTokenIdForRest } from "@/lib/token-validation";
import { cn } from "@/lib/utils";

/**
 * Order book level representing a price point with size
 */
interface OrderBookLevel {
  price: string;
  size: string;
}

/**
 * Order book data structure
 */
interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread?: number;
  midpoint?: number;
}

/**
 * Outcome data for tabs
 */
export interface OutcomeTab {
  name: string;
  tokenId: string;
  price?: number;
}

/**
 * Props for the OrderBook component
 */
export interface OrderBookProps {
  /** Outcomes to display tabs for (Yes/No) */
  outcomes: OutcomeTab[];
  /** Initially selected outcome index */
  defaultOutcomeIndex?: number;
  /** Maximum number of levels to display on each side */
  maxLevels?: number;
  /** Callback when a price level is clicked */
  onPriceClick?: (price: number, side: "BUY" | "SELL") => void;
  /** Whether to use WebSocket for real-time updates */
  useWebSocket?: boolean;
  /** Fallback polling interval when WebSocket is unavailable */
  pollingInterval?: number;
  /** Last trade price */
  lastTradePrice?: number;
  /** Whether the component starts collapsed */
  defaultCollapsed?: boolean;
  /** Callback when outcome tab changes */
  onOutcomeChange?: (index: number, outcome: OutcomeTab) => void;
  /** Embedded mode - no wrapper, header, or collapsible (for use in OutcomeDetails) */
  embedded?: boolean;
  /** Hide the outcome tabs (when parent handles tab switching) */
  hideOutcomeTabs?: boolean;
}

/**
 * Polymarket CLOB API response structure
 */
interface ClobOrderBookResponse {
  market: string;
  asset_id: string;
  hash: string;
  timestamp: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

/**
 * Fetch order book directly from Polymarket CLOB API
 * This is faster than going through our Next.js API route
 * CLOB API is public and allows CORS
 */
async function fetchOrderBook(tokenId: string): Promise<OrderBookData> {
  // Direct call to Polymarket CLOB API (no proxy needed)
  const response = await fetch(
    `https://clob.polymarket.com/book?token_id=${tokenId}`,
    {
      headers: {
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch order book: ${response.status}`);
  }

  const data: ClobOrderBookResponse = await response.json();

  return {
    bids: data.bids || [],
    asks: data.asks || [],
  };
}

/**
 * Format price as cents
 */
function formatPrice(price: string | number): string {
  const num = typeof price === "string" ? Number.parseFloat(price) : price;
  return `${(num * 100).toFixed(1)}¢`;
}

/**
 * Format size with commas
 */
function formatSize(size: string | number): string {
  const num = typeof size === "string" ? Number.parseFloat(size) : size;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDollar(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Build cumulative totals for orderbook levels.
 * Each entry is the sum of (price × size) for that level and all levels
 * closer to the spread.
 */
function buildCumulativeTotals(levels: OrderBookLevel[]): number[] {
  const totals: number[] = [];
  let cumulative = 0;
  for (const level of levels) {
    cumulative +=
      Number.parseFloat(level.price) * Number.parseFloat(level.size);
    totals.push(cumulative);
  }
  return totals;
}

/**
 * Calculate the maximum size for depth visualization
 */
function calculateMaxSize(levels: OrderBookLevel[]): number {
  return Math.max(...levels.map((l) => Number.parseFloat(l.size)), 1);
}

/**
 * Connection status indicator
 */
function ConnectionStatus({
  state,
  className,
}: {
  state: ConnectionState;
  className?: string;
}) {
  const isConnected = state === "connected";
  const isConnecting = state === "connecting" || state === "reconnecting";

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {isConnected ? (
        <>
          <Wifi className="h-3 w-3 text-emerald-500" />
          <span className="text-[10px] text-emerald-500">Live</span>
        </>
      ) : isConnecting ? (
        <>
          <Wifi className="h-3 w-3 text-amber-500 animate-pulse" />
          <span className="text-[10px] text-amber-500">Connecting</span>
        </>
      ) : (
        <>
          <WifiOff className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Offline</span>
        </>
      )}
    </div>
  );
}

/**
 * OrderBook Component - Polymarket Style
 *
 * Features:
 * - Trade Yes / Trade No tabs to switch outcomes
 * - Visual depth bars showing liquidity
 * - Asks on top (red), Bids on bottom (green)
 * - Last price and spread in the middle
 * - Price, Shares, Total columns
 * - Collapsible design
 */
export function OrderBook({
  outcomes,
  defaultOutcomeIndex = 0,
  maxLevels = 4,
  onPriceClick,
  useWebSocket = true,
  pollingInterval: _pollingInterval = 5000,
  lastTradePrice,
  defaultCollapsed = false,
  onOutcomeChange,
  embedded = false,
  hideOutcomeTabs = false,
}: OrderBookProps) {
  const [selectedOutcome, setSelectedOutcome] = useState(defaultOutcomeIndex);
  const [isOpen, setIsOpen] = useState(!defaultCollapsed);

  // Sync internal state with parent's defaultOutcomeIndex when it changes
  // This allows parent to control which outcome (Yes/No) is displayed
  useEffect(() => {
    setSelectedOutcome(defaultOutcomeIndex);
  }, [defaultOutcomeIndex]);

  const currentOutcome = outcomes[selectedOutcome];
  const tokenId = currentOutcome?.tokenId || "";
  // Use standardized validation for REST API (more lenient)
  const isTokenValidForRest = isValidTokenIdForRest(tokenId);
  // Use stricter validation for WebSocket subscriptions
  const isTokenValidForWs = isValidTokenId(tokenId);

  // Handle outcome tab change
  const handleOutcomeChange = useCallback(
    (index: number) => {
      setSelectedOutcome(index);
      onOutcomeChange?.(index, outcomes[index]);
    },
    [outcomes, onOutcomeChange]
  );

  // Get order book store action for seeding from REST
  const { setOrderBookFromRest } = useStore();

  // Read any existing order book from the store (may have been preloaded)
  const storeOrderBook = useOrderBookStore(tokenId);

  // STEP 1: Fetch initial order book snapshot via REST (always enabled)
  // This provides immediate data while WebSocket connects
  const {
    data: restOrderBook,
    isLoading: isRestLoading,
    error: restError,
    refetch,
    isFetching,
  } = useQuery<OrderBookData>({
    queryKey: ["orderBook", tokenId],
    queryFn: () => fetchOrderBook(tokenId),
    staleTime: 30000, // Consider data fresh for 30s
    gcTime: 60000, // Keep in cache for 60s (prevents refetch on tab switch)
    enabled: isTokenValidForRest, // Always fetch if token is valid for REST
  });

  // STEP 2: Seed the store with REST data when it arrives
  // This ensures we have data to show immediately
  useEffect(() => {
    if (restOrderBook && isTokenValidForRest) {
      setOrderBookFromRest(
        tokenId,
        restOrderBook.bids || [],
        restOrderBook.asks || []
      );
    }
  }, [restOrderBook, tokenId, isTokenValidForRest, setOrderBookFromRest]);

  // STEP 3: Connect to shared WebSocket for real-time incremental updates
  // Uses singleton manager - only ONE connection shared across all OrderBook components
  const assetIds = useMemo(
    () => (isTokenValidForWs && useWebSocket ? [tokenId] : []),
    [isTokenValidForWs, useWebSocket, tokenId]
  );
  const { connectionState } = useOrderBookWebSocket(assetIds);

  // Use store data (which has REST + WebSocket updates merged)
  // Fall back to raw REST data if store is empty
  const orderBook = useMemo(() => {
    if (storeOrderBook) {
      return {
        bids: storeOrderBook.bids,
        asks: storeOrderBook.asks,
        spread: storeOrderBook.spread,
        midpoint: storeOrderBook.midpoint,
      };
    }
    return restOrderBook;
  }, [storeOrderBook, restOrderBook]);

  const isLoading = !storeOrderBook && isRestLoading;
  const error = !storeOrderBook && restError;

  // Process order book data
  const processedData = useMemo(() => {
    if (!orderBook) return null;

    const bids = [...(orderBook.bids || [])]
      .sort((a, b) => Number.parseFloat(b.price) - Number.parseFloat(a.price))
      .slice(0, maxLevels);

    const sortedAsks = [...(orderBook.asks || [])]
      .sort((a, b) => Number.parseFloat(a.price) - Number.parseFloat(b.price))
      .slice(0, maxLevels);

    const bestBid = bids[0] ? Number.parseFloat(bids[0].price) : 0;
    const bestAsk = sortedAsks[0] ? Number.parseFloat(sortedAsks[0].price) : 1;
    const spread = bestAsk - bestBid;
    const midpoint = (bestBid + bestAsk) / 2;

    const allLevels = [...bids, ...sortedAsks];
    const maxSize = calculateMaxSize(allLevels);

    // Reversed for display: highest ask at top, best ask at bottom
    const asks = sortedAsks.reverse();

    // Cumulative totals: accumulate from the spread outward.
    // Asks display top→bottom = farthest→nearest, so cumulate bottom→top.
    const askCumFromBest = buildCumulativeTotals([...asks].reverse());
    const askCumTotals = [...askCumFromBest].reverse();

    // Bids display top→bottom = best bid first, so cumulate top→bottom.
    const bidCumTotals = buildCumulativeTotals(bids);

    return {
      bids,
      asks,
      askCumTotals,
      bidCumTotals,
      spread,
      midpoint,
      maxSize,
      bestBid,
      bestAsk,
    };
  }, [orderBook, maxLevels]);

  // Calculate last trade price display
  const displayLastPrice = useMemo(() => {
    if (lastTradePrice) return lastTradePrice;
    if (processedData?.midpoint) return processedData.midpoint;
    return null;
  }, [lastTradePrice, processedData?.midpoint]);

  // No outcomes provided
  if (outcomes.length === 0) {
    return null;
  }

  // Render the order book content (shared between embedded and standalone modes)
  const renderOrderBookContent = () => (
    <>
      {/* Outcome Tabs - only show if not hidden */}
      {!hideOutcomeTabs && !embedded && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-border">
          <div className="flex gap-4">
            {outcomes.map((outcome, index) => (
              <button
                key={outcome.tokenId || index}
                type="button"
                onClick={() => handleOutcomeChange(index)}
                className={cn(
                  "text-sm font-medium transition-colors pb-1",
                  selectedOutcome === index
                    ? "text-foreground border-b-2 border-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Trade {outcome.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Rewards</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                refetch();
              }}
              disabled={isFetching}
              aria-label="Refresh order book"
            >
              <RefreshCw
                className={cn("h-3 w-3", isFetching && "animate-spin")}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>
      )}

      {/* Trade Yes/No selector for embedded mode */}
      {/* Trade Yes/No selector for embedded mode */}
      {embedded && (
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-muted/20">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Trade {currentOutcome?.name}
          </span>
          <div className="flex-1" />
          {outcomes.map((outcome, index) => (
            <button
              key={outcome.tokenId || index}
              type="button"
              onClick={() => handleOutcomeChange(index)}
              className={cn(
                "text-xs font-medium px-3 py-1 rounded transition-colors",
                selectedOutcome === index
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {outcome.name}
            </button>
          ))}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="px-4 py-4 space-y-2">
          {Array.from({ length: maxLevels }).map((_, i) => (
            <Skeleton key={`ask-skeleton-${i}`} className="h-7 w-full" />
          ))}
          <Skeleton className="h-10 w-full my-2" />
          {Array.from({ length: maxLevels }).map((_, i) => (
            <Skeleton key={`bid-skeleton-${i}`} className="h-7 w-full" />
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">Failed to load order book</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-3 w-3 mr-2" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* No Token ID */}
      {!isTokenValidForRest && !isLoading && !error && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Select an outcome to view order book
        </div>
      )}

      {/* Order Book Content */}
      {processedData && !isLoading && !error && (
        <>
          {/* Column Headers */}
          <div className={embedded ? "" : "border-t border-border"}>
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[42px] sm:w-[18%]" />
                <col className="w-auto sm:w-[22%]" />
                <col className="w-auto sm:w-[30%]" />
                <col className="w-auto sm:w-[30%]" />
              </colgroup>
              <thead>
                <tr className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-2 sm:px-4 py-2" />
                  <th className="text-right px-2 sm:px-4 py-2">Price</th>
                  <th className="text-right px-2 sm:px-4 py-2">Shares</th>
                  <th className="text-right px-2 sm:px-4 py-2">Total</th>
                </tr>
              </thead>
            </table>
          </div>

          {/* Asks (Sells) - Red */}
          <div className="relative">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[42px] sm:w-[18%]" />
                <col className="w-auto sm:w-[22%]" />
                <col className="w-auto sm:w-[30%]" />
                <col className="w-auto sm:w-[30%]" />
              </colgroup>
              <tbody>
                {processedData.asks.map((level, index) => {
                  const size = Number.parseFloat(level.size);
                  const depthPercent = (size / processedData.maxSize) * 100;

                  return (
                    <tr
                      key={`ask-${level.price}`}
                      className="relative cursor-pointer hover:bg-muted/30 transition-colors group"
                      onClick={() =>
                        onPriceClick?.(Number.parseFloat(level.price), "SELL")
                      }
                    >
                      <td className="relative px-2 sm:px-4 py-1.5">
                        <div
                          className="absolute left-0 top-0 bottom-0 bg-red-500/20 transition-all duration-300"
                          style={{
                            width: `${Math.min(depthPercent * 2, 100)}%`,
                          }}
                        />
                        {index === processedData.asks.length - 1 && (
                          <span className="relative text-[10px] font-medium px-1 sm:px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                            Asks
                          </span>
                        )}
                      </td>
                      <td className="text-right px-2 sm:px-4 py-1.5 text-red-400 font-medium text-sm">
                        {formatPrice(level.price)}
                      </td>
                      <td className="text-right px-2 sm:px-4 py-1.5 text-sm tabular-nums">
                        {formatSize(size)}
                      </td>
                      <td className="text-right px-2 sm:px-4 py-1.5 text-sm text-muted-foreground tabular-nums">
                        {formatDollar(processedData.askCumTotals[index])}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {processedData.asks.length === 0 && (
              <div className="px-2 sm:px-4 py-4 text-center text-xs text-muted-foreground">
                No asks available
              </div>
            )}
          </div>

          {/* Spread Divider */}
          <div className="flex items-center justify-between px-2 sm:px-4 py-2 bg-muted/20 border-y border-border">
            <div className="text-xs text-muted-foreground">
              Last:{" "}
              <span className="text-foreground font-medium">
                {displayLastPrice ? formatPrice(displayLastPrice) : "—"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Spread:{" "}
              <span className="text-foreground font-medium">
                {formatPrice(processedData.spread)}
              </span>
            </div>
          </div>

          {/* Bids (Buys) - Green */}
          <div className="relative">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[42px] sm:w-[18%]" />
                <col className="w-auto sm:w-[22%]" />
                <col className="w-auto sm:w-[30%]" />
                <col className="w-auto sm:w-[30%]" />
              </colgroup>
              <tbody>
                {processedData.bids.map((level, index) => {
                  const size = Number.parseFloat(level.size);
                  const depthPercent = (size / processedData.maxSize) * 100;

                  return (
                    <tr
                      key={`bid-${level.price}`}
                      className="relative cursor-pointer hover:bg-muted/30 transition-colors group"
                      onClick={() =>
                        onPriceClick?.(Number.parseFloat(level.price), "BUY")
                      }
                    >
                      <td className="relative px-2 sm:px-4 py-1.5">
                        <div
                          className="absolute left-0 top-0 bottom-0 bg-green-500/20 transition-all duration-300"
                          style={{
                            width: `${Math.min(depthPercent * 2, 100)}%`,
                          }}
                        />
                        {index === 0 && (
                          <span className="relative text-[10px] font-medium px-1 sm:px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                            Bids
                          </span>
                        )}
                      </td>
                      <td className="text-right px-2 sm:px-4 py-1.5 text-green-400 font-medium text-sm">
                        {formatPrice(level.price)}
                      </td>
                      <td className="text-right px-2 sm:px-4 py-1.5 text-sm tabular-nums">
                        {formatSize(size)}
                      </td>
                      <td className="text-right px-2 sm:px-4 py-1.5 text-sm text-muted-foreground tabular-nums">
                        {formatDollar(processedData.bidCumTotals[index])}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {processedData.bids.length === 0 && (
              <div className="px-2 sm:px-4 py-4 text-center text-xs text-muted-foreground">
                No bids available
              </div>
            )}
          </div>

          {/* Bottom padding */}
          <div className="h-2" />
        </>
      )}
    </>
  );

  // Embedded mode - just return the content without wrapper
  if (embedded) {
    return renderOrderBookContent();
  }

  // Standalone mode - with collapsible wrapper
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Order Book</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">
                      Live order book showing buy and sell orders
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-2">
              {useWebSocket && <ConnectionStatus state={connectionState} />}
              {isOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <AnimatePresence mode="wait">
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {renderOrderBookContent()}
            </motion.div>
          </AnimatePresence>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/**
 * Legacy OrderBook component for backwards compatibility
 * Wraps the new component with single token ID support
 */
export function OrderBookLegacy({
  tokenId,
  maxLevels = 10,
  onPriceClick,
  useWebSocket = true,
  pollingInterval = 5000,
}: {
  tokenId: string;
  maxLevels?: number;
  onPriceClick?: (price: number, side: "BUY" | "SELL") => void;
  useWebSocket?: boolean;
  pollingInterval?: number;
}) {
  return (
    <OrderBook
      outcomes={[{ name: "Yes", tokenId }]}
      maxLevels={maxLevels}
      onPriceClick={onPriceClick}
      useWebSocket={useWebSocket}
      pollingInterval={pollingInterval}
    />
  );
}

/**
 * Compact order book for sidebar display
 */
export function OrderBookCompact({
  tokenId,
  onPriceClick,
  useWebSocket = true,
}: {
  tokenId: string;
  onPriceClick?: (price: number, side: "BUY" | "SELL") => void;
  useWebSocket?: boolean;
}) {
  const isTokenValid = isValidTokenId(tokenId);
  const isTokenValidRest = isValidTokenIdForRest(tokenId);

  // WebSocket connection (uses shared singleton manager)
  const assetIds = useMemo(
    () => (isTokenValid && useWebSocket ? [tokenId] : []),
    [isTokenValid, useWebSocket, tokenId]
  );
  const { isConnected } = useOrderBookWebSocket(assetIds);

  // Get order book from store (seeded by REST, updated by WebSocket)
  const wsOrderBook = useOrderBookStore(tokenId);

  // REST API fallback
  const { data: restOrderBook, isLoading } = useQuery<OrderBookData>({
    queryKey: ["orderBook", tokenId],
    queryFn: () => fetchOrderBook(tokenId),
    refetchInterval: !isConnected ? 10000 : false,
    staleTime: 5000,
    enabled: isTokenValidRest && (!useWebSocket || !isConnected),
  });

  // Use WebSocket data if available
  const orderBook = wsOrderBook && isConnected ? wsOrderBook : restOrderBook;

  if (isLoading || !orderBook) {
    return (
      <div className="space-y-1">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  const bestBid = orderBook.bids?.[0];
  const bestAsk = orderBook.asks?.[0];

  return (
    <div className="space-y-1">
      {bestAsk && (
        <button
          type="button"
          className="w-full flex justify-between items-center px-2 py-1 rounded hover:bg-muted/50 transition-colors"
          onClick={() =>
            onPriceClick?.(Number.parseFloat(bestAsk.price), "SELL")
          }
        >
          <span className="text-xs text-muted-foreground">Best Ask</span>
          <span className="text-sm font-medium text-red-500">
            {formatPrice(bestAsk.price)}
          </span>
        </button>
      )}
      {bestBid && (
        <button
          type="button"
          className="w-full flex justify-between items-center px-2 py-1 rounded hover:bg-muted/50 transition-colors"
          onClick={() =>
            onPriceClick?.(Number.parseFloat(bestBid.price), "BUY")
          }
        >
          <span className="text-xs text-muted-foreground">Best Bid</span>
          <span className="text-sm font-medium text-green-500">
            {formatPrice(bestBid.price)}
          </span>
        </button>
      )}
      {/* Connection indicator */}
      {useWebSocket && (
        <div className="flex justify-center pt-1">
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              isConnected ? "bg-emerald-500" : "bg-muted-foreground"
            )}
          />
        </div>
      )}
    </div>
  );
}
