"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Bookmark,
  ChevronLeft,
  Clock,
  Copy,
  Share2,
  TrendingUp,
  Trophy,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Navbar } from "@/components/navbar";
import { PageBackground } from "@/components/page-background";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMarketDetail } from "@/hooks/use-market-detail";
import {
  useOrderBook as useOrderBookFromStore,
  useOrderBookStore,
} from "@/hooks/use-orderbook-store";
import { usePriceAlertDetection } from "@/hooks/use-price-alerts";
import { useOrderBookWebSocket } from "@/hooks/use-shared-websocket";
import { formatPrice, formatVolume } from "@/lib/formatters";
import type { OutcomeData } from "@/types/market";

// Lazy load heavy components - they're code-split into separate chunks
const MarketPriceChart = dynamic(
  () =>
    import("@/components/market-price-chart").then((mod) => ({
      default: mod.MarketPriceChart,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
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

const TradingForm = dynamic(
  () =>
    import("@/components/trading-form").then((mod) => ({
      default: mod.TradingForm,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="sticky top-4 w-full">
        <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    ),
  }
);

interface MarketDetailTradingOrderBookSnapshot {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  min_order_size: string;
  tick_size: string;
}

/** Gamma API stores some fields as JSON strings; malformed data must not crash the page. */
function safeParseStringArray(
  raw: string | undefined,
  field: string,
  marketLabel: string
): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    console.warn(`Failed to parse ${field} for market ${marketLabel}:`, raw);
    return [];
  }
}

function numberArraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, idx) => value === b[idx]);
}

export default function MarketDetailClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [outcomeRangeChanges, setOutcomeRangeChanges] = useState<number[]>([]);
  // Track if order book is shown (only used when > 1 outcome)
  const [showOrderBook, setShowOrderBook] = useState(false);

  // Fetch market details with TanStack Query (slug-based only, as recommended by API team)
  const { data: market, isLoading: loading, error } = useMarketDetail(slug);

  // Extract asset IDs for price alert monitoring
  const assetIds = React.useMemo(() => {
    if (!market) return [];
    const tokens = market.tokens || [];

    const clobTokenIds = safeParseStringArray(
      market.clobTokenIds,
      "clobTokenIds",
      market.slug || market.id || "?"
    );

    // Prefer token IDs from tokens array, fallback to clobTokenIds
    if (tokens.length > 0) {
      return tokens.map((t) => t.token_id).filter(Boolean);
    }
    return clobTokenIds.filter(Boolean);
  }, [market]);

  // Enable price alert detection for this market's assets
  usePriceAlertDetection(assetIds);

  const setOrderBookFromRest = useOrderBookStore((s) => s.setOrderBookFromRest);

  // Handle order success - must be at top level before any early returns
  const handleOrderSuccess = useCallback((_order: unknown) => {
    // console.log("Order placed successfully:", order);
    // Could add toast notification here
  }, []);

  // Handle order error
  const handleOrderError = useCallback((_err: Error) => {
    // console.error("Order failed:", err);
    // Could add toast notification here
  }, []);

  // Handle price click from order book
  const handlePriceClick = useCallback((_price: number) => {
    // This could be used to set the price in the trading form
    // console.log("Price clicked:", price);
  }, []);

  const outcomes = useMemo<string[]>(() => {
    if (!market?.outcomes) return [];
    return safeParseStringArray(
      market.outcomes,
      "outcomes",
      market.slug || market.id || "?"
    );
  }, [market?.outcomes, market?.slug, market?.id]);

  const prices = useMemo<string[]>(() => {
    if (!market?.outcomePrices) return [];
    return safeParseStringArray(
      market.outcomePrices,
      "outcomePrices",
      market.slug || market.id || "?"
    );
  }, [market?.outcomePrices, market?.slug, market?.id]);

  const handleOutcomeRangeChanges = useCallback((changes: number[]) => {
    setOutcomeRangeChanges((prev) =>
      numberArraysEqual(prev, changes) ? prev : changes
    );
  }, []);

  const outcomeData = useMemo(() => {
    const volume = market?.volumeNum || market?.volume || 0;
    return outcomes.map((outcome: string, idx: number) => {
      const price = prices[idx] ? Number.parseFloat(prices[idx]) : 0;
      const probability = (price * 100).toFixed(0);
      const change = outcomeRangeChanges[idx] ?? 0;
      return {
        name: outcome,
        probability: Number.parseInt(probability, 10),
        change,
        volume,
        color:
          idx === 0
            ? "orange"
            : idx === 1
              ? "blue"
              : idx === 2
                ? "purple"
                : "green",
      };
    });
  }, [
    market?.volume,
    market?.volumeNum,
    outcomeRangeChanges,
    outcomes,
    prices,
  ]);

  const tradingOutcomes = useMemo<OutcomeData[]>(() => {
    const tokens = market?.tokens || [];
    const clobTokenIds = safeParseStringArray(
      market?.clobTokenIds,
      "clobTokenIds",
      market?.slug || market?.id || "?"
    );

    return outcomes.map((outcome: string, idx: number) => {
      const price = prices[idx] ? Number.parseFloat(prices[idx]) : 0.5;

      let tokenId = "";
      if (tokens.length > 0) {
        const token = tokens.find(
          (t) => t.outcome?.toLowerCase() === outcome.toLowerCase()
        );
        tokenId = token?.token_id || "";
      }
      if (!tokenId && clobTokenIds.length > 0) {
        tokenId = clobTokenIds[idx] || "";
      }

      return {
        name: outcome,
        tokenId,
        price,
        probability: price * 100,
      };
    });
  }, [
    market?.clobTokenIds,
    market?.id,
    market?.slug,
    market?.tokens,
    outcomes,
    prices,
  ]);

  // Prepare token info for the chart
  const chartColors = [
    "hsl(25, 95%, 53%)", // Orange
    "hsl(221, 83%, 53%)", // Blue
    "hsl(280, 100%, 70%)", // Purple/Pink
    "hsl(142, 76%, 36%)", // Green
  ];
  const chartTokens = tradingOutcomes.map((outcome, idx) => ({
    tokenId: outcome.tokenId,
    name: outcome.name,
    color: chartColors[idx % chartColors.length],
  }));

  const currentTokenId = tradingOutcomes[selectedOutcome]?.tokenId || "";

  const { data: orderBookData } =
    useQuery<MarketDetailTradingOrderBookSnapshot | null>({
      queryKey: ["marketDetailTradingOrderBook", currentTokenId],
      queryFn:
        async (): Promise<MarketDetailTradingOrderBookSnapshot | null> => {
          if (!currentTokenId) return null;

          const response = await fetch(
            `https://clob.polymarket.com/book?token_id=${currentTokenId}`,
            { headers: { Accept: "application/json" } }
          );
          if (!response.ok) return null;

          const data = (await response.json()) as {
            bids?: Array<{ price: string; size: string }>;
            asks?: Array<{ price: string; size: string }>;
            min_order_size?: string;
            tick_size?: string;
          };

          return {
            bids: data.bids || [],
            asks: data.asks || [],
            min_order_size: data.min_order_size || "1",
            tick_size: data.tick_size || "0.01",
          };
        },
      enabled: !!currentTokenId,
      staleTime: 30000,
    });

  useEffect(() => {
    if (orderBookData && currentTokenId) {
      setOrderBookFromRest(
        currentTokenId,
        orderBookData.bids || [],
        orderBookData.asks || []
      );
    }
  }, [currentTokenId, orderBookData, setOrderBookFromRest]);

  const websocketAssetIds = useMemo(
    () => (currentTokenId ? [currentTokenId] : []),
    [currentTokenId]
  );
  const { isConnected } = useOrderBookWebSocket(websocketAssetIds);

  const storeOrderBook = useOrderBookFromStore(currentTokenId);

  const { bestBid, bestAsk, tickSize, minOrderSize, orderBook } =
    useMemo(() => {
      const marketMinOrderSize =
        Number.parseFloat(
          String(market?.orderMinSize ?? market?.order_min_size ?? "1")
        ) || 1;

      if (storeOrderBook) {
        return {
          bestBid: storeOrderBook.bestBid ?? undefined,
          bestAsk: storeOrderBook.bestAsk ?? undefined,
          tickSize: orderBookData?.tick_size
            ? Number.parseFloat(orderBookData.tick_size)
            : 0.01,
          minOrderSize: orderBookData?.min_order_size
            ? Math.max(
                marketMinOrderSize,
                Number.parseFloat(orderBookData.min_order_size) || 1
              )
            : marketMinOrderSize,
          orderBook: {
            bids: storeOrderBook.bids,
            asks: storeOrderBook.asks,
          },
        };
      }

      if (!orderBookData) {
        return {
          bestBid: undefined,
          bestAsk: undefined,
          tickSize: 0.01,
          minOrderSize: marketMinOrderSize,
          orderBook: undefined,
        };
      }

      const bids = orderBookData.bids || [];
      const asks = orderBookData.asks || [];
      const sortedBids = [...bids].sort(
        (a, b) => Number.parseFloat(b.price) - Number.parseFloat(a.price)
      );
      const sortedAsks = [...asks].sort(
        (a, b) => Number.parseFloat(a.price) - Number.parseFloat(b.price)
      );

      return {
        bestBid: sortedBids[0]
          ? Number.parseFloat(sortedBids[0].price)
          : undefined,
        bestAsk: sortedAsks[0]
          ? Number.parseFloat(sortedAsks[0].price)
          : undefined,
        tickSize: orderBookData.tick_size
          ? Number.parseFloat(orderBookData.tick_size)
          : 0.01,
        minOrderSize: Math.max(
          marketMinOrderSize,
          orderBookData.min_order_size
            ? Number.parseFloat(orderBookData.min_order_size) || 1
            : 1
        ),
        orderBook: { bids, asks },
      };
    }, [
      market?.orderMinSize,
      market?.order_min_size,
      orderBookData,
      storeOrderBook,
    ]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
        <PageBackground />
        <Navbar />
        <main className="px-4 md:px-6 lg:px-8 py-8 space-y-8">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-2"
          >
            <Skeleton className="h-10 w-32" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.05 }}
            className="space-y-4"
          >
            <div className="flex items-start gap-4">
              <Skeleton className="w-20 h-20 rounded-lg shrink-0" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-4 w-full max-w-3xl" />
                <div className="flex gap-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-28" />
                </div>
              </div>
            </div>
          </motion.div>
          <Skeleton className="h-px w-full" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: 0.1 }}
              className="lg:col-span-2"
            >
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-48" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-[350px] w-full" />
                </CardContent>
              </Card>
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: 0.15 }}
            >
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-4 w-40" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Skeleton className="h-10 flex-1" />
                    <Skeleton className="h-10 flex-1" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                  <Skeleton className="h-px w-full" />
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                      <div className="flex justify-between">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    </div>
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.2 }}
          >
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
          </motion.div>
        </main>
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
        <PageBackground />
        <Navbar />
        <main className="px-4 md:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>All Markets</span>
            </button>
          </div>
          <Card className="text-center py-12">
            <CardHeader>
              <CardTitle>Market Not Found</CardTitle>
              <CardDescription>
                {error?.message || "Unable to load market"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => router.push("/")}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back to Markets
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
      <PageBackground />
      <Navbar />
      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="relative z-10 px-4 md:px-6 lg:px-8 py-6 space-y-6"
      >
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>All Markets</span>
          </button>
          <span>/</span>
          <span className="text-foreground font-medium truncate max-w-[200px] sm:max-w-none">
            {market.question}
          </span>
        </div>

        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-4 flex-1">
            {market.image && (
              <div className="relative w-16 h-16 md:w-20 md:h-20 shrink-0">
                <Image
                  src={market.image}
                  alt={market.question}
                  fill
                  sizes="80px"
                  className="rounded-xl object-cover"
                />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold mb-2">
                {market.question}
              </h1>

              {/* Metadata */}
              <div className="flex flex-wrap items-center gap-3 md:gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1 rounded-full">
                  <Trophy className="h-4 w-4" />
                  <span className="font-medium">
                    {formatVolume(market.volumeNum || market.volume)} Vol.
                  </span>
                </div>
                {market.end_date_iso && (
                  <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1 rounded-full">
                    <Clock className="h-4 w-4" />
                    <span>
                      {new Date(market.end_date_iso).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        }
                      )}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1 rounded-full">
                  <span className="font-medium">
                    {outcomes.length} outcomes
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={async () => {
                if (typeof window !== "undefined" && navigator.share) {
                  try {
                    await navigator.share({
                      title: market.question,
                      url: window.location.href,
                    });
                    posthog.capture("market_shared", {
                      market_slug: slug,
                      market_question: market.question,
                      share_method: "native_share",
                    });
                  } catch (err) {
                    // User cancelled or share failed - ignore
                    if ((err as Error).name !== "AbortError") {
                      console.error("Share failed:", err);
                    }
                  }
                }
              }}
            >
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">Share</span>
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-2">
              <Bookmark className="h-4 w-4" />
              <span className="hidden sm:inline">Save</span>
            </Button>
          </div>
        </div>

        {/* Date Selection Pills - Mock for now */}
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <div className="flex gap-2 overflow-x-auto">
            <Badge variant="default" className="shrink-0">
              Dec 10
            </Badge>
            <Badge variant="outline" className="shrink-0">
              Jan 28, 2026
            </Badge>
            <Badge variant="outline" className="shrink-0">
              Mar 18, 2026
            </Badge>
          </div>
        </div>

        {/* Probability Legend */}
        <div className="flex flex-wrap gap-4">
          {outcomeData.map(
            (
              outcome: { name: string; probability: number; color: string },
              idx: number
            ) => (
              <div key={idx} className="flex items-center gap-2">
                <div
                  className={`w-3 h-3 rounded-full ${
                    outcome.color === "orange"
                      ? "bg-orange-500"
                      : outcome.color === "blue"
                        ? "bg-blue-500"
                        : outcome.color === "purple"
                          ? "bg-purple-400"
                          : "bg-green-500"
                  }`}
                />
                <span className="text-sm">
                  {outcome.name} {outcome.probability}%
                </span>
              </div>
            )
          )}
        </div>

        {/* Main Content: Chart + Trading Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart Section - Left Side (2/3 width) */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardContent className="pt-6">
                <ErrorBoundary name="Market Price Chart">
                  <MarketPriceChart
                    tokens={chartTokens}
                    outcomes={outcomes}
                    outcomePrices={prices.map((p: string) => p.toString())}
                    onOutcomeRangeChanges={handleOutcomeRangeChanges}
                  />
                </ErrorBoundary>
              </CardContent>
            </Card>

            {/* Order Book - Always visible only for single outcome markets */}
            {tradingOutcomes.length === 1 && (
              <ErrorBoundary name="Order Book">
                <OrderBook
                  outcomes={tradingOutcomes.map((o) => ({
                    name: o.name,
                    tokenId: o.tokenId,
                    price: o.price,
                  }))}
                  defaultOutcomeIndex={selectedOutcome}
                  maxLevels={5}
                  onPriceClick={handlePriceClick}
                  onOutcomeChange={(index) => setSelectedOutcome(index)}
                  defaultCollapsed={false}
                />
              </ErrorBoundary>
            )}
          </div>

          {/* Trading Panel - Right Side (1/3 width) */}
          <div className="lg:col-span-1">
            {/* Trading Form with Merged Header */}
            <ErrorBoundary name="Trading Form">
              <TradingForm
                marketTitle={market.question}
                tokenId={currentTokenId}
                outcomes={tradingOutcomes}
                selectedOutcomeIndex={selectedOutcome}
                onOutcomeChange={setSelectedOutcome}
                negRisk={market.negRisk}
                tickSize={tickSize}
                minOrderSize={minOrderSize}
                bestBid={bestBid}
                bestAsk={bestAsk}
                orderBook={orderBook}
                onOrderSuccess={handleOrderSuccess}
                onOrderError={handleOrderError}
                marketImage={market.image}
                yesProbability={
                  market.bestAsk ? Math.round(market.bestAsk * 100) : undefined
                }
                isLiveData={isConnected}
                conditionId={market.conditionId}
              />
            </ErrorBoundary>
          </div>
        </div>

        {/* Outcomes List */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">OUTCOME</h2>
          <div className="space-y-3">
            {outcomeData.map((outcome, idx: number) => (
              <Card key={idx}>
                <CardContent className="p-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Left: Outcome info */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{outcome.name}</h3>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-bold">
                            {outcome.probability}%
                          </span>
                          <div
                            className={`flex items-center gap-1 text-sm ${
                              outcome.change >= 0
                                ? "text-green-500"
                                : "text-red-500"
                            }`}
                          >
                            <TrendingUp
                              className={`h-4 w-4 ${
                                outcome.change < 0 ? "rotate-180" : ""
                              }`}
                            />
                            <span>
                              {outcome.change >= 0 ? "+" : ""}
                              {outcome.change}%
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{formatVolume(outcome.volume)} Vol.</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() =>
                              copyToClipboard(formatVolume(outcome.volume))
                            }
                            aria-label="Copy volume"
                          >
                            <Copy className="h-3 w-3" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Right: Action buttons */}
                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        size="lg"
                        className={`bg-green-600 hover:bg-green-700 text-white min-w-[120px] transition-[background-color,box-shadow] duration-150 ${
                          showOrderBook && selectedOutcome === idx
                            ? "ring-2 ring-green-400 ring-offset-2 ring-offset-background"
                            : ""
                        }`}
                        onClick={() => {
                          if (showOrderBook && selectedOutcome === idx) {
                            setShowOrderBook(false);
                          } else {
                            setSelectedOutcome(idx);
                            setShowOrderBook(true);
                          }
                        }}
                      >
                        Yes {formatPrice(prices[idx] || "0")}¢
                      </Button>
                      <Button
                        type="button"
                        size="lg"
                        variant="destructive"
                        className={`min-w-[120px] transition-[background-color,box-shadow] duration-150 ${
                          showOrderBook && selectedOutcome === idx
                            ? "ring-2 ring-red-400 ring-offset-2 ring-offset-background"
                            : ""
                        }`}
                        onClick={() => {
                          if (showOrderBook && selectedOutcome === idx) {
                            setShowOrderBook(false);
                          } else {
                            setSelectedOutcome(idx);
                            setShowOrderBook(true);
                          }
                        }}
                      >
                        No{" "}
                        {formatPrice(
                          (1 - Number.parseFloat(prices[idx] || "0")).toString()
                        )}
                        ¢
                      </Button>
                    </div>
                  </div>

                  {/* Order Book - Shown below this outcome when clicked (only for > 1 outcomes) */}
                  {showOrderBook &&
                    selectedOutcome === idx &&
                    tradingOutcomes.length > 1 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="mt-4 pt-4 border-t border-border"
                      >
                        <OrderBook
                          outcomes={tradingOutcomes.map((o) => ({
                            name: o.name,
                            tokenId: o.tokenId,
                            price: o.price,
                          }))}
                          defaultOutcomeIndex={selectedOutcome}
                          maxLevels={4}
                          onPriceClick={handlePriceClick}
                          onOutcomeChange={(index) => setSelectedOutcome(index)}
                          defaultCollapsed={false}
                          embedded
                        />
                      </motion.div>
                    )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Trading Notice */}
          <p className="text-sm text-muted-foreground text-center pt-4">
            Trading functionality coming soon. Connect your wallet to get
            started.
          </p>
        </div>

        {/* Related Markets Section */}
        <Card>
          <CardContent className="pt-6">
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="w-full justify-start h-auto p-1 bg-transparent border-b rounded-none">
                <TabsTrigger
                  value="all"
                  className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none bg-transparent"
                >
                  All
                </TabsTrigger>
                <TabsTrigger
                  value="politics"
                  className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none bg-transparent"
                >
                  Politics
                </TabsTrigger>
                <TabsTrigger
                  value="trump"
                  className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none bg-transparent"
                >
                  Trump
                </TabsTrigger>
                <TabsTrigger
                  value="fed-rates"
                  className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none bg-transparent"
                >
                  Fed Rates
                </TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Mock Related Market Cards */}
                  {[
                    {
                      title: "Fed rate hike in 2025?",
                      probability: "1%",
                      image: market.image,
                    },
                    {
                      title: "Will 2 Fed rate cuts happen in 2026?",
                      probability: "25%",
                      image: market.image,
                    },
                    {
                      title: "Fed emergency rate cut in 2025?",
                      probability: "3%",
                      image: market.image,
                    },
                  ].map((relatedMarket) => (
                    <Card
                      key={relatedMarket.title}
                      className="cursor-pointer hover:bg-accent/50 transition-colors"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          {relatedMarket.image && (
                            <div className="relative w-12 h-12 shrink-0">
                              <Image
                                src={relatedMarket.image}
                                alt={relatedMarket.title}
                                fill
                                sizes="48px"
                                className="rounded object-cover"
                              />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-sm mb-2 line-clamp-2">
                              {relatedMarket.title}
                            </h4>
                            <div className="text-2xl font-bold text-primary">
                              {relatedMarket.probability}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="politics" className="mt-6">
                <div className="text-center py-8 text-muted-foreground">
                  No related markets in Politics
                </div>
              </TabsContent>

              <TabsContent value="trump" className="mt-6">
                <div className="text-center py-8 text-muted-foreground">
                  No related markets in Trump
                </div>
              </TabsContent>

              <TabsContent value="fed-rates" className="mt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    {
                      title: "Fed rate hike in 2025?",
                      probability: "1%",
                      image: market.image,
                    },
                    {
                      title: "Will 2 Fed rate cuts happen in 2026?",
                      probability: "25%",
                      image: market.image,
                    },
                    {
                      title: "Fed emergency rate cut in 2025?",
                      probability: "3%",
                      image: market.image,
                    },
                  ].map((relatedMarket) => (
                    <Card
                      key={relatedMarket.title}
                      className="cursor-pointer hover:bg-accent/50 transition-colors"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          {relatedMarket.image && (
                            <div className="relative w-12 h-12 shrink-0">
                              <Image
                                src={relatedMarket.image}
                                alt={relatedMarket.title}
                                fill
                                sizes="48px"
                                className="rounded object-cover"
                              />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-sm mb-2 line-clamp-2">
                              {relatedMarket.title}
                            </h4>
                            <div className="text-2xl font-bold text-primary">
                              {relatedMarket.probability}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </motion.main>
    </div>
  );
}
