"use client";

import {
  ChevronDown,
  ChevronUp,
  History,
  Info,
  LineChart,
  User,
  Users,
  Wifi,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useState } from "react";
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
import type { ConnectionState } from "@/hooks/use-shared-websocket";
import { useTopHolders } from "@/hooks/use-top-holders";
import type { Position } from "@/hooks/use-user-positions";
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

interface MarketData {
  id: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: string;
  noPrice: string;
  conditionId: string;
  groupItemTitle: string;
  image?: string;
  volume: string | number;
  yesProbability: number;
  change: number;
  closed?: boolean;
}

interface OutcomesTableProps {
  sortedMarketData: MarketData[];
  closedMarkets?: MarketData[];
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
  getMarketPosition: (market: {
    conditionId: string;
    yesTokenId: string;
    noTokenId: string;
  }) => Position | null;
  handlePriceClick: (price: number) => void;
  isSingleMarketEvent: boolean;
  onSellSuccess?: () => void;
}

interface MarketExpandedContentProps {
  isExpanded: boolean;
  userPosition: Position | null;
  market: {
    id: string;
    yesTokenId: string;
    noTokenId: string;
    yesPrice: string;
    noPrice: string;
    conditionId: string;
    groupItemTitle: string;
    image?: string;
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
  userPosition,
  market,
  marketOutcomes,
  selectedOutcomeIndex,
  setSelectedOutcomeIndex,
  handlePriceClick,
  isSingleMarketEvent,
  onSellPosition,
}: MarketExpandedContentProps) {
  // Use controlled tab state to ensure proper default selection
  const [activeTab, setActiveTab] = useState<string>(
    userPosition ? "position" : "orderbook"
  );

  // Track previous userPosition to detect changes
  const [hadPosition, setHadPosition] = useState<boolean>(!!userPosition);

  // Update active tab ONLY when userPosition status changes (appears or disappears)
  // This allows users to freely switch between tabs while they have a position
  useEffect(() => {
    const hasPosition = !!userPosition;

    if (hasPosition !== hadPosition) {
      // Position status changed
      if (hasPosition && !hadPosition) {
        // User just got a position - switch to position tab
        setActiveTab("position");
      } else if (!hasPosition && hadPosition) {
        // User just lost their position - switch to orderbook tab
        setActiveTab("orderbook");
      }
      setHadPosition(hasPosition);
    }
  }, [userPosition, hadPosition]);

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity,background-color] duration-300 ease-in-out border-b border-border/50 bg-muted/5",
        isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex items-center justify-between px-2 sm:px-6 border-b border-border/50 overflow-x-auto no-scrollbar">
            <TabsList className="h-auto p-0 bg-transparent gap-0 shrink-0 flex">
              {/* Position tab - only show if user has a position */}
              {userPosition && (
                <TabsTrigger
                  value="position"
                  className="h-auto flex-none px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs sm:text-sm font-medium"
                >
                  <User className="h-3.5 w-3.5 mr-2 inline-block" />
                  Position
                </TabsTrigger>
              )}
              <TabsTrigger
                value="orderbook"
                className="h-auto flex-none px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs sm:text-sm font-medium whitespace-nowrap"
              >
                <History className="h-3.5 w-3.5 mr-2 inline-block" />
                Order Book
              </TabsTrigger>
              {/* Only show Graph tab for multi-market events */}
              {!isSingleMarketEvent && (
                <TabsTrigger
                  value="graph"
                  className="h-auto flex-none px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs sm:text-sm font-medium"
                >
                  <LineChart className="h-3.5 w-3.5 mr-2 inline-block" />
                  Graph
                </TabsTrigger>
              )}
              {/* Top Holders Tab */}
              <TabsTrigger
                value="holders"
                className="h-auto flex-none px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs sm:text-sm font-medium"
              >
                <Users className="h-3.5 w-3.5 mr-2 inline-block" />
                Top Holders
              </TabsTrigger>
              <TabsTrigger
                value="resolution"
                className="h-auto flex-none px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs sm:text-sm font-medium"
              >
                <Info className="h-3.5 w-3.5 mr-2 inline-block" />
                Resolution
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Position Tab Content */}
          {userPosition && (
            <TabsContent value="position" className="m-0 px-6 py-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-2 md:gap-x-4 lg:gap-x-8 gap-y-4 flex-1">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">
                      Outcome
                    </span>
                    <span
                      className={cn(
                        "font-bold text-sm",
                        userPosition.outcome.toLowerCase() === "yes"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {userPosition.outcome}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">
                      Qty
                    </span>
                    <span className="font-bold text-sm tabular-nums">
                      {userPosition.size.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">
                      Avg Price
                    </span>
                    <span className="font-bold text-sm tabular-nums">
                      {(userPosition.avgPrice * 100).toFixed(1)}¢
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">
                      Value
                    </span>
                    <span className="font-bold text-sm tabular-nums">
                      ${userPosition.currentValue.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">
                      Cost
                    </span>
                    <span className="font-bold text-sm tabular-nums">
                      ${userPosition.initialValue.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">
                      Return
                    </span>
                    <span
                      className={cn(
                        "font-bold text-sm tabular-nums whitespace-nowrap",
                        userPosition.unrealizedPnl >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      ${Math.abs(userPosition.unrealizedPnl).toFixed(2)}
                      <span className="text-xs ml-1 opacity-80">
                        ({userPosition.unrealizedPnl >= 0 ? "+" : "-"}
                        {Math.abs(userPosition.unrealizedPnlPercent).toFixed(1)}
                        %)
                      </span>
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  className="shrink-0 w-full sm:w-auto font-bold shadow-lg shadow-rose-500/20 transition-[background-color,transform] duration-150 active:scale-95"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSellPosition(userPosition);
                  }}
                >
                  <span className="hidden lg:inline">Sell Position</span>
                  <span className="lg:hidden">Sell</span>
                </Button>
              </div>
            </TabsContent>
          )}

          {/* Order Book Tab Content */}
          <TabsContent
            value="orderbook"
            className="m-0 data-[state=inactive]:hidden"
            forceMount
          >
            <OrderBook
              outcomes={marketOutcomes}
              defaultOutcomeIndex={selectedOutcomeIndex}
              maxLevels={4}
              onPriceClick={handlePriceClick}
              onOutcomeChange={setSelectedOutcomeIndex}
              useWebSocket={false}
              embedded
            />
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
              />
            </TabsContent>
          )}

          {/* Top Holders Tab Content */}
          <TabsContent value="holders" className="m-0">
            <TopHoldersContent conditionId={market.conditionId} />
          </TabsContent>

          {/* Resolution Tab Content */}
          <TabsContent value="resolution" className="m-0 p-6">
            <div className="space-y-4 text-sm max-w-2xl">
              <div className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Info className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h4 className="font-bold mb-1">Resolution Source</h4>
                  <p className="text-muted-foreground leading-relaxed">
                    Official announcement or verified news reports from
                    established media organizations will be used to resolve this
                    market.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <History className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h4 className="font-bold mb-1">Resolution Rules</h4>
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
                        <div className="h-5 w-5 sm:h-6 sm:w-6 rounded-full bg-primary/10 flex items-center justify-center text-[8px] sm:text-[10px] font-bold text-primary border border-primary/20 shrink-0">
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
                        "px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold uppercase",
                        holder.outcomeIndex === 0
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
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

export function OutcomesTable({
  sortedMarketData,
  closedMarkets = [],
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
  getMarketPosition,
  handlePriceClick,
  isSingleMarketEvent,
  onSellSuccess,
}: OutcomesTableProps) {
  const [showClosedMarkets, setShowClosedMarkets] = useState(false);

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
      <Card className="py-0 gap-0 border-border/50 shadow-sm overflow-hidden">
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 px-6 bg-muted/20 border-b border-border/50 cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-lg">OUTCOME</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {sortedMarketData.length} market
                  {sortedMarketData.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {/* WebSocket connection indicator */}
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-background/50 border border-border/50 shadow-xs transition-colors duration-500">
                  <Wifi
                    className={cn(
                      "h-3 w-3",
                      isConnected
                        ? "text-emerald-500"
                        : connectionState === "connecting" ||
                            connectionState === "reconnecting"
                          ? "text-amber-500 animate-pulse"
                          : "text-muted-foreground"
                    )}
                  />
                  <span
                    className={cn(
                      "text-[10px] font-medium uppercase tracking-wider",
                      isConnected
                        ? "text-emerald-500"
                        : connectionState === "connecting" ||
                            connectionState === "reconnecting"
                          ? "text-amber-500"
                          : "text-muted-foreground"
                    )}
                  >
                    {isConnected
                      ? "Live"
                      : connectionState === "connecting"
                        ? "Connecting..."
                        : connectionState === "reconnecting"
                          ? "Reconnecting..."
                          : "Offline"}
                  </span>
                </div>
                {/* Collapse/Expand toggle icon */}
                <div className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent/50 transition-colors">
                  {isOutcomeTableExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  <span className="sr-only">
                    {isOutcomeTableExpanded ? "Collapse" : "Expand"} outcomes
                  </span>
                </div>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {sortedMarketData.map((market) => {
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
                const userPosition = getMarketPosition({
                  conditionId: market.conditionId,
                  yesTokenId: market.yesTokenId,
                  noTokenId: market.noTokenId,
                });

                return (
                  <div key={market.id}>
                    {/* Market Row Container - Using a div to avoid nested buttons */}
                    <div
                      className={cn(
                        "w-full flex flex-col lg:grid lg:grid-cols-[1fr_220px] transition-[background-color,border-color] duration-150 border-l-2",
                        selectedMarketId === market.id
                          ? "bg-primary/5 border-l-primary"
                          : "hover:bg-accent/30 border-l-transparent",
                        isExpanded && "bg-muted/30"
                      )}
                    >
                      {/* Left Side: Market Info (Clickable to expand) */}
                      <button
                        type="button"
                        className="flex-1 text-left px-6 py-4 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 group"
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
                              {market.image && (
                                <div className="relative w-10 h-10 shrink-0 mt-0.5">
                                  <Image
                                    src={market.image}
                                    alt={market.groupItemTitle || "Market"}
                                    fill
                                    sizes="40px"
                                    className="rounded object-cover ring-1 ring-border/20 shadow-xs"
                                  />
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-bold text-sm leading-tight text-foreground group-hover:text-primary transition-colors">
                                    {market.groupItemTitle}
                                  </h3>
                                  {userPosition && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 shrink-0">
                                      <User className="h-2.5 w-2.5" />
                                      {userPosition.size.toFixed(1)}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] font-bold text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">
                                    {formatVolume(market.volume)} VOL
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
                              <span className="text-xl font-black tabular-nums leading-none">
                                {market.yesProbability}%
                              </span>
                              <div
                                className={cn(
                                  "text-[10px] font-bold mt-1.5 px-1.5 py-0.5 rounded tabular-nums",
                                  market.change >= 0
                                    ? "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400"
                                    : "text-rose-600 bg-rose-500/10 dark:text-rose-400"
                                )}
                              >
                                {market.change >= 0 ? "+" : ""}
                                {market.change}%
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Desktop Layout Section (lg+) */}
                        <div className="hidden lg:grid lg:grid-cols-[1fr_140px] lg:items-center lg:gap-4">
                          {/* Column 1: Image + Title + Volume */}
                          <div className="flex items-center gap-3 min-w-0">
                            {market.image && (
                              <div className="relative w-10 h-10 shrink-0">
                                <Image
                                  src={market.image}
                                  alt={market.groupItemTitle || "Market"}
                                  fill
                                  sizes="40px"
                                  className="rounded object-cover ring-1 ring-border/20 shadow-xs"
                                />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-sm xl:text-base truncate group-hover:text-primary transition-colors">
                                  {market.groupItemTitle}
                                </h3>
                                {userPosition && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 shrink-0">
                                    <User className="h-2.5 w-2.5" />
                                    {userPosition.size.toFixed(1)}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-xs xl:text-sm text-muted-foreground mt-0.5">
                                <span className="font-medium">
                                  {formatVolume(market.volume)} Vol.
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
                            <span className="text-xl xl:text-2xl font-black tabular-nums min-w-[50px] xl:min-w-[55px] text-right">
                              {market.yesProbability}%
                            </span>
                            <div
                              className={cn(
                                "flex items-center justify-center text-xs xl:text-sm font-bold min-w-[60px] xl:min-w-[70px] px-2 py-0.5 rounded shrink-0",
                                market.change >= 0
                                  ? "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400"
                                  : "text-rose-600 bg-rose-500/10 dark:text-rose-400"
                              )}
                            >
                              <span className="tabular-nums whitespace-nowrap">
                                {market.change >= 0 ? "+" : ""}
                                {market.change}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>

                      {/* Right Side: Trading Buttons (Not nested in expansion button) */}
                      <div className="px-6 pb-4 lg:pb-0 lg:pr-6 lg:pl-0 flex items-center justify-center">
                        <div className="grid grid-cols-2 lg:flex items-center gap-2 w-full lg:w-auto">
                          <Button
                            type="button"
                            size="sm"
                            className={cn(
                              "h-9 px-3 text-xs lg:w-[100px] lg:h-10 lg:text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-lg shadow-emerald-500/20 transition-[background-color,transform] duration-150 active:scale-95",
                              isExpanded &&
                                selectedOutcomeIndex === 0 &&
                                "ring-2 ring-emerald-400 ring-offset-2"
                            )}
                            onClick={() => {
                              setExpandedOrderBookMarketId(market.id);
                              setSelectedMarketId(market.id);
                              setSelectedOutcomeIndex(0);
                              void preloadOrderBook(market.yesTokenId);
                            }}
                          >
                            <span className="lg:hidden xl:inline">Buy </span>
                            Yes {formatPrice(market.yesPrice)}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className={cn(
                              "h-9 px-3 text-xs lg:w-[100px] lg:h-10 lg:text-sm font-bold shadow-lg shadow-rose-500/20 transition-[background-color,transform] duration-150 active:scale-95",
                              isExpanded &&
                                selectedOutcomeIndex === 1 &&
                                "ring-2 ring-rose-400 ring-offset-2"
                            )}
                            onClick={() => {
                              setExpandedOrderBookMarketId(market.id);
                              setSelectedMarketId(market.id);
                              setSelectedOutcomeIndex(1);
                              void preloadOrderBook(market.noTokenId);
                            }}
                          >
                            <span className="lg:hidden xl:inline">Buy </span>
                            No {formatPrice(market.noPrice)}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Content - Order Book, Graph, Top Holders, Resolution Tabs */}
                    <MarketExpandedContent
                      isExpanded={isExpanded}
                      userPosition={userPosition}
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
                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-muted text-muted-foreground">
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
                        const userPosition = getMarketPosition({
                          conditionId: market.conditionId,
                          yesTokenId: market.yesTokenId,
                          noTokenId: market.noTokenId,
                        });

                        return (
                          <div
                            key={market.id}
                            className="px-6 py-4 bg-muted/10 opacity-70"
                          >
                            <div className="flex items-center justify-between gap-4">
                              {/* Market Info */}
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                {market.image && (
                                  <div className="relative w-8 h-8 shrink-0">
                                    <Image
                                      src={market.image}
                                      alt={market.groupItemTitle || "Market"}
                                      fill
                                      sizes="32px"
                                      className="rounded object-cover ring-1 ring-border/20 grayscale"
                                    />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-medium text-sm truncate text-muted-foreground">
                                      {market.groupItemTitle}
                                    </h3>
                                    <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-muted text-muted-foreground shrink-0">
                                      Closed
                                    </span>
                                    {userPosition && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 shrink-0">
                                        <User className="h-2.5 w-2.5" />
                                        {userPosition.size.toFixed(1)}
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
