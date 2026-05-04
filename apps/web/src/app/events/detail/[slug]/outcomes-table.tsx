"use client";

import { formatOrderExpiration } from "@knoww/shared-types/orders";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronUp,
  History,
  Info,
  LineChart,
  Loader2,
  User,
  Users,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { OrderBookInline } from "@/components/order-book-summary";
import { SellPositionModal } from "@/components/portfolio/sell-position-modal";
import type { Position as PortfolioPosition } from "@/components/portfolio/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCancelOrder, useOpenOrders } from "@/hooks/use-open-orders";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import type { ConnectionState } from "@/hooks/use-shared-websocket";
import { useTopHolders } from "@/hooks/use-top-holders";
import type { Position } from "@/hooks/use-user-positions";
import { useUserTrades } from "@/hooks/use-user-trades";
import { formatPrice, formatVolume } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// Lazy load heavy chart and order book components
const MarketPriceChart = dynamic(
  () =>
    import("@/components/market-price-chart").then((mod) => ({
      default: mod.MarketPriceChart,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[250px] w-full rounded-xl" />,
  }
);

const OrderBook = dynamic(
  () =>
    import("@/components/order-book").then((mod) => ({
      default: mod.OrderBook,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
  }
);

/** Compact relative-time label (e.g. "8d ago", "2h ago") for trade history. */
function formatRelativeTime(timestamp: string | number): string {
  const t =
    typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  const diffMs = Date.now() - t;
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const s = Math.floor(diffMs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return `${s}s ago`;
}

interface MarketData {
  id: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: string;
  noPrice: string;
  conditionId: string;
  groupItemTitle: string;
  volume: string | number;
  yesProbability: number;
  change: number;
  closed?: boolean;
}

interface OutcomesTableProps {
  sortedMarketData: MarketData[];
  closedMarkets?: MarketData[];
  changeLabel?: string;
  isOutcomeTableExpanded: boolean;
  setIsOutcomeTableExpanded: (val: boolean) => void;
  isConnected: boolean;
  connectionState: ConnectionState;
  expandedOrderBookMarketId: string | null;
  setExpandedOrderBookMarketId: (val: string | null) => void;
  selectedMarketId: string;
  setSelectedMarketId: (val: string) => void;
  selectedOutcomeIndex: number;
  setSelectedOutcomeIndex: (val: number) => void;
  preloadOrderBook: (tokenId: string | undefined) => Promise<void>;
  getMarketPositions: (market: {
    conditionId: string;
    yesTokenId: string;
    noTokenId: string;
  }) => Position[];
  handlePriceClick: (price: number) => void;
  isSingleMarketEvent: boolean;
  onSellSuccess?: () => void;
}

interface MarketExpandedContentProps {
  isExpanded: boolean;
  userPositions: Position[];
  market: {
    id: string;
    yesTokenId: string;
    noTokenId: string;
    yesPrice: string;
    noPrice: string;
    conditionId: string;
    groupItemTitle: string;
  };
  marketOutcomes: { name: string; tokenId: string; price: number }[];
  selectedOutcomeIndex: number;
  setSelectedOutcomeIndex: (val: number) => void;
  handlePriceClick: (price: number) => void;
  isSingleMarketEvent: boolean;
  onSellPosition: (position: Position) => void;
}

function MarketExpandedContent({
  isExpanded,
  userPositions,
  market,
  marketOutcomes,
  selectedOutcomeIndex,
  setSelectedOutcomeIndex,
  handlePriceClick,
  isSingleMarketEvent,
  onSellPosition,
}: MarketExpandedContentProps) {
  // Pull the trading address (Safe proxy) so we can scope the activity panel
  // to the user's own orders + trades for THIS market.
  const { proxyAddress, isDeployed: hasProxyWallet } = useProxyWallet();
  const tradingAddress =
    hasProxyWallet && proxyAddress ? proxyAddress : undefined;

  // All open orders for this user — the SDK doesn't filter server-side,
  // so we narrow client-side to the two tokenIds for this market.
  const { data: openOrdersData } = useOpenOrders({
    userAddress: tradingAddress,
    enabled: isExpanded && !!tradingAddress,
  });
  const marketOpenOrders = useMemo(() => {
    const orders = openOrdersData?.orders ?? [];
    return orders.filter(
      (o) => o.tokenId === market.yesTokenId || o.tokenId === market.noTokenId
    );
  }, [openOrdersData?.orders, market.yesTokenId, market.noTokenId]);

  // Recent trades for this market only — server-side filter via conditionId.
  // `type: TRADE` excludes redemptions/splits/merges (which carry price=0
  // and would render as bogus "Sold X at 0.0¢" entries in the history list).
  const { data: tradesData } = useUserTrades({
    userAddress: tradingAddress,
    market: market.conditionId || undefined,
    type: "TRADE",
    limit: 10,
    enabled: isExpanded && !!tradingAddress && !!market.conditionId,
  });
  const marketTrades = tradesData?.trades ?? [];

  const { mutate: cancelOrder, variables: cancellingOrderId } =
    useCancelOrder();

  const hasPositionActivity =
    userPositions.length > 0 || marketOpenOrders.length > 0;
  const hasHistory = marketTrades.length > 0;
  const hasActivity = hasPositionActivity || hasHistory;
  const defaultActivityTab = hasPositionActivity
    ? "position"
    : hasHistory
      ? "history"
      : "orderbook";

  // Use controlled tab state to ensure proper default selection
  const [activeTab, setActiveTab] = useState<string>(
    hasActivity ? defaultActivityTab : "orderbook"
  );

  // Track previous activity to detect changes
  const [hadActivity, setHadActivity] = useState<boolean>(hasActivity);

  // Update active tab ONLY when activity status flips (appears or disappears).
  // This lets users freely switch tabs while they have any market activity.
  useEffect(() => {
    if (hasActivity !== hadActivity) {
      if (hasActivity && !hadActivity) {
        setActiveTab(defaultActivityTab);
      } else if (!hasActivity && hadActivity) {
        setActiveTab("orderbook");
      }
      setHadActivity(hasActivity);
    }
  }, [defaultActivityTab, hasActivity, hadActivity]);

  useEffect(() => {
    if (activeTab === "position" && !hasPositionActivity) {
      setActiveTab(defaultActivityTab);
    } else if (activeTab === "history" && !hasHistory) {
      setActiveTab(defaultActivityTab);
    }
  }, [activeTab, defaultActivityTab, hasHistory, hasPositionActivity]);

  // Skip rendering heavy children (OrderBook × 2, chart, holders table) until
  // the row is expanded — otherwise every market mounts its fetch chain on
  // page load, saturating the CLOB /book endpoint and delaying the FIRST
  // expansion's first paint.
  if (!isExpanded) {
    return (
      <div className="grid grid-rows-[0fr] opacity-0 border-b border-border/50" />
    );
  }

  // Shared TabsTrigger styling — suppresses shadcn's default focus-visible
  // rectangle (which reads as an ugly selection outline on click) and lets
  // the bottom-border accent carry the active signal. Hover/focus get a
  // subtle bg tint instead.
  const tabTriggerClass =
    "h-auto flex-none px-4 py-3 rounded-none border border-transparent border-b-2 data-[state=active]:border-b-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs sm:text-sm font-medium whitespace-nowrap hover:bg-muted/20 focus-visible:bg-muted/20 focus-visible:ring-0 focus-visible:outline-none focus-visible:border-transparent data-[state=active]:focus-visible:border-b-primary";

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity,background-color] duration-300 ease-in-out border-b border-border/50 bg-muted/5",
        "grid-rows-[1fr] opacity-100"
      )}
    >
      <div className="overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex items-center justify-between px-2 sm:px-6 border-b border-border/50 overflow-x-auto no-scrollbar">
            <TabsList className="h-auto p-0 bg-transparent gap-0 shrink-0 flex">
              {/* Position tab — only positions and open orders. Trade history
                  lives in its own tab below. */}
              {hasPositionActivity && (
                <TabsTrigger value="position" className={tabTriggerClass}>
                  <User className="h-3.5 w-3.5 mr-2 inline-block" />
                  Position
                </TabsTrigger>
              )}
              {hasHistory && (
                <TabsTrigger value="history" className={tabTriggerClass}>
                  <History className="h-3.5 w-3.5 mr-2 inline-block" />
                  History
                </TabsTrigger>
              )}
              <TabsTrigger value="orderbook" className={tabTriggerClass}>
                <BookOpen className="h-3.5 w-3.5 mr-2 inline-block" />
                Order Book
              </TabsTrigger>
              {/* Only show Graph tab for multi-market events */}
              {!isSingleMarketEvent && (
                <TabsTrigger value="graph" className={tabTriggerClass}>
                  <LineChart className="h-3.5 w-3.5 mr-2 inline-block" />
                  Graph
                </TabsTrigger>
              )}
              {/* Top Holders Tab */}
              <TabsTrigger value="holders" className={tabTriggerClass}>
                <Users className="h-3.5 w-3.5 mr-2 inline-block" />
                Top Holders
              </TabsTrigger>
              <TabsTrigger value="resolution" className={tabTriggerClass}>
                <Info className="h-3.5 w-3.5 mr-2 inline-block" />
                Resolution
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Position Tab Content — positions + open orders only. */}
          {hasPositionActivity && (
            <TabsContent value="position" className="m-0 px-6 py-4 space-y-6">
              {userPositions.length > 0 && (
                <div className="space-y-2">
                  <div className="hidden md:grid md:grid-cols-[minmax(80px,1fr)_120px_120px_120px_120px_140px_112px] items-center gap-4 text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                    <span>Outcome</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Avg Price</span>
                    <span className="text-right">Value</span>
                    <span className="text-right">Cost</span>
                    <span className="text-right">Return</span>
                    <span className="text-right">&nbsp;</span>
                  </div>
                  {userPositions.map((position) => (
                    <div
                      key={position.id}
                      className="grid grid-cols-2 md:grid-cols-[minmax(80px,1fr)_120px_120px_120px_120px_140px_112px] items-center gap-3 md:gap-4 py-1 text-sm"
                    >
                      <span
                        className={cn(
                          "font-bold",
                          position.outcome.toLowerCase() === "yes"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        )}
                      >
                        {position.outcome}
                      </span>
                      <span className="text-right font-bold tabular-nums">
                        {position.size.toFixed(2)}
                      </span>
                      <span className="text-right font-bold tabular-nums">
                        {(position.avgPrice * 100).toFixed(1)}¢
                      </span>
                      <span className="text-right font-bold tabular-nums">
                        ${position.currentValue.toFixed(2)}
                      </span>
                      <span className="text-right font-bold tabular-nums">
                        ${position.initialValue.toFixed(2)}
                      </span>
                      <span
                        className={cn(
                          "text-right font-bold tabular-nums",
                          position.unrealizedPnl >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        )}
                      >
                        ${Math.abs(position.unrealizedPnl).toFixed(2)}
                        <span className="text-xs ml-1 opacity-80">
                          ({position.unrealizedPnl >= 0 ? "+" : "-"}
                          {Math.abs(position.unrealizedPnlPercent).toFixed(1)}
                          %)
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="col-span-2 md:col-span-1 md:justify-self-end shrink-0 w-full md:w-auto font-bold shadow-lg shadow-rose-500/20 transition-[background-color,transform] duration-150 active:scale-95"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSellPosition(position);
                        }}
                      >
                        <span className="hidden lg:inline">Sell Position</span>
                        <span className="lg:hidden">Sell</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {marketOpenOrders.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] uppercase font-bold tracking-wider text-muted-foreground">
                      Open Orders
                    </h4>
                  </div>
                  <div className="rounded-md border border-border/50 overflow-hidden">
                    <div className="hidden md:grid md:grid-cols-[80px_minmax(80px,1fr)_100px_140px_120px_176px_92px] items-center gap-4 px-4 py-2 bg-muted/20 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <span>Side</span>
                      <span>Outcome</span>
                      <span className="text-right">Price</span>
                      <span className="text-right">Filled</span>
                      <span className="text-right">Total</span>
                      <span className="text-right">Expires</span>
                      <span className="text-right">&nbsp;</span>
                    </div>
                    {marketOpenOrders.map((order) => {
                      const outcomeName =
                        order.tokenId === market.yesTokenId ? "Yes" : "No";
                      const isCancelling = cancellingOrderId === order.id;
                      return (
                        <div
                          key={order.id}
                          className="grid grid-cols-[80px_minmax(80px,1fr)_92px] md:grid-cols-[80px_minmax(80px,1fr)_100px_140px_120px_176px_92px] items-center gap-4 px-4 py-2.5 border-t border-border/40 text-xs font-mono tabular-nums"
                        >
                          <span
                            className={cn(
                              "uppercase font-bold tracking-wider",
                              order.side === "BUY"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            )}
                          >
                            {order.side}
                          </span>
                          <span
                            className={cn(
                              "font-semibold",
                              outcomeName === "Yes"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            )}
                          >
                            {outcomeName}
                          </span>
                          <span className="hidden md:block text-right text-foreground">
                            {(order.price * 100).toFixed(1)}¢
                          </span>
                          <span className="hidden md:block text-right text-foreground">
                            {order.filledSize.toFixed(1)} /{" "}
                            {order.size.toFixed(1)}
                          </span>
                          <span className="hidden md:block text-right text-foreground">
                            ${(order.size * order.price).toFixed(2)}
                          </span>
                          <span className="hidden md:block text-right text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatOrderExpiration(order.expiration)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelOrder(order.id);
                            }}
                            disabled={isCancelling}
                            className="ml-auto inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-rose-500 transition-colors disabled:opacity-50"
                          >
                            {isCancelling ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <X className="h-3 w-3" />
                            )}
                            Cancel
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </TabsContent>
          )}

          {hasHistory && (
            <TabsContent value="history" className="m-0 px-6 py-4">
              <div className="rounded-md border border-border/50 divide-y divide-border/40">
                {marketTrades.map((trade) => {
                  const verb = trade.side === "BUY" ? "Bought" : "Sold";
                  const outcomeColor =
                    trade.outcome.toLowerCase() === "yes"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400";
                  return (
                    <div
                      key={trade.id}
                      className="flex items-center justify-between px-3 py-2 text-xs"
                    >
                      <span className="font-mono tabular-nums">
                        {verb}{" "}
                        <span className={cn("font-semibold", outcomeColor)}>
                          {trade.size.toFixed(2)} {trade.outcome}
                        </span>{" "}
                        <span className="text-muted-foreground">at</span>{" "}
                        <span className="text-foreground">
                          {(trade.price * 100).toFixed(1)}¢
                        </span>{" "}
                        <span className="text-muted-foreground">
                          (${trade.usdcAmount.toFixed(2)})
                        </span>
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {formatRelativeTime(trade.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </TabsContent>
          )}

          {/* Order Book Tab Content. Single-market events keep the
              toggle (one side at a time); multi-outcome renders YES and
              NO order books side-by-side so users can see the full depth
              picture without hunting for the less-liquid side. */}
          <TabsContent
            value="orderbook"
            className="m-0 data-[state=inactive]:hidden"
            forceMount
          >
            {isSingleMarketEvent ? (
              <OrderBook
                outcomes={marketOutcomes}
                defaultOutcomeIndex={selectedOutcomeIndex}
                onPriceClick={handlePriceClick}
                onOutcomeChange={setSelectedOutcomeIndex}
                useWebSocket={false}
                embedded
                scrollable
              />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-border/50">
                <div>
                  <div className="px-4 py-2 border-y border-border/50 bg-muted/20 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">
                    Yes book
                  </div>
                  <OrderBook
                    outcomes={marketOutcomes}
                    defaultOutcomeIndex={0}
                    onPriceClick={handlePriceClick}
                    useWebSocket={false}
                    embedded
                    hideOutcomeTabs
                    scrollable
                  />
                </div>
                <div>
                  <div className="px-4 py-2 border-y border-border/50 bg-muted/20 text-[10px] font-bold uppercase tracking-[0.14em] text-rose-600 dark:text-rose-400">
                    No book
                  </div>
                  <OrderBook
                    outcomes={marketOutcomes}
                    defaultOutcomeIndex={1}
                    onPriceClick={handlePriceClick}
                    useWebSocket={false}
                    embedded
                    hideOutcomeTabs
                    scrollable
                  />
                </div>
              </div>
            )}
          </TabsContent>

          {/* Graph Tab Content */}
          {!isSingleMarketEvent && (
            <TabsContent value="graph" className="m-0 p-6">
              <MarketPriceChart
                tokens={[
                  {
                    tokenId: market.yesTokenId,
                    name: "Yes",
                    color: "hsl(142, 76%, 36%)",
                  },
                  {
                    tokenId: market.noTokenId,
                    name: "No",
                    color: "hsl(0, 84%, 60%)",
                  },
                ]}
                outcomes={["Yes", "No"]}
                outcomePrices={[market.yesPrice, market.noPrice]}
                hideBothToggle
              />
            </TabsContent>
          )}

          {/* Top Holders Tab Content */}
          <TabsContent value="holders" className="m-0">
            <TopHoldersContent conditionId={market.conditionId} />
          </TabsContent>

          {/* Resolution Tab Content */}
          <TabsContent value="resolution" className="m-0 p-6">
            <div className="space-y-5 text-sm max-w-2xl">
              <div className="flex gap-3">
                <div className="h-8 w-8 border border-border/60 flex items-center justify-center shrink-0">
                  <Info className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <h4 className="font-mono text-[11px] uppercase tracking-[0.16em] font-semibold mb-1">
                    Resolution Source
                  </h4>
                  <p className="text-muted-foreground leading-relaxed">
                    Official announcement or verified news reports from
                    established media organizations will be used to resolve this
                    market.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="h-8 w-8 border border-border/60 flex items-center justify-center shrink-0">
                  <History className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <h4 className="font-mono text-[11px] uppercase tracking-[0.16em] font-semibold mb-1">
                    Resolution Rules
                  </h4>
                  <p className="text-muted-foreground leading-relaxed">
                    This market will resolve based on the first official
                    reporting of the outcome. If no official outcome is reached
                    by the expiration date, it may be extended or resolved based
                    on available data.
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function TopHoldersContent({ conditionId }: { conditionId: string }) {
  const { data: holdersData, isLoading, error } = useTopHolders(conditionId);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !holdersData || holdersData.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Users className="h-8 w-8 mx-auto mb-2 opacity-20" />
        <p>No holder data available for this market.</p>
      </div>
    );
  }

  // holdersData is an array of TopHoldersResponse, each with a holders array.
  // We'll combine them and group by outcome if needed, but for now let's show all top holders.
  const allHolders = holdersData
    .flatMap((d) => d.holders)
    .sort((a, b) => b.amount - a.amount);

  if (allHolders.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Users className="h-8 w-8 mx-auto mb-2 opacity-20" />
        <p>No holder data available for this market.</p>
      </div>
    );
  }

  return (
    <div className="p-0 overflow-hidden border-t border-border/50">
      <div className="max-h-[400px] overflow-y-auto overflow-x-auto no-scrollbar">
        <div className="min-w-[320px]">
          <table className="w-full text-sm">
            <thead className="bg-background sticky top-0 z-10 border-b border-border/50">
              <tr>
                <th className="px-2 sm:px-4 py-3 text-left font-bold text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/20 w-10 sm:w-16">
                  Rank
                </th>
                <th className="px-2 sm:px-4 py-3 text-left font-bold text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/20">
                  Holder
                </th>
                <th className="px-2 sm:px-4 py-3 text-left font-bold text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/20">
                  Outcome
                </th>
                <th className="px-2 sm:px-4 py-3 text-right font-bold text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/20">
                  Shares
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {allHolders.slice(0, 20).map((holder, idx) => (
                <tr
                  key={`${holder.proxyWallet}-${holder.asset}`}
                  className="hover:bg-accent/20 transition-colors"
                >
                  <td className="px-2 sm:px-4 py-3 text-muted-foreground font-mono text-xs">
                    {idx + 1}
                  </td>
                  <td className="px-2 sm:px-4 py-3">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      {holder.profileImageOptimized ? (
                        <div className="relative h-5 w-5 sm:h-6 sm:w-6 rounded-full overflow-hidden border border-border/50 shrink-0">
                          <Image
                            src={holder.profileImageOptimized}
                            alt={holder.pseudonym || "Holder"}
                            fill
                            className="object-cover"
                            sizes="(max-width: 640px) 20px, 24px"
                          />
                        </div>
                      ) : (
                        <div className="h-5 w-5 sm:h-6 sm:w-6 rounded-sm bg-foreground/5 flex items-center justify-center font-mono text-[8px] sm:text-[10px] font-semibold text-foreground border border-border/60 shrink-0">
                          {(holder.pseudonym || "0x").slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium truncate max-w-[70px] xs:max-w-[100px] sm:max-w-[150px] text-xs sm:text-sm">
                        {holder.pseudonym ||
                          `${holder.proxyWallet.slice(
                            0,
                            4
                          )}...${holder.proxyWallet.slice(-4)}`}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 sm:px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 sm:px-2 py-0.5 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.14em] font-semibold border",
                        holder.outcomeIndex === 0
                          ? "text-emerald-700 dark:text-emerald-300 border-emerald-600/40"
                          : "text-red-700 dark:text-red-300 border-red-600/40"
                      )}
                    >
                      {holder.outcomeIndex === 0 ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-3 text-right font-mono font-medium text-xs sm:text-sm whitespace-nowrap">
                    {holder.amount.toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SortButton({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 uppercase tracking-[0.14em] hover:text-foreground transition-colors",
        active && "text-foreground",
        className
      )}
      aria-label={`Sort by ${label}${
        active ? (dir === "asc" ? " ascending" : " descending") : ""
      }`}
    >
      {label}
      {active ? (
        dir === "asc" ? (
          <ArrowUp className="h-2.5 w-2.5" aria-hidden="true" />
        ) : (
          <ArrowDown className="h-2.5 w-2.5" aria-hidden="true" />
        )
      ) : null}
    </button>
  );
}

function OutcomeTradeButton({
  label,
  price,
  selected,
  accentClassName,
  onClick,
}: {
  label: "Yes" | "No";
  price: string;
  selected: boolean;
  accentClassName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors active:scale-[0.98]",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border/60 bg-muted/20 hover:border-foreground/50 hover:bg-muted/40"
      )}
    >
      <span
        className={cn(
          "shrink-0 border-l-[3px] pl-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] xl:text-[11px]",
          selected ? "border-background/70" : accentClassName
        )}
      >
        {label}
      </span>
      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums xl:text-[15px]">
        {formatPrice(price)}
      </span>
    </button>
  );
}

export function OutcomesTable({
  sortedMarketData,
  closedMarkets = [],
  changeLabel = "24H",
  isOutcomeTableExpanded,
  setIsOutcomeTableExpanded,
  isConnected,
  connectionState,
  expandedOrderBookMarketId,
  setExpandedOrderBookMarketId,
  selectedMarketId,
  setSelectedMarketId,
  selectedOutcomeIndex,
  setSelectedOutcomeIndex,
  preloadOrderBook,
  getMarketPositions,
  handlePriceClick,
  isSingleMarketEvent,
  onSellSuccess,
}: OutcomesTableProps) {
  const [showClosedMarkets, setShowClosedMarkets] = useState(false);

  // Sort state (local — doesn't touch the parent's sort order).
  // sortKey = null means "preserve the server/parent order" (prob desc).
  type SortKey = "prob" | "change";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const displayMarkets = useMemo(() => {
    if (!sortKey) return sortedMarketData;
    const getVal = (m: MarketData) =>
      sortKey === "prob" ? m.yesProbability : m.change;
    return [...sortedMarketData].sort((a, b) => {
      const cmp = getVal(a) - getVal(b);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [sortedMarketData, sortKey, sortDir]);

  // Sell position modal state
  const [sellPosition, setSellPosition] = useState<Position | null>(null);
  const [showSellModal, setShowSellModal] = useState(false);

  // Handle sell position - opens the modal
  const handleSellPosition = (position: Position) => {
    setSellPosition(position);
    setShowSellModal(true);
  };

  // Handle sell success - close modal and trigger refresh
  const handleSellSuccess = () => {
    onSellSuccess?.();
    setSellPosition(null);
  };

  // Convert Position from use-user-positions to portfolio/types Position format
  const convertToPortfolioPosition = (
    position: Position | null
  ): PortfolioPosition | null => {
    if (!position) return null;
    return {
      id: position.id,
      outcome: position.outcome,
      size: position.size,
      avgPrice: position.avgPrice,
      currentPrice: position.currentPrice,
      currentValue: position.currentValue,
      initialValue: position.initialValue,
      unrealizedPnl: position.unrealizedPnl,
      unrealizedPnlPercent: position.unrealizedPnlPercent,
      asset: position.asset,
      conditionId: position.conditionId,
      // Neg-risk flag must flow through: Quick Sell signs the order and
      // the exchange contract depends on this bit. Source of truth is the
      // Polymarket Data API (`negativeRisk`) — our positions route surfaces
      // it on the position.
      negRisk: position.negRisk,
      market: {
        title: position.market.title,
        slug: position.market.slug,
        eventSlug: position.market.eventSlug,
        icon: position.market.icon,
        endDate: position.market.endDate,
      },
    };
  };
  return (
    <Collapsible
      open={isOutcomeTableExpanded}
      onOpenChange={setIsOutcomeTableExpanded}
    >
      <Card className="py-0 gap-0 border-border/50 shadow-sm overflow-visible *:data-[slot=card-header]:rounded-t-xl">
        <CollapsibleTrigger asChild>
          <CardHeader className="py-2.5 px-4 bg-muted/20 border-b border-border/50 cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-2">
              {isConnected && (
                <span
                  className="relative flex h-1.5 w-1.5"
                  role="status"
                  title="Live"
                >
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
              )}
              {!isConnected && (
                <span
                  className={cn(
                    "relative inline-flex rounded-full h-1.5 w-1.5",
                    connectionState === "connecting" ||
                      connectionState === "reconnecting"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-muted-foreground/50"
                  )}
                  role="status"
                  title={
                    connectionState === "connecting"
                      ? "Connecting"
                      : connectionState === "reconnecting"
                        ? "Reconnecting"
                        : "Offline"
                  }
                />
              )}
              <CardTitle className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Outcome
              </CardTitle>
              <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                {sortedMarketData.length}
              </span>
              <div className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-accent/50 transition-colors">
                {isOutcomeTableExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="sr-only">
                  {isOutcomeTableExpanded ? "Collapse" : "Expand"} outcomes
                </span>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-0">
            {/* Desktop column headers — aligned with row data columns so
                PROB sits directly above the % values and the range label above the
                change chip. Mirrors the row's inner grid + min-widths. */}
            {sortedMarketData.length > 0 && (
              <div className="hidden lg:grid lg:grid-cols-[1fr_auto] items-center gap-4 pl-[11px] pr-4 py-1.5 border-b border-border/50 bg-muted/10 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                  <span className="pl-[44px]">Market</span>
                  <div className="flex items-center justify-end gap-3 pr-4 border-r border-border/50 h-6">
                    <SortButton
                      label="Prob"
                      active={sortKey === "prob"}
                      dir={sortDir}
                      onClick={() => toggleSort("prob")}
                      className="min-w-[50px] xl:min-w-[55px] justify-end"
                    />
                    <SortButton
                      label={changeLabel}
                      active={sortKey === "change"}
                      dir={sortDir}
                      onClick={() => toggleSort("change")}
                      className="min-w-[60px] xl:min-w-[70px] justify-center"
                    />
                  </div>
                </div>
                <span className="w-[210px] text-center">Trade</span>
              </div>
            )}
            <div className="divide-y divide-border/50">
              {displayMarkets.map((market) => {
                const isMarketClosed = false;
                const isExpanded = expandedOrderBookMarketId === market.id;

                // Build outcomes for this specific market
                const marketOutcomes = [
                  {
                    name: "Yes",
                    tokenId: market.yesTokenId,
                    price: Number.parseFloat(market.yesPrice) || 0.5,
                  },
                  {
                    name: "No",
                    tokenId: market.noTokenId,
                    price: Number.parseFloat(market.noPrice) || 0.5,
                  },
                ];

                // Check if user has a position in this market
                const userPositions = getMarketPositions({
                  conditionId: market.conditionId,
                  yesTokenId: market.yesTokenId,
                  noTokenId: market.noTokenId,
                });
                const totalPositionSize = userPositions.reduce(
                  (sum, position) => sum + position.size,
                  0
                );

                return (
                  <div key={market.id}>
                    {/* Market Row Container - Using a div to avoid nested buttons */}
                    <div
                      className={cn(
                        "relative w-full flex flex-col lg:grid lg:grid-cols-[1fr_auto] transition-[background-color,border-color] duration-150 border-l-[3px]",
                        selectedMarketId === market.id
                          ? "bg-foreground/3 border-l-foreground"
                          : "hover:bg-foreground/2 border-l-transparent",
                        isExpanded &&
                          "sticky top-0 z-20 bg-card/95 supports-backdrop-filter:bg-card/80 backdrop-blur shadow-sm"
                      )}
                    >
                      {/* Left Side: Market Info (Clickable to expand) */}
                      <button
                        type="button"
                        className="flex-1 text-left px-4 py-3 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 group"
                        onClick={() => {
                          if (isExpanded) {
                            setExpandedOrderBookMarketId(null);
                          } else {
                            setExpandedOrderBookMarketId(market.id);
                            if (!isMarketClosed) {
                              setSelectedMarketId(market.id);
                            }
                            void preloadOrderBook(market.yesTokenId);
                            void preloadOrderBook(market.noTokenId);
                          }
                        }}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${
                          market.groupItemTitle
                        }`}
                      >
                        {/* Mobile & Tablet Layout Section (<lg) */}
                        <div className="lg:hidden flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-semibold text-[13px] leading-tight text-foreground group-hover:underline decoration-foreground/40 underline-offset-4 transition-colors">
                                    {market.groupItemTitle}
                                  </h3>
                                  {userPositions.length > 0 && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] font-semibold text-foreground border border-border/60 tabular-nums shrink-0">
                                      <User className="h-2.5 w-2.5" />
                                      {totalPositionSize.toFixed(1)}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] tabular-nums text-muted-foreground">
                                    <span className="text-muted-foreground/60">
                                      Vol
                                    </span>{" "}
                                    {formatVolume(market.volume)}
                                  </span>
                                  {market.yesTokenId && (
                                    <OrderBookInline
                                      tokenId={market.yesTokenId}
                                      connectionState={connectionState}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-col items-end shrink-0">
                              <span className="font-mono text-xl font-bold tabular-nums leading-none">
                                {market.yesProbability}%
                              </span>
                              {market.change === 0 ? (
                                <span className="font-mono text-[10px] font-bold mt-1.5 text-muted-foreground/60 tabular-nums">
                                  —
                                </span>
                              ) : (
                                <div
                                  className={cn(
                                    "font-mono text-[10px] font-bold mt-1.5 px-1.5 py-0.5 rounded tabular-nums inline-flex items-center gap-0.5",
                                    market.change > 0
                                      ? "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400"
                                      : "text-rose-600 bg-rose-500/10 dark:text-rose-400"
                                  )}
                                >
                                  <span aria-hidden="true">
                                    {market.change > 0 ? "▲" : "▼"}
                                  </span>
                                  {Math.abs(market.change)}%
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Desktop Layout Section (lg+) */}
                        <div className="hidden lg:grid lg:grid-cols-[1fr_auto] lg:items-center lg:gap-4">
                          {/* Column 1: Title + Volume */}
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-[13px] xl:text-sm leading-tight line-clamp-2 group-hover:underline decoration-foreground/40 underline-offset-4 transition-colors">
                                  {market.groupItemTitle}
                                </h3>
                                {userPositions.length > 0 && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] font-semibold text-foreground border border-border/60 tabular-nums shrink-0">
                                    <User className="h-2.5 w-2.5" />
                                    {totalPositionSize.toFixed(1)}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] tabular-nums text-muted-foreground">
                                  <span className="text-muted-foreground/60">
                                    Vol
                                  </span>{" "}
                                  {formatVolume(market.volume)}
                                </span>
                                {market.yesTokenId && (
                                  <OrderBookInline
                                    tokenId={market.yesTokenId}
                                    connectionState={connectionState}
                                  />
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Column 2: Percentage + Change */}
                          <div className="flex items-center justify-end gap-3 pr-4 border-r border-border/50 h-8">
                            <span className="font-mono text-xl xl:text-2xl font-bold tabular-nums min-w-[50px] xl:min-w-[55px] text-right">
                              {market.yesProbability}%
                            </span>
                            {market.change === 0 ? (
                              <span className="font-mono text-xs xl:text-sm font-bold min-w-[60px] xl:min-w-[70px] text-center text-muted-foreground/60 tabular-nums shrink-0">
                                —
                              </span>
                            ) : (
                              <div
                                className={cn(
                                  "flex items-center justify-center gap-0.5 font-mono text-xs xl:text-sm font-bold min-w-[60px] xl:min-w-[70px] px-2 py-0.5 rounded shrink-0",
                                  market.change > 0
                                    ? "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400"
                                    : "text-rose-600 bg-rose-500/10 dark:text-rose-400"
                                )}
                              >
                                <span aria-hidden="true">
                                  {market.change > 0 ? "▲" : "▼"}
                                </span>
                                <span className="tabular-nums whitespace-nowrap">
                                  {Math.abs(market.change)}%
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </button>

                      {/* Right Side: Trading Buttons — editorial outline CTAs */}
                      <div className="px-4 pb-3 lg:pb-0 lg:pr-4 lg:pl-0 flex items-center justify-center">
                        <div className="grid w-full grid-cols-2 items-center gap-2 lg:w-[210px]">
                          <OutcomeTradeButton
                            label="Yes"
                            price={market.yesPrice}
                            selected={
                              selectedMarketId === market.id &&
                              selectedOutcomeIndex === 0
                            }
                            accentClassName="border-emerald-600 dark:border-emerald-400"
                            onClick={() => {
                              setExpandedOrderBookMarketId(market.id);
                              setSelectedMarketId(market.id);
                              setSelectedOutcomeIndex(0);
                              void preloadOrderBook(market.yesTokenId);
                            }}
                          />
                          <OutcomeTradeButton
                            label="No"
                            price={market.noPrice}
                            selected={
                              selectedMarketId === market.id &&
                              selectedOutcomeIndex === 1
                            }
                            accentClassName="border-rose-600 dark:border-rose-400"
                            onClick={() => {
                              setExpandedOrderBookMarketId(market.id);
                              setSelectedMarketId(market.id);
                              setSelectedOutcomeIndex(1);
                              void preloadOrderBook(market.noTokenId);
                            }}
                          />
                        </div>
                      </div>

                      {/* Probability bar — emerald fill = YES probability,
                          rose fill = remainder. Absolute at row bottom so it
                          doesn't perturb the grid layout. Turns the table
                          into a scannable heatmap. */}
                      <div
                        className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[2px]"
                        aria-hidden="true"
                      >
                        <span
                          className="bg-emerald-500/80 transition-[width] duration-300"
                          style={{
                            width: `${Math.max(0, Math.min(100, market.yesProbability))}%`,
                          }}
                        />
                        <span className="flex-1 bg-rose-500/40" />
                      </div>
                    </div>

                    {/* Expanded Content - Order Book, Graph, Top Holders, Resolution Tabs */}
                    <MarketExpandedContent
                      isExpanded={isExpanded}
                      userPositions={userPositions}
                      market={market}
                      marketOutcomes={marketOutcomes}
                      selectedOutcomeIndex={selectedOutcomeIndex}
                      setSelectedOutcomeIndex={setSelectedOutcomeIndex}
                      handlePriceClick={handlePriceClick}
                      isSingleMarketEvent={isSingleMarketEvent}
                      onSellPosition={handleSellPosition}
                    />
                  </div>
                );
              })}

              {/* Closed Markets Section */}
              {closedMarkets.length > 0 && (
                <div className="border-t border-border/50">
                  <button
                    type="button"
                    onClick={() => setShowClosedMarkets(!showClosedMarkets)}
                    className="w-full px-6 py-3 flex items-center justify-between bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">
                        Closed Markets
                      </span>
                      <span className="px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground border border-border/60 tabular-nums">
                        {closedMarkets.length}
                      </span>
                    </div>
                    {showClosedMarkets ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>

                  {showClosedMarkets && (
                    <div className="divide-y divide-border/30">
                      {closedMarkets.map((market) => {
                        const userPositions = getMarketPositions({
                          conditionId: market.conditionId,
                          yesTokenId: market.yesTokenId,
                          noTokenId: market.noTokenId,
                        });
                        const totalPositionSize = userPositions.reduce(
                          (sum, position) => sum + position.size,
                          0
                        );

                        return (
                          <div
                            key={market.id}
                            className="px-6 py-4 bg-muted/10 opacity-70"
                          >
                            <div className="flex items-center justify-between gap-4">
                              {/* Market Info */}
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-medium text-sm truncate text-muted-foreground">
                                      {market.groupItemTitle}
                                    </h3>
                                    <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-muted text-muted-foreground shrink-0">
                                      Closed
                                    </span>
                                    {userPositions.length > 0 && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground border border-border/60 tabular-nums shrink-0">
                                        <User className="h-2.5 w-2.5" />
                                        {totalPositionSize.toFixed(1)}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatVolume(market.volume)} Vol.
                                  </span>
                                </div>
                              </div>

                              {/* Result */}
                              <div className="flex items-center gap-3 shrink-0">
                                <div className="text-right">
                                  <span className="text-lg font-bold tabular-nums text-muted-foreground">
                                    {market.yesProbability}%
                                  </span>
                                  <span className="text-xs text-muted-foreground ml-1">
                                    Yes
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>

      {/* Sell Position Modal */}
      <SellPositionModal
        open={showSellModal}
        onOpenChange={setShowSellModal}
        position={convertToPortfolioPosition(sellPosition)}
        onSellSuccess={handleSellSuccess}
      />
    </Collapsible>
  );
}
