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
import { Card, CardContent } from "@/components/ui/card";
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
import { formatPrice, formatVolume, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/** Sub-1% outcomes show "<1%" instead of a misleading "0%" (the raw price
 *  is sub-cent, e.g. 0.4¢). */
function formatProbability(pct: number, yesPriceRaw?: string | number): string {
  const raw = yesPriceRaw !== undefined ? Number(yesPriceRaw) * 100 : pct;
  if (Number.isFinite(raw) && raw > 0 && raw < 1) return "<1%";
  return `${pct}%`;
}

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
  description?: string;
  endDate?: string;
  createdAt?: string;
  resolutionSource?: string;
  resolvedBy?: string;
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
  market: MarketData;
  marketOutcomes: { name: string; tokenId: string; price: number }[];
  selectedOutcomeIndex: number;
  setSelectedOutcomeIndex: (val: number) => void;
  handlePriceClick: (price: number) => void;
  isSingleMarketEvent: boolean;
  onSellPosition: (position: Position) => void;
}

function formatDetailDate(value: string | undefined): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function MarketResolutionContent({ market }: { market: MarketData }) {
  const description = market.description?.trim();
  const openedAt = formatDetailDate(market.createdAt);
  const endDate = formatDetailDate(market.endDate);

  return (
    <div className="space-y-5 text-sm leading-relaxed">
      <div className="flex gap-3">
        <div className="h-8 w-8 border border-(--kwm-hl-2) flex items-center justify-center shrink-0">
          <Info className="h-4 w-4 text-(--kwm-ink)" />
        </div>
        <div className="max-w-3xl">
          <h4 className="font-mono text-[11px] uppercase tracking-[0.16em] font-semibold mb-2 text-(--kwm-ink)">
            Resolution Rules
          </h4>
          <div className="space-y-3 text-(--kwm-ink-3)">
            {description ? (
              description
                .split(/\n{2,}/)
                .filter(Boolean)
                .map((paragraph) => <p key={paragraph}>{paragraph}</p>)
            ) : (
              <p>Rules are not available for this market yet.</p>
            )}
          </div>
        </div>
      </div>

      {(openedAt ||
        endDate ||
        market.resolutionSource ||
        market.resolvedBy) && (
        <dl className="grid gap-3 border-t border-(--kwm-hl) pt-4 font-mono text-[11px] uppercase tracking-[0.12em] sm:grid-cols-2">
          {openedAt && (
            <div>
              <dt className="text-(--kwm-ink-3)">Market Opened</dt>
              <dd className="mt-1 text-(--kwm-ink) normal-case tracking-normal">
                {openedAt}
              </dd>
            </div>
          )}
          {endDate && (
            <div>
              <dt className="text-(--kwm-ink-3)">End Date</dt>
              <dd className="mt-1 text-(--kwm-ink) normal-case tracking-normal">
                {endDate}
              </dd>
            </div>
          )}
          {market.resolutionSource && (
            <div>
              <dt className="text-(--kwm-ink-3)">Resolution Source</dt>
              <dd className="mt-1 truncate text-(--kwm-ink) normal-case tracking-normal">
                {market.resolutionSource}
              </dd>
            </div>
          )}
          {market.resolvedBy && (
            <div>
              <dt className="text-(--kwm-ink-3)">Resolver</dt>
              <dd className="mt-1 truncate text-(--kwm-ink) normal-case tracking-normal">
                {market.resolvedBy}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
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
      <div className="grid grid-rows-[0fr] opacity-0 border-b border-(--kwm-hl)" />
    );
  }

  // Shared TabsTrigger styling — suppresses shadcn's default focus-visible
  // rectangle (which reads as an ugly selection outline on click) and lets
  // the bottom-border accent carry the active signal. Hover/focus get a
  // subtle bg tint instead.
  const tabTriggerClass =
    "h-auto flex-none px-4 py-3 rounded-none border border-transparent border-b-2 data-[state=active]:border-b-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs sm:text-sm font-medium whitespace-nowrap hover:bg-(--kwm-bg-2) focus-visible:bg-(--kwm-bg-2) focus-visible:ring-0 focus-visible:outline-none focus-visible:border-transparent data-[state=active]:focus-visible:border-b-primary";

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity,background-color] duration-300 ease-in-out border-b border-(--kwm-hl) bg-(--kwm-bg-2)",
        "grid-rows-[1fr] opacity-100"
      )}
    >
      <div className="overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex items-center justify-between px-2 sm:px-6 border-b border-(--kwm-hl) overflow-x-auto no-scrollbar">
            <TabsList className="h-auto p-0 bg-transparent gap-0 shrink-0 flex">
              {/* Position tab — only positions and open orders. Trade history
                  lives in its own tab below. */}
              {hasPositionActivity && (
                <TabsTrigger value="position" className={tabTriggerClass}>
                  <User className="h-3.5 w-3.5 mr-2 inline-block" />
                  Position
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
              {hasHistory && (
                <TabsTrigger value="history" className={tabTriggerClass}>
                  <History className="h-3.5 w-3.5 mr-2 inline-block" />
                  History
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
                  <div className="hidden md:grid md:grid-cols-[minmax(80px,1fr)_120px_120px_120px_120px_140px_112px] items-center gap-4 text-[10px] text-(--kwm-ink-3) uppercase font-bold tracking-wider">
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
                            ? "text-(--kwm-up)"
                            : "text-(--kwm-down)"
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
                            ? "text-(--kwm-up)"
                            : "text-(--kwm-down)"
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
                        className="col-span-2 md:col-span-1 md:justify-self-end shrink-0 w-full md:w-auto font-bold shadow-[0_8px_24px_-12px_color-mix(in_oklch,var(--kwm-down)_30%,transparent)] transition-[background-color,transform] duration-150 active:scale-95"
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
                    <h4 className="text-[11px] uppercase font-bold tracking-wider text-(--kwm-ink-3)">
                      Open Orders
                    </h4>
                  </div>
                  <div className="rounded-md border border-(--kwm-hl) overflow-hidden">
                    <div className="hidden md:grid md:grid-cols-[80px_minmax(80px,1fr)_100px_140px_120px_176px_92px] items-center gap-4 px-4 py-2 bg-(--kwm-bg-2) text-[10px] font-bold uppercase tracking-wider text-(--kwm-ink-3)">
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
                          className="grid grid-cols-[80px_minmax(80px,1fr)_92px] md:grid-cols-[80px_minmax(80px,1fr)_100px_140px_120px_176px_92px] items-center gap-4 px-4 py-2.5 border-t border-(--kwm-hl) text-xs font-mono tabular-nums"
                        >
                          <span
                            className={cn(
                              "uppercase font-bold tracking-wider",
                              order.side === "BUY"
                                ? "text-(--kwm-up)"
                                : "text-(--kwm-down)"
                            )}
                          >
                            {order.side}
                          </span>
                          <span
                            className={cn(
                              "font-semibold",
                              outcomeName === "Yes"
                                ? "text-(--kwm-up)"
                                : "text-(--kwm-down)"
                            )}
                          >
                            {outcomeName}
                          </span>
                          <span className="hidden md:block text-right text-(--kwm-ink)">
                            {(order.price * 100).toFixed(1)}¢
                          </span>
                          <span className="hidden md:block text-right text-(--kwm-ink)">
                            {order.filledSize.toFixed(1)} /{" "}
                            {order.size.toFixed(1)}
                          </span>
                          <span className="hidden md:block text-right text-(--kwm-ink)">
                            ${(order.size * order.price).toFixed(2)}
                          </span>
                          <span className="hidden md:block text-right text-[10px] text-(--kwm-ink-3) whitespace-nowrap">
                            {formatOrderExpiration(order.expiration)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelOrder(order.id);
                            }}
                            disabled={isCancelling}
                            className="ml-auto inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-(--kwm-ink-3) hover:text-(--kwm-down) transition-colors disabled:opacity-50"
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
              <div className="rounded-md border border-(--kwm-hl) divide-y divide-(--kwm-hl)">
                {marketTrades.map((trade) => {
                  const verb = trade.side === "BUY" ? "Bought" : "Sold";
                  const outcomeColor =
                    trade.outcome.toLowerCase() === "yes"
                      ? "text-(--kwm-up)"
                      : "text-(--kwm-down)";
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
                        <span className="text-(--kwm-ink-3)">at</span>{" "}
                        <span className="text-(--kwm-ink)">
                          {(trade.price * 100).toFixed(1)}¢
                        </span>{" "}
                        <span className="text-(--kwm-ink-3)">
                          (${trade.usdcAmount.toFixed(2)})
                        </span>
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-(--kwm-ink-3)">
                        {relativeTime(trade.timestamp, "verbose")}
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
                  <div className="px-4 py-2 border-y border-(--kwm-hl) bg-(--kwm-bg-2) text-[10px] font-bold uppercase tracking-[0.14em] text-(--kwm-up)">
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
                  <div className="px-4 py-2 border-y border-(--kwm-hl) bg-(--kwm-bg-2) text-[10px] font-bold uppercase tracking-[0.14em] text-(--kwm-down)">
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
            <MarketResolutionContent market={market} />
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
      <div className="p-8 text-center text-(--kwm-ink-3)">
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
      <div className="p-8 text-center text-(--kwm-ink-3)">
        <Users className="h-8 w-8 mx-auto mb-2 opacity-20" />
        <p>No holder data available for this market.</p>
      </div>
    );
  }

  return (
    <div className="p-0 overflow-hidden border-t border-(--kwm-hl)">
      <div className="max-h-[400px] overflow-y-auto overflow-x-auto no-scrollbar">
        <div className="min-w-[320px]">
          <table className="w-full text-sm">
            <thead className="bg-(--kwm-panel) sticky top-0 z-10 border-b border-(--kwm-hl)">
              <tr>
                <th className="px-2 sm:px-4 py-3 text-left font-bold text-[10px] uppercase tracking-wider text-(--kwm-ink-3) bg-(--kwm-bg-2) w-10 sm:w-16">
                  Rank
                </th>
                <th className="px-2 sm:px-4 py-3 text-left font-bold text-[10px] uppercase tracking-wider text-(--kwm-ink-3) bg-(--kwm-bg-2)">
                  Holder
                </th>
                <th className="px-2 sm:px-4 py-3 text-left font-bold text-[10px] uppercase tracking-wider text-(--kwm-ink-3) bg-(--kwm-bg-2)">
                  Outcome
                </th>
                <th className="px-2 sm:px-4 py-3 text-right font-bold text-[10px] uppercase tracking-wider text-(--kwm-ink-3) bg-(--kwm-bg-2)">
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
                  <td className="px-2 sm:px-4 py-3 text-(--kwm-ink-3) font-mono text-xs">
                    {idx + 1}
                  </td>
                  <td className="px-2 sm:px-4 py-3">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      {holder.profileImageOptimized ? (
                        <div className="relative h-5 w-5 sm:h-6 sm:w-6 rounded-full overflow-hidden border border-(--kwm-hl) shrink-0">
                          <Image
                            src={holder.profileImageOptimized}
                            alt={holder.pseudonym || "Holder"}
                            fill
                            className="object-cover"
                            sizes="(max-width: 640px) 20px, 24px"
                          />
                        </div>
                      ) : (
                        <div className="h-5 w-5 sm:h-6 sm:w-6 rounded-sm bg-(--kwm-ink)/5 flex items-center justify-center font-mono text-[8px] sm:text-[10px] font-semibold text-(--kwm-ink) border border-(--kwm-hl-2) shrink-0">
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
                          ? "text-(--kwm-up) border-(--kwm-up-border)"
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
        "inline-flex items-center gap-1 uppercase tracking-[0.14em] hover:text-(--kwm-ink) transition-colors",
        active && "text-(--kwm-ink)",
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
          ? "border-(--kwm-ink) bg-(--kwm-ink) text-(--kwm-bg)"
          : "border-(--kwm-hl-2) bg-(--kwm-bg-2) hover:border-(--kwm-hl-3) hover:bg-(--kwm-bg-3)"
      )}
    >
      <span
        className={cn(
          "shrink-0 border-l-[3px] pl-2 font-mono text-[10px] font-semibold uppercase tracking-widest xl:text-[11px]",
          selected ? "border-(--kwm-bg)/70" : accentClassName
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
      {/* Section divider — sits OUTSIDE the panel, mirrors the FieldTiles
          `§ TITLE ──── meta` page-level pattern so the page reads as a
          stack of named sections. The whole bar is the collapsible
          trigger; chevron rotates to indicate state. */}
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-3 pt-3 pb-2 cursor-pointer text-left"
        >
          <span
            aria-hidden="true"
            className="font-(family-name:--font-geist-mono) text-(--kwm-ink-dim) text-[14px] leading-none"
          >
            §
          </span>
          <h2 className="m-0 font-(family-name:--font-geist-mono) text-[11px] font-medium uppercase tracking-[0.18em] text-(--kwm-ink-2)">
            All Outcomes
          </h2>
          <span aria-hidden="true" className="flex-1 h-px bg-(--kwm-hl)" />
          {isConnected && (
            <span
              className="inline-flex items-center gap-1.5 font-(family-name:--font-geist-mono) text-[10px] uppercase tracking-[0.16em] text-(--kwm-up)"
              role="status"
              title="Live"
            >
              <span className="kwm-pulse" aria-hidden="true" />
              Live
            </span>
          )}
          {!isConnected && (
            <span
              className={cn(
                "relative inline-flex rounded-full h-1.5 w-1.5",
                connectionState === "connecting" ||
                  connectionState === "reconnecting"
                  ? "bg-(--kwm-warn) animate-pulse"
                  : "bg-(--kwm-ink-dim)"
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
          {/* Counts — open vs settled, mono-caps with middle-dot separator
              when both are present (matches the FieldTiles `5 OF 48 · LIVE`
              grammar). Settled side is suppressed when zero. */}
          <span className="inline-flex items-center gap-1.5 font-(family-name:--font-geist-mono) text-[10px] uppercase tracking-[0.16em] text-(--kwm-ink-dim)">
            <span className="tabular-nums">
              <span className="text-(--kwm-ink-2)">
                {sortedMarketData.length}
              </span>{" "}
              Open
            </span>
            {closedMarkets.length > 0 && (
              <>
                <span aria-hidden="true" className="text-(--kwm-ink-dim)">
                  ·
                </span>
                <span className="tabular-nums">
                  <span className="text-(--kwm-ink-2)">
                    {closedMarkets.length}
                  </span>{" "}
                  Settled
                </span>
              </>
            )}
          </span>
          {isOutcomeTableExpanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-(--kwm-ink-3) group-hover:text-(--kwm-ink) transition-colors" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-(--kwm-ink-3) group-hover:text-(--kwm-ink) transition-colors" />
          )}
          <span className="sr-only">
            {isOutcomeTableExpanded ? "Collapse" : "Expand"} outcomes
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="py-0 gap-0 rounded-md border-(--kwm-hl-2) shadow-none overflow-hidden">
          <CardContent className="p-0">
            {/* Desktop column headers — aligned with row data columns so
                PROB sits directly above the % values and the range label above the
                change chip. Mirrors the row's inner grid + min-widths. */}
            {sortedMarketData.length > 0 && (
              <div className="hidden lg:grid lg:grid-cols-[1fr_auto] items-center gap-4 pl-[11px] pr-4 py-1.5 border-b border-(--kwm-hl) bg-(--kwm-bg-2) font-(family-name:--font-geist-mono) text-[10px] font-bold uppercase tracking-[0.14em] text-(--kwm-ink-2)">
                <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                  <span className="pl-[44px]">Market</span>
                  <div className="flex items-center justify-end gap-3 pr-4 border-r border-(--kwm-hl) h-6">
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
                <span className="w-[240px] text-center">Trade</span>
              </div>
            )}
            <div className="divide-y divide-(--kwm-hl)">
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
                          ? "bg-(--kwm-bg-3) border-l-(--kwm-ink)"
                          : "hover:bg-(--kwm-bg-3)/60 border-l-transparent",
                        isExpanded &&
                          "sticky top-0 z-20 bg-(--kwm-panel)/95 supports-backdrop-filter:bg-(--kwm-panel)/80 backdrop-blur"
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
                      >
                        {/* Mobile & Tablet Layout Section (<lg) */}
                        <div className="lg:hidden flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-semibold text-[13px] leading-tight text-(--kwm-ink) group-hover:underline decoration-(--kwm-ink)/40 underline-offset-4 transition-colors">
                                    {market.groupItemTitle}
                                  </h3>
                                  {userPositions.length > 0 && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] font-semibold text-(--kwm-ink) border border-(--kwm-hl-2) tabular-nums shrink-0">
                                      <User className="h-2.5 w-2.5" />
                                      {totalPositionSize.toFixed(1)}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] tabular-nums text-(--kwm-ink-3)">
                                    <span className="text-(--kwm-ink-dim)">
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
                                {formatProbability(
                                  market.yesProbability,
                                  market.yesPrice
                                )}
                              </span>
                              {market.change === 0 ? (
                                <span className="font-mono text-[10px] font-bold mt-1.5 text-(--kwm-ink-dim) tabular-nums">
                                  —
                                </span>
                              ) : (
                                <div
                                  className={cn(
                                    "font-mono text-[10px] font-bold mt-1.5 px-1.5 py-0.5 rounded tabular-nums inline-flex items-center gap-0.5",
                                    market.change > 0
                                      ? "text-(--kwm-up) bg-(--kwm-up-soft)"
                                      : "text-(--kwm-down) bg-(--kwm-down-soft)"
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
                                <h3 className="font-semibold text-[13px] xl:text-sm leading-tight line-clamp-2 group-hover:underline decoration-(--kwm-ink)/40 underline-offset-4 transition-colors">
                                  {market.groupItemTitle}
                                </h3>
                                {userPositions.length > 0 && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] font-semibold text-(--kwm-ink) border border-(--kwm-hl-2) tabular-nums shrink-0">
                                    <User className="h-2.5 w-2.5" />
                                    {totalPositionSize.toFixed(1)}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] tabular-nums text-(--kwm-ink-3)">
                                  <span className="text-(--kwm-ink-dim)">
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
                          <div className="flex items-center justify-end gap-3 pr-4 border-r border-(--kwm-hl) h-8">
                            <span className="font-mono text-xl xl:text-2xl font-bold tabular-nums min-w-[50px] xl:min-w-[55px] text-right">
                              {formatProbability(
                                market.yesProbability,
                                market.yesPrice
                              )}
                            </span>
                            {market.change === 0 ? (
                              <span className="font-mono text-xs xl:text-sm font-bold min-w-[60px] xl:min-w-[70px] text-center text-(--kwm-ink-dim) tabular-nums shrink-0">
                                —
                              </span>
                            ) : (
                              <div
                                className={cn(
                                  "flex items-center justify-center gap-0.5 font-mono text-xs xl:text-sm font-bold min-w-[60px] xl:min-w-[70px] px-2 py-0.5 rounded shrink-0",
                                  market.change > 0
                                    ? "text-(--kwm-up) bg-(--kwm-up-soft)"
                                    : "text-(--kwm-down) bg-(--kwm-down-soft)"
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
                        <div className="grid w-full grid-cols-2 items-center gap-2 lg:w-[240px]">
                          <OutcomeTradeButton
                            label="Yes"
                            price={market.yesPrice}
                            selected={
                              selectedMarketId === market.id &&
                              selectedOutcomeIndex === 0
                            }
                            accentClassName="border-(--kwm-up)"
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
                            accentClassName="border-(--kwm-down)"
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
                          className="bg-(--kwm-up) transition-[width] duration-300"
                          style={{
                            width: `${Math.max(0, Math.min(100, market.yesProbability))}%`,
                          }}
                        />
                        <span className="flex-1 bg-(--kwm-down)/40" />
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
                <div className="border-t border-(--kwm-hl)">
                  <button
                    type="button"
                    onClick={() => setShowClosedMarkets(!showClosedMarkets)}
                    className="w-full px-6 py-3 flex items-center justify-between bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-(--kwm-ink-3)">
                        Closed Markets
                      </span>
                      <span className="px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] font-semibold text-(--kwm-ink-3) border border-(--kwm-hl-2) tabular-nums">
                        {closedMarkets.length}
                      </span>
                    </div>
                    {showClosedMarkets ? (
                      <ChevronUp className="h-4 w-4 text-(--kwm-ink-3)" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-(--kwm-ink-3)" />
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
                            className="px-6 py-4 bg-(--kwm-bg-2) opacity-70"
                          >
                            <div className="flex items-center justify-between gap-4">
                              {/* Market Info */}
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-medium text-sm truncate text-(--kwm-ink-3)">
                                      {market.groupItemTitle}
                                    </h3>
                                    <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-muted text-(--kwm-ink-3) shrink-0">
                                      Closed
                                    </span>
                                    {userPositions.length > 0 && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] font-semibold text-(--kwm-ink-3) border border-(--kwm-hl-2) tabular-nums shrink-0">
                                        <User className="h-2.5 w-2.5" />
                                        {totalPositionSize.toFixed(1)}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-(--kwm-ink-3)">
                                    {formatVolume(market.volume)} Vol.
                                  </span>
                                </div>
                              </div>

                              {/* Result */}
                              <div className="flex items-center gap-3 shrink-0">
                                <div className="text-right">
                                  <span className="text-lg font-bold tabular-nums text-(--kwm-ink-3)">
                                    {formatProbability(
                                      market.yesProbability,
                                      market.yesPrice
                                    )}
                                  </span>
                                  <span className="text-xs text-(--kwm-ink-3) ml-1">
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
        </Card>
      </CollapsibleContent>

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
