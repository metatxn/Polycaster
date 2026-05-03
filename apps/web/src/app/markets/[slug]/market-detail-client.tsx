"use client";

import { createLogger } from "@knoww/logger";
import { fetchClobOrderBook } from "@knoww/shared-types/clob";
import { parseGammaStringArray } from "@knoww/shared-types/polymarket";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CLOB_BASE_URL } from "@/constants/polymarket";
import { useMarketDetail } from "@/hooks/use-market-detail";
import {
  useOrderBook as useOrderBookFromStore,
  useOrderBookStore,
} from "@/hooks/use-orderbook-store";
import { usePriceAlertDetection } from "@/hooks/use-price-alerts";
import { useOrderBookWebSocket } from "@/hooks/use-shared-websocket";
import { formatPrice, formatVolume } from "@/lib/formatters";
import type { OutcomeData } from "@/types/market";

const log = createLogger("market-detail");

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
function parseGammaStringArrayWithLog(
  raw: string | undefined,
  field: string,
  marketLabel: string
): string[] {
  return parseGammaStringArray(raw, {
    field,
    label: marketLabel,
    onError: ({ field: failedField, label, raw: failedRaw, error }) => {
      log.warn("field.parse_failed", {
        field: failedField,
        marketLabel: label,
        raw: failedRaw,
        error,
      });
    },
  });
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

    const clobTokenIds = parseGammaStringArrayWithLog(
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
    return parseGammaStringArrayWithLog(
      market.outcomes,
      "outcomes",
      market.slug || market.id || "?"
    );
  }, [market?.outcomes, market?.slug, market?.id]);

  const prices = useMemo<string[]>(() => {
    if (!market?.outcomePrices) return [];
    return parseGammaStringArrayWithLog(
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
    const clobTokenIds = parseGammaStringArrayWithLog(
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

  // Shared queryKey `["orderBook", tokenId]` — same as the <OrderBook>
  // component and the sell-position modal. React Query dedupes across all
  // concurrent consumers so this mounting-at-the-same-time-as-<OrderBook>
  // produces ONE network request, not N. The first queryFn to register wins;
  // the others just read from the shared cache entry. Keep this queryFn
  // returning the richer shape (tick_size + min_order_size) so downstream
  // consumers that need those fields get them even when the shared cache
  // entry was seeded by another call site.
  const { data: orderBookData } =
    useQuery<MarketDetailTradingOrderBookSnapshot | null>({
      queryKey: ["orderBook", currentTokenId],
      queryFn:
        async (): Promise<MarketDetailTradingOrderBookSnapshot | null> => {
          if (!currentTokenId) return null;

          try {
            const data = await fetchClobOrderBook(currentTokenId, {
              host: CLOB_BASE_URL,
            });

            return {
              bids: data.bids,
              asks: data.asks,
              min_order_size: data.min_order_size || "1",
              tick_size: data.tick_size || "0.01",
            };
          } catch {
            return null;
          }
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
      <div className="min-h-screen bg-background relative overflow-x-hidden selection:bg-foreground/15">
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
      <div className="min-h-screen bg-background relative overflow-x-hidden selection:bg-foreground/15">
        <Navbar />
        <main className="relative z-10 px-4 md:px-6 lg:px-8 py-6 space-y-8">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground flex-wrap">
            <button
              type="button"
              onClick={() => router.push("/markets")}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Markets</span>
            </button>
          </div>

          <div className="py-16 border-y border-border/40">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-4">
              §&nbsp;&nbsp;Not Found
            </p>
            <p className="kw-editorial italic text-2xl md:text-3xl leading-snug text-foreground max-w-xl mb-3">
              This market couldn&apos;t be loaded.
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80 mb-8">
              {error?.message || "Unable to load market"}
            </p>
            <button
              type="button"
              onClick={() => router.push("/markets")}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border hover:decoration-foreground/60"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Back to Markets</span>
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden selection:bg-foreground/15">
      <Navbar />
      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="relative z-10 px-4 md:px-6 lg:px-8 py-6 space-y-6"
      >
        {/* Breadcrumb Navigation — editorial mono-caps */}
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground flex-wrap">
          <button
            type="button"
            onClick={() => router.push("/markets")}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Markets</span>
          </button>
          <span className="text-border/80">&rsaquo;</span>
          <span className="text-foreground truncate max-w-[240px] sm:max-w-md normal-case tracking-normal font-sans">
            {market.question}
          </span>
        </div>

        {/* Header Section — editorial hero */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            {market.image && (
              <div className="relative w-16 h-16 md:w-20 md:h-20 shrink-0 border border-border/60">
                <Image
                  src={market.image}
                  alt={market.question}
                  fill
                  sizes="80px"
                  className="rounded-sm object-cover"
                />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <h1 className="font-editorial italic font-medium text-3xl md:text-4xl lg:text-5xl leading-[1.05] tracking-tight text-foreground mb-3 wrap-break-word">
                {market.question}
              </h1>

              {/* Metadata strip — mono-caps inline, no pills */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Trophy className="h-3 w-3" />
                  <span className="tabular-nums text-foreground">
                    {formatVolume(market.volumeNum || market.volume)}
                  </span>
                  <span>Vol</span>
                </span>
                {market.end_date_iso && (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    <span className="tabular-nums">
                      {new Date(market.end_date_iso).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        }
                      )}
                    </span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <span className="tabular-nums text-foreground">
                    {outcomes.length}
                  </span>
                  <span>{outcomes.length === 1 ? "Outcome" : "Outcomes"}</span>
                </span>
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
                      log.error("share.failed", { error: err });
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

        {/* Date Selection — editorial inline with underline-active */}
        <div className="flex items-center gap-4 overflow-x-auto scrollbar-hide">
          <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {[
            { label: "Dec 10", active: true },
            { label: "Jan 28, 2026", active: false },
            { label: "Mar 18, 2026", active: false },
          ].map((date) => (
            <button
              key={date.label}
              type="button"
              className={`relative shrink-0 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] tabular-nums transition-colors ${
                date.active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {date.label}
              {date.active && (
                <span className="absolute inset-x-0 -bottom-px h-px bg-foreground" />
              )}
            </button>
          ))}
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
                  className={`w-1.5 h-1.5 rounded-full ${
                    outcome.color === "orange"
                      ? "bg-amber-500"
                      : outcome.color === "blue"
                        ? "bg-emerald-500"
                        : outcome.color === "purple"
                          ? "bg-foreground/60"
                          : "bg-foreground"
                  }`}
                />
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {outcome.name}{" "}
                  <span className="tabular-nums text-foreground font-semibold">
                    {outcome.probability}%
                  </span>
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
              <CardContent className="py-3">
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
                  onPriceClick={handlePriceClick}
                  onOutcomeChange={(index) => setSelectedOutcome(index)}
                  defaultCollapsed={false}
                  scrollable
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

        {/* Outcomes List — editorial hairline rows */}
        <div className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground/60">§</span>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground">
              Outcome
            </h2>
          </div>
          <div className="border-t border-border/40">
            {outcomeData.map((outcome, idx: number) => {
              const isActive = showOrderBook && selectedOutcome === idx;
              const yesPrice = formatPrice(prices[idx] || "0");
              const noPrice = formatPrice(
                (1 - Number.parseFloat(prices[idx] || "0")).toString()
              );
              return (
                <div key={idx} className="border-b border-border/40">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 py-4">
                    {/* Left: Outcome info */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <h3 className="font-medium text-base leading-tight">
                        {outcome.name}
                      </h3>
                      <div className="flex items-baseline gap-4 flex-wrap">
                        <span className="font-mono tabular-nums text-2xl font-semibold text-foreground leading-none">
                          {outcome.probability}%
                        </span>
                        <div
                          className={`inline-flex items-center gap-1 font-mono text-[11px] tabular-nums ${
                            outcome.change >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          <TrendingUp
                            className={`h-3 w-3 ${
                              outcome.change < 0 ? "rotate-180" : ""
                            }`}
                          />
                          <span>
                            {outcome.change >= 0 ? "+" : ""}
                            {outcome.change}%
                          </span>
                        </div>
                        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                          {formatVolume(outcome.volume)} Vol
                        </span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() =>
                            copyToClipboard(formatVolume(outcome.volume))
                          }
                          aria-label="Copy volume"
                        >
                          <Copy className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {/* Right: Editorial Yes/No CTAs */}
                    <div className="flex items-stretch gap-2 shrink-0">
                      <button
                        type="button"
                        className={`relative min-w-[110px] h-11 px-4 border transition-colors font-mono text-[11px] uppercase tracking-[0.16em] font-semibold ${
                          isActive
                            ? "border-emerald-600 dark:border-emerald-400 text-emerald-700 dark:text-emerald-300 bg-emerald-500/5"
                            : "border-border/60 text-foreground hover:border-emerald-600/60 hover:text-emerald-700 dark:hover:text-emerald-300"
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
                        <span className="inline-flex items-baseline gap-2">
                          <span>Yes</span>
                          <span className="tabular-nums">{yesPrice}¢</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`relative min-w-[110px] h-11 px-4 border transition-colors font-mono text-[11px] uppercase tracking-[0.16em] font-semibold ${
                          isActive
                            ? "border-red-600 dark:border-red-400 text-red-700 dark:text-red-300 bg-red-500/5"
                            : "border-border/60 text-foreground hover:border-red-600/60 hover:text-red-700 dark:hover:text-red-300"
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
                        <span className="inline-flex items-baseline gap-2">
                          <span>No</span>
                          <span className="tabular-nums">{noPrice}¢</span>
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Order Book drawer */}
                  {isActive && tradingOutcomes.length > 1 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="pb-4 border-t border-border/40"
                    >
                      <OrderBook
                        outcomes={tradingOutcomes.map((o) => ({
                          name: o.name,
                          tokenId: o.tokenId,
                          price: o.price,
                        }))}
                        defaultOutcomeIndex={selectedOutcome}
                        onPriceClick={handlePriceClick}
                        onOutcomeChange={(index) => setSelectedOutcome(index)}
                        defaultCollapsed={false}
                        embedded
                        scrollable
                      />
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Trading notice — restrained mono-caps */}
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground text-center pt-3">
            Trading coming soon — connect wallet to get started
          </p>
        </div>

        {/* Related Markets — editorial */}
        <RelatedMarkets marketImage={market.image} />
      </motion.main>
    </div>
  );
}

const RELATED_FILTERS = [
  { id: "all", label: "All" },
  { id: "politics", label: "Politics" },
  { id: "trump", label: "Trump" },
  { id: "fed-rates", label: "Fed Rates" },
] as const;

type RelatedFilterId = (typeof RELATED_FILTERS)[number]["id"];

const MOCK_RELATED: Record<
  RelatedFilterId,
  { title: string; probability: string }[]
> = {
  all: [
    { title: "Fed rate hike in 2025?", probability: "1%" },
    { title: "Will 2 Fed rate cuts happen in 2026?", probability: "25%" },
    { title: "Fed emergency rate cut in 2025?", probability: "3%" },
  ],
  politics: [],
  trump: [],
  "fed-rates": [
    { title: "Fed rate hike in 2025?", probability: "1%" },
    { title: "Will 2 Fed rate cuts happen in 2026?", probability: "25%" },
    { title: "Fed emergency rate cut in 2025?", probability: "3%" },
  ],
};

function RelatedMarkets({ marketImage }: { marketImage?: string }) {
  const [active, setActive] = useState<RelatedFilterId>("all");
  const items = MOCK_RELATED[active];

  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground/60">§</span>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground">
          Related Markets
        </h2>
      </div>

      {/* Filter chips — underline-active */}
      <div className="flex items-center gap-5 sm:gap-6 overflow-x-auto scrollbar-hide border-b border-border/40">
        {RELATED_FILTERS.map((f) => {
          const isActive = active === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setActive(f.id)}
              className={`relative shrink-0 py-3 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {isActive ? (
                <span className="font-editorial italic text-[15px] tracking-normal normal-case">
                  {f.label}
                </span>
              ) : (
                f.label
              )}
              {isActive && (
                <span className="absolute inset-x-0 -bottom-px h-px bg-foreground" />
              )}
            </button>
          );
        })}
      </div>

      {/* Results — hairline rows */}
      {items.length === 0 ? (
        <p className="font-editorial italic text-muted-foreground text-center py-10">
          No related markets in{" "}
          {RELATED_FILTERS.find((f) => f.id === active)?.label}
        </p>
      ) : (
        <div className="border-t border-border/40">
          {items.map((item) => (
            <button
              key={item.title}
              type="button"
              className="w-full flex items-center gap-3 py-3 border-b border-border/40 text-left hover:bg-foreground/2 transition-colors group"
            >
              {marketImage && (
                <div className="relative w-10 h-10 shrink-0 overflow-hidden rounded-sm">
                  <Image
                    src={marketImage}
                    alt=""
                    fill
                    sizes="40px"
                    className="object-cover"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h4 className="text-sm leading-snug text-foreground group-hover:underline decoration-foreground/40 underline-offset-4 line-clamp-2">
                  {item.title}
                </h4>
              </div>
              <div className="font-mono tabular-nums text-xl font-semibold text-foreground shrink-0">
                {item.probability}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
