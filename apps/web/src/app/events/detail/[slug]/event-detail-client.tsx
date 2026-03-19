"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommentsSection } from "@/components/comments";
import { ErrorBoundary } from "@/components/error-boundary";
import { Navbar } from "@/components/navbar";
import { PageBackground } from "@/components/page-background";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Event } from "@/hooks/use-event-detail";
import { useEventDetail } from "@/hooks/use-event-detail";
import {
  useOrderBook as useOrderBookFromStore,
  useOrderBookStore,
} from "@/hooks/use-orderbook-store";
import { usePriceAlertDetection } from "@/hooks/use-price-alerts";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useOrderBookWebSocket } from "@/hooks/use-shared-websocket";
import { type Position, useUserPositions } from "@/hooks/use-user-positions";
import { formatVolume } from "@/lib/formatters";
import type { TokenMarketMap } from "@/types/comments";
import type { OutcomeData, TradingSide } from "@/types/market";
import { HeaderSection } from "./header-section";
import { OutcomesTable } from "./outcomes-table";

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

const TradingForm = dynamic(
  () =>
    import("@/components/trading-form").then((mod) => ({
      default: mod.TradingForm,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full">
        <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    ),
  }
);

// Props for the client component
interface EventDetailClientProps {
  slug: string;
  initialEvent?: Event | null;
}

// Cap list-row live quotes to keep WS subscription bounded on large events.
const MAX_MARKETS_WITH_LIVE_QUOTES = 20;

// Order book response type - defined outside component to avoid hook order issues
interface OrderBookResponse {
  success: boolean;
  tokenID: string;
  orderBook: {
    market: string;
    asset_id: string;
    timestamp: string;
    hash: string;
    bids: Array<{ price: string; size: string }>;
    asks: Array<{ price: string; size: string }>;
    min_order_size: string;
    tick_size: string;
    neg_risk: boolean;
  };
}

export default function EventDetailClient({
  slug: eventSlugOrId,
  initialEvent,
}: EventDetailClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read URL params for pre-filling trading form (from "Modify Order" in sell modal)
  const urlSide = searchParams?.get("side") as TradingSide | null;
  const urlShares = searchParams?.get("shares");
  const urlOutcome = searchParams?.get("outcome");
  const urlConditionId = searchParams?.get("conditionId");

  // Parse initial values from URL
  const initialSide: TradingSide | undefined =
    urlSide === "SELL" || urlSide === "BUY" ? urlSide : undefined;
  const initialShares: number | undefined = urlShares
    ? Number.parseFloat(urlShares)
    : undefined;
  const initialOutcomeFromUrl = urlOutcome?.toLowerCase();

  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState(0);
  // Track which market has its order book expanded (null = none)
  const [expandedOrderBookMarketId, setExpandedOrderBookMarketId] = useState<
    string | null
  >(null);
  // Outcome table collapse state - using Tailwind's 'lg' breakpoint (1024px)
  // Collapsed below lg (covers iPad Air 820px), expanded at lg and above
  const [isOutcomeTableExpanded, setIsOutcomeTableExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(min-width: 1024px)").matches; // Tailwind 'lg' breakpoint
    }
    return true; // Default to expanded for SSR
  });
  const [isScrolled, setIsScrolled] = useState(false);

  // Track pending refetch timers so we can cancel them on unmount
  const sellRefetchTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Cleanup sell refetch timers on unmount to prevent firing on unmounted component
  useEffect(() => {
    return () => {
      for (const timer of sellRefetchTimersRef.current) {
        clearTimeout(timer);
      }
      sellRefetchTimersRef.current = [];
    };
  }, []);

  // Handle scroll for sticky header effects with performance optimization and hysteresis
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          // Use hysteresis to prevent flickering:
          // - Scroll down: trigger at 50px
          // - Scroll up: untrigger at 10px
          setIsScrolled((prev) => {
            if (!prev && scrollY > 50) return true;
            if (prev && scrollY < 10) return false;
            return prev;
          });
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Order book store action for preloading from REST
  // Select only the action (stable ref) to avoid re-rendering on every store update
  const setOrderBookFromRest = useOrderBookStore((s) => s.setOrderBookFromRest);

  // Helper to quickly seed order book from REST (direct Polymarket call) for a token
  const preloadOrderBook = useCallback(
    async (tokenId: string | undefined) => {
      if (!tokenId) return;
      try {
        const res = await fetch(
          `https://clob.polymarket.com/book?token_id=${tokenId}`,
          { headers: { Accept: "application/json" } }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          bids?: Array<{ price: string; size: string }>;
          asks?: Array<{ price: string; size: string }>;
        };
        setOrderBookFromRest(tokenId, data.bids || [], data.asks || []);
      } catch (err) {
        console.error("Preload order book failed", err);
      }
    },
    [setOrderBookFromRest]
  );

  // Use slug from URL params - API handles both slugs and numeric IDs
  // Pass initialEvent from server for instant rendering (React 19 SSR optimization)
  const {
    data: event,
    isLoading: loading,
    error,
  } = useEventDetail(eventSlugOrId, initialEvent);

  // Fetch user positions to show "You have a position" indicator
  const {
    proxyAddress,
    isDeployed: hasProxyWallet,
    refresh: refreshProxyWallet,
  } = useProxyWallet();
  const tradingAddress =
    hasProxyWallet && proxyAddress ? proxyAddress : undefined;
  const { data: positionsData, refetch: refetchPositions } = useUserPositions({
    userAddress: tradingAddress,
    enabled: !!tradingAddress,
  });

  // Handle sell success - refresh positions and wallet balance
  const handleSellSuccess = useCallback(() => {
    // Immediate refetch
    refetchPositions();
    refreshProxyWallet();

    // Clear any previously scheduled refetch timers (e.g. from rapid sell clicks)
    for (const timer of sellRefetchTimersRef.current) {
      clearTimeout(timer);
    }
    sellRefetchTimersRef.current = [];

    // Multiple delayed refetches to catch backend updates
    const refetchAll = () => {
      refetchPositions();
      refreshProxyWallet();
    };

    // Refetch at 1s, 3s, and 5s to catch the update
    // Store timer IDs so they can be cancelled on unmount
    sellRefetchTimersRef.current = [
      setTimeout(refetchAll, 1000),
      setTimeout(refetchAll, 3000),
      setTimeout(refetchAll, 5000),
    ];
  }, [refetchPositions, refreshProxyWallet]);

  // Build position lookup maps for fast matching
  const { positionsByConditionId, positionsByAsset } = useMemo(() => {
    const byConditionId = new Map<string, Position[]>();
    const byAsset = new Map<string, Position[]>();

    if (!positionsData?.positions) {
      return {
        positionsByConditionId: byConditionId,
        positionsByAsset: byAsset,
      };
    }

    for (const position of positionsData.positions) {
      // Group by conditionId
      if (position.conditionId) {
        const existing = byConditionId.get(position.conditionId) || [];
        existing.push(position);
        byConditionId.set(position.conditionId, existing);
      }
      // Group by asset (token ID)
      if (position.asset) {
        const existing = byAsset.get(position.asset) || [];
        existing.push(position);
        byAsset.set(position.asset, existing);
      }
    }

    return { positionsByConditionId: byConditionId, positionsByAsset: byAsset };
  }, [positionsData?.positions]);

  // Helper to get user's position for a market
  const getMarketPosition = useCallback(
    (market: {
      conditionId?: string;
      yesTokenId?: string;
      noTokenId?: string;
    }): Position | null => {
      // Try conditionId first (most reliable)
      if (market.conditionId) {
        const positions = positionsByConditionId.get(market.conditionId);
        if (positions && positions.length > 0) {
          return positions[0];
        }
      }
      // Fallback to asset/token ID matching
      if (market.yesTokenId) {
        const positions = positionsByAsset.get(market.yesTokenId);
        if (positions && positions.length > 0) {
          return positions[0];
        }
      }
      if (market.noTokenId) {
        const positions = positionsByAsset.get(market.noTokenId);
        if (positions && positions.length > 0) {
          return positions[0];
        }
      }
      return null;
    },
    [positionsByConditionId, positionsByAsset]
  );

  // Handle order success
  const handleOrderSuccess = useCallback((_order: unknown) => {
    // console.log("Order placed successfully:", order);
  }, []);

  // Handle order error
  const handleOrderError = useCallback((_error: Error) => {
    // console.error("Order failed:", error);
  }, []);

  // Handle price click from order book
  const handlePriceClick = useCallback((_price: number) => {
    // console.log("Price clicked:", price);
  }, []);

  // Compute markets safely (even when event is null/undefined)
  const allMarkets = useMemo(() => {
    if (!event?.markets) return [];
    // Keep inactive markets hidden from UI
    return event.markets.filter((market) => market.active !== false);
  }, [event?.markets]);

  const openMarkets = useMemo(
    () => allMarkets.filter((m) => m.closed !== true),
    [allMarkets]
  );

  const closedMarkets = useMemo(
    () => allMarkets.filter((m) => m.closed === true),
    [allMarkets]
  );

  // "Single outcome" in this UI means: the event only has ONE market.
  // If there are multiple markets under the event, we only show order books when a user expands a specific market row.
  const totalMarketsCount =
    (typeof event?.marketCount === "number" ? event.marketCount : undefined) ??
    event?.markets?.length ??
    0;
  const isSingleMarketEvent = totalMarketsCount === 1;

  // Compute selected market, trading outcomes, and sorted market data for display
  const {
    selectedMarket,
    tradingOutcomes,
    currentTokenId,
    tokenMarketMap,
    sortedMarketData,
  } = useMemo(() => {
    if (!event || openMarkets.length === 0) {
      return {
        selectedMarket: null,
        tradingOutcomes: [] as OutcomeData[],
        currentTokenId: "",
        tokenMarketMap: new Map() as TokenMarketMap,
        sortedMarketData: [] as Array<{
          id: string;
          conditionId: string;
          question: string;
          groupItemTitle: string;
          yesProbability: number;
          yesPrice: string;
          noPrice: string;
          yesTokenId: string;
          noTokenId: string;
          negRisk: boolean;
          orderMinSize: number;
          change: number;
          volume: string;
          color: string;
          image: string | undefined;
        }>,
      };
    }

    // Build market data - shared transformation for both trading and display
    const marketData = openMarkets.map((market, idx) => {
      const outcomes = market.outcomes ? JSON.parse(market.outcomes) : [];
      const prices = market.outcomePrices
        ? JSON.parse(market.outcomePrices)
        : [];
      const tokens = market.tokens || [];
      const clobTokenIds = market.clobTokenIds
        ? JSON.parse(market.clobTokenIds)
        : [];

      const yesIndex = outcomes.findIndex((o: string) =>
        o.toLowerCase().includes("yes")
      );
      const noIndex = outcomes.findIndex((o: string) =>
        o.toLowerCase().includes("no")
      );

      const yesPrice = yesIndex !== -1 ? prices[yesIndex] : prices[0];
      const noPrice = noIndex !== -1 ? prices[noIndex] : prices[1];

      let yesTokenId = "";
      let noTokenId = "";

      if (tokens.length > 0) {
        const yesToken = tokens.find((t) => t.outcome?.toLowerCase() === "yes");
        const noToken = tokens.find((t) => t.outcome?.toLowerCase() === "no");
        yesTokenId = yesToken?.token_id || "";
        noTokenId = noToken?.token_id || "";
      } else if (clobTokenIds.length > 0) {
        yesTokenId = yesIndex !== -1 ? clobTokenIds[yesIndex] : clobTokenIds[0];
        noTokenId = noIndex !== -1 ? clobTokenIds[noIndex] : clobTokenIds[1];
      }

      const yesProbability = yesPrice
        ? Number.parseFloat((Number.parseFloat(yesPrice) * 100).toFixed(0))
        : 0;
      // TODO: Replace with real change data from API when available
      const change = 0;
      const colors = ["orange", "blue", "purple", "green"];

      const rawMinSize = market.orderMinSize ?? market.order_min_size;
      const orderMinSize =
        typeof rawMinSize === "number"
          ? rawMinSize
          : Number.parseFloat(String(rawMinSize ?? "1")) || 1;

      return {
        id: market.id,
        conditionId: market.conditionId || "",
        question: market.question,
        groupItemTitle: market.groupItemTitle || market.question,
        yesProbability,
        yesPrice: yesPrice || "0",
        noPrice: noPrice || "0",
        yesTokenId: yesTokenId || "",
        noTokenId: noTokenId || "",
        negRisk: market.negRisk || false,
        orderMinSize,
        change,
        volume: market.volume || "0",
        color: colors[idx % colors.length],
        image: market.image,
      };
    });

    const sortedMarketData = [...marketData].sort(
      (a, b) => b.yesProbability - a.yesProbability
    );

    const selected =
      sortedMarketData.find((m) => m.id === selectedMarketId) ||
      sortedMarketData[0];

    // Build trading outcomes
    const outcomes: OutcomeData[] = selected
      ? [
          {
            name: "Yes",
            tokenId: selected.yesTokenId,
            price: Number.parseFloat(selected.yesPrice) || 0.5,
            probability: (Number.parseFloat(selected.yesPrice) || 0.5) * 100,
          },
          {
            name: "No",
            tokenId: selected.noTokenId,
            price: Number.parseFloat(selected.noPrice) || 0.5,
            probability: (Number.parseFloat(selected.noPrice) || 0.5) * 100,
          },
        ]
      : [];

    const tokenId = outcomes[selectedOutcomeIndex]?.tokenId || "";

    // Build token to market mapping for comments position display
    const tokenMap: TokenMarketMap = new Map();
    for (const market of marketData) {
      // Get a short market name from groupItemTitle
      // e.g., "Will Arsenal win?" -> "Arsenal"
      const marketName = market.groupItemTitle || market.question || "Unknown";

      if (market.yesTokenId) {
        tokenMap.set(market.yesTokenId, {
          tokenId: market.yesTokenId,
          marketName,
          outcome: "Yes",
        });
      }
      if (market.noTokenId) {
        tokenMap.set(market.noTokenId, {
          tokenId: market.noTokenId,
          marketName,
          outcome: "No",
        });
      }
    }

    return {
      selectedMarket: selected,
      tradingOutcomes: outcomes,
      currentTokenId: tokenId,
      tokenMarketMap: tokenMap,
      sortedMarketData,
    };
  }, [event, openMarkets, selectedMarketId, selectedOutcomeIndex]);

  // Bound WS scope for large events:
  // 1) top rows for inline quotes, 2) selected market, 3) expanded market.
  const websocketTokenIds = useMemo(() => {
    const tokenIds = new Set<string>();

    for (const market of sortedMarketData.slice(
      0,
      MAX_MARKETS_WITH_LIVE_QUOTES
    )) {
      if (market.yesTokenId) {
        tokenIds.add(market.yesTokenId);
      }
    }

    if (selectedMarket?.yesTokenId) {
      tokenIds.add(selectedMarket.yesTokenId);
    }
    if (selectedMarket?.noTokenId) {
      tokenIds.add(selectedMarket.noTokenId);
    }

    if (expandedOrderBookMarketId) {
      const expandedMarket = sortedMarketData.find(
        (m) => m.id === expandedOrderBookMarketId
      );
      if (expandedMarket?.yesTokenId) {
        tokenIds.add(expandedMarket.yesTokenId);
      }
      if (expandedMarket?.noTokenId) {
        tokenIds.add(expandedMarket.noTokenId);
      }
    }

    return Array.from(tokenIds);
  }, [sortedMarketData, selectedMarket, expandedOrderBookMarketId]);

  // Enable price alert detection only for actively subscribed tokens.
  usePriceAlertDetection(websocketTokenIds);

  // Auto-expand the order book upfront when the event has exactly one market.
  useEffect(() => {
    if (!isSingleMarketEvent) return;
    const onlyMarketId = openMarkets[0]?.id;
    if (!onlyMarketId) return;

    setSelectedMarketId((prev) => prev || onlyMarketId);
    setExpandedOrderBookMarketId((prev) => prev ?? onlyMarketId);

    // Preload both sides so the order book renders immediately once expanded.
    if (selectedMarket) {
      void preloadOrderBook(selectedMarket.yesTokenId);
      void preloadOrderBook(selectedMarket.noTokenId);
    }
  }, [isSingleMarketEvent, openMarkets, preloadOrderBook, selectedMarket]);

  // Pre-select market based on conditionId from URL (for "Modify Order" from sell modal)
  useEffect(() => {
    if (!urlConditionId || openMarkets.length === 0) return;

    // Find the market that matches the conditionId
    const matchingMarket = openMarkets.find(
      (market) => market.conditionId === urlConditionId
    );

    if (matchingMarket) {
      setSelectedMarketId(matchingMarket.id);
      setExpandedOrderBookMarketId(matchingMarket.id);
    }
  }, [urlConditionId, openMarkets]);

  // Set outcome index based on URL param (for "Modify Order" from sell modal)
  useEffect(() => {
    if (initialOutcomeFromUrl && tradingOutcomes.length > 0) {
      const outcomeIndex = tradingOutcomes.findIndex(
        (o) => o.name.toLowerCase() === initialOutcomeFromUrl
      );
      if (outcomeIndex !== -1 && outcomeIndex !== selectedOutcomeIndex) {
        setSelectedOutcomeIndex(outcomeIndex);
      }
    }
  }, [initialOutcomeFromUrl, tradingOutcomes, selectedOutcomeIndex]);

  // ARCHITECTURE: REST first, then WebSocket for real-time updates
  // This is how Binance, Coinbase, and Polymarket work

  // STEP 1: Fetch initial order book snapshot directly from Polymarket CLOB API
  // Direct fetch is faster than going through our Next.js API route
  const { data: orderBookData } = useQuery<OrderBookResponse | null>({
    queryKey: ["orderBook", currentTokenId],
    queryFn: async (): Promise<OrderBookResponse | null> => {
      if (!currentTokenId) return null;
      // Direct call to Polymarket CLOB API (public, allows CORS)
      const response = await fetch(
        `https://clob.polymarket.com/book?token_id=${currentTokenId}`,
        { headers: { Accept: "application/json" } }
      );
      if (!response.ok) return null;
      const data = (await response.json()) as {
        market?: string;
        asset_id?: string;
        timestamp?: string;
        hash?: string;
        bids?: Array<{ price: string; size: string }>;
        asks?: Array<{ price: string; size: string }>;
        min_order_size?: string;
        tick_size?: string;
        neg_risk?: boolean;
      };
      // Wrap in our expected format
      return {
        success: true,
        tokenID: currentTokenId,
        orderBook: {
          market: data.market || "",
          asset_id: data.asset_id || currentTokenId,
          timestamp: data.timestamp || "",
          hash: data.hash || "",
          bids: data.bids || [],
          asks: data.asks || [],
          min_order_size: data.min_order_size || "1",
          tick_size: data.tick_size || "0.01",
          neg_risk: data.neg_risk || false,
        },
      };
    },
    enabled: !!currentTokenId,
    staleTime: 30000, // Consider fresh for 30s (WebSocket will update)
  });

  // STEP 2: Seed the store with REST data when it arrives
  useEffect(() => {
    if (orderBookData?.orderBook && currentTokenId) {
      setOrderBookFromRest(
        currentTokenId,
        orderBookData.orderBook.bids || [],
        orderBookData.orderBook.asks || []
      );
    }
  }, [orderBookData, currentTokenId, setOrderBookFromRest]);

  // STEP 3: Connect to shared WebSocket for real-time incremental updates
  // Uses singleton WebSocket manager - only ONE connection for all components
  const { connectionState, isConnected } =
    useOrderBookWebSocket(websocketTokenIds);

  // Get order book from store (seeded by REST, updated by WebSocket)
  const storeOrderBook = useOrderBookFromStore(currentTokenId);

  // Extract best bid, ask, tick_size, min_order_size, and full order book for slippage
  // Store has merged REST + WebSocket data
  const { bestBid, bestAsk, tickSize, minOrderSize, orderBook } =
    useMemo(() => {
      const marketMinOrderSize = selectedMarket?.orderMinSize ?? 1;

      // Use store data (seeded by REST, updated by WebSocket)
      if (storeOrderBook) {
        return {
          bestBid: storeOrderBook.bestBid ?? undefined,
          bestAsk: storeOrderBook.bestAsk ?? undefined,
          tickSize: 0.01, // Default tick size
          minOrderSize: marketMinOrderSize,
          orderBook: {
            bids: storeOrderBook.bids,
            asks: storeOrderBook.asks,
          },
        };
      }

      // Fall back to raw REST API data if store is empty
      if (!orderBookData?.orderBook) {
        return {
          bestBid: undefined,
          bestAsk: undefined,
          tickSize: 0.01,
          minOrderSize: marketMinOrderSize,
          orderBook: undefined,
        };
      }

      const ob = orderBookData.orderBook;
      const bids = ob.bids || [];
      const asks = ob.asks || [];

      const sortedBids = [...bids].sort(
        (a, b) => Number.parseFloat(b.price) - Number.parseFloat(a.price)
      );
      const sortedAsks = [...asks].sort(
        (a, b) => Number.parseFloat(a.price) - Number.parseFloat(b.price)
      );

      const bestBidLevel = sortedBids.length > 0 ? sortedBids[0] : null;
      const bestAskLevel = sortedAsks.length > 0 ? sortedAsks[0] : null;

      const tickSizeValue = ob.tick_size
        ? Number.parseFloat(ob.tick_size)
        : 0.01;
      const bookMinOrderSizeValue = ob.min_order_size
        ? Number.parseFloat(ob.min_order_size)
        : 1;

      const minOrderSizeValue = Math.max(
        marketMinOrderSize,
        bookMinOrderSizeValue
      );

      return {
        bestBid: bestBidLevel
          ? Number.parseFloat(bestBidLevel.price)
          : undefined,
        bestAsk: bestAskLevel
          ? Number.parseFloat(bestAskLevel.price)
          : undefined,
        tickSize: tickSizeValue,
        minOrderSize: minOrderSizeValue,
        orderBook: { bids, asks },
      };
    }, [storeOrderBook, orderBookData, selectedMarket]);

  // Build closed market data for display (memoized to avoid recomputation)
  const closedMarketData = useMemo(
    () =>
      closedMarkets.map((market) => {
        const outcomes = market.outcomes ? JSON.parse(market.outcomes) : [];
        const prices = market.outcomePrices
          ? JSON.parse(market.outcomePrices)
          : [];
        const tokens = market.tokens || [];
        const clobTokenIds = market.clobTokenIds
          ? JSON.parse(market.clobTokenIds)
          : [];

        const yesIndex = outcomes.findIndex((o: string) =>
          o.toLowerCase().includes("yes")
        );
        const noIndex = outcomes.findIndex((o: string) =>
          o.toLowerCase().includes("no")
        );

        const yesPrice = yesIndex !== -1 ? prices[yesIndex] : prices[0];
        const noPrice = noIndex !== -1 ? prices[noIndex] : prices[1];

        let yesTokenId = "";
        let noTokenId = "";

        if (tokens.length > 0) {
          const yesToken = tokens.find(
            (t) => t.outcome?.toLowerCase() === "yes"
          );
          const noToken = tokens.find((t) => t.outcome?.toLowerCase() === "no");
          yesTokenId = yesToken?.token_id || "";
          noTokenId = noToken?.token_id || "";
        } else if (clobTokenIds.length > 0) {
          yesTokenId =
            yesIndex !== -1 ? clobTokenIds[yesIndex] : clobTokenIds[0];
          noTokenId = noIndex !== -1 ? clobTokenIds[noIndex] : clobTokenIds[1];
        }

        const yesProbability = yesPrice
          ? Number.parseFloat((Number.parseFloat(yesPrice) * 100).toFixed(0))
          : 0;

        return {
          id: market.id,
          conditionId: market.conditionId || "",
          groupItemTitle: market.groupItemTitle || market.question,
          yesProbability,
          yesPrice: yesPrice || "0",
          noPrice: noPrice || "0",
          yesTokenId: yesTokenId || "",
          noTokenId: noTokenId || "",
          change: 0,
          volume: market.volume || "0",
          image: market.image,
          closed: true,
        };
      }),
    [closedMarkets]
  );

  // Loading state - AFTER all hooks
  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
        <PageBackground />

        <Navbar />
        <main className="relative z-10 px-4 md:px-6 lg:px-8 py-8 space-y-8">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-96 w-full" />
        </main>
      </div>
    );
  }

  // Error state - AFTER all hooks
  if (error || !event) {
    return (
      <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
        <PageBackground />

        <Navbar />
        <main className="relative z-10 px-4 md:px-6 lg:px-8 py-6">
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
              <CardTitle>Event Not Found</CardTitle>
            </CardHeader>
            <Button onClick={() => router.push("/")}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back to Markets
            </Button>
          </Card>
        </main>
      </div>
    );
  }

  // sortedMarketData is already computed in the useMemo above

  // closedMarketData is now memoized above the early returns

  // Chart behavior:
  // - If the event has ONE market, show BOTH Yes + No on the main chart.
  // - If the event has multiple markets, show top 4 markets (Yes) like before.
  const topMarketsForChart = isSingleMarketEvent
    ? sortedMarketData.slice(0, 1)
    : sortedMarketData.slice(0, 4);

  const singleMarketForChart = topMarketsForChart[0];

  const chartColors = [
    "hsl(25, 95%, 53%)", // Orange
    "hsl(221, 83%, 53%)", // Blue
    "hsl(280, 100%, 70%)", // Purple/Pink
    "hsl(142, 76%, 36%)", // Green
  ];

  const marketTitles = isSingleMarketEvent
    ? ["Yes", "No"]
    : topMarketsForChart.map((m) => m.groupItemTitle);

  const yesProb = isSingleMarketEvent
    ? [
        singleMarketForChart?.yesPrice || "0",
        singleMarketForChart?.noPrice || "0",
      ]
    : topMarketsForChart.map((m) => m.yesPrice);

  const chartTokens = isSingleMarketEvent
    ? [
        {
          tokenId: singleMarketForChart?.yesTokenId || "",
          name: "Yes",
          color: "hsl(142, 76%, 36%)", // Green
        },
        {
          tokenId: singleMarketForChart?.noTokenId || "",
          name: "No",
          color: "hsl(0, 84%, 60%)", // Red
        },
      ]
    : topMarketsForChart.map((m, idx) => ({
        tokenId: m.yesTokenId,
        name: m.groupItemTitle,
        color: chartColors[idx % chartColors.length],
      }));

  // Find the earliest createdAt from all markets or use event createdAt
  const earliestCreatedAt = openMarkets.reduce<string | undefined>(
    (earliest, market) => {
      if (!market.createdAt) return earliest;
      if (!earliest) return market.createdAt;
      return new Date(market.createdAt) < new Date(earliest)
        ? market.createdAt
        : earliest;
    },
    event.createdAt
  );

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative selection:bg-purple-500/30">
      <PageBackground />

      <Navbar />
      <main className="relative z-10 px-4 md:px-6 lg:px-8 py-6 min-h-screen">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
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
            {event.title}
          </span>
        </div>

        {/* Header Section */}
        <HeaderSection
          event={event}
          isScrolled={isScrolled}
          formatVolume={formatVolume}
          totalMarketsCount={totalMarketsCount}
          openMarkets={openMarkets}
          closedMarkets={closedMarkets}
        />

        {/* Main Content: Chart + Trading Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Left Column: Chart + Outcomes Table */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            {/* Chart */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap gap-2 md:gap-4">
                  {isSingleMarketEvent && singleMarketForChart ? (
                    <>
                      <div className="flex items-center gap-1.5 md:gap-2">
                        <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full shrink-0 bg-green-500" />
                        <span className="text-xs md:text-sm">
                          Yes {singleMarketForChart.yesProbability}%
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 md:gap-2">
                        <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full shrink-0 bg-red-500" />
                        <span className="text-xs md:text-sm">
                          No{" "}
                          {Math.max(
                            0,
                            100 - singleMarketForChart.yesProbability
                          )}
                          %
                        </span>
                      </div>
                    </>
                  ) : (
                    topMarketsForChart.map((market, idx) => (
                      <div
                        key={market.id}
                        className="flex items-center gap-1.5 md:gap-2"
                      >
                        <div
                          className={`w-2.5 h-2.5 md:w-3 md:h-3 rounded-full shrink-0 ${
                            idx === 0
                              ? "bg-orange-500"
                              : idx === 1
                                ? "bg-blue-500"
                                : idx === 2
                                  ? "bg-purple-400"
                                  : "bg-green-500"
                          }`}
                        />
                        <span className="text-xs md:text-sm truncate max-w-[120px] sm:max-w-[150px] md:max-w-[200px]">
                          {market.groupItemTitle} {market.yesProbability}%
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <ErrorBoundary name="Market Price Chart">
                  <MarketPriceChart
                    tokens={chartTokens}
                    outcomes={marketTitles}
                    outcomePrices={yesProb}
                    startDate={earliestCreatedAt}
                  />
                </ErrorBoundary>
              </CardContent>
            </Card>

            <ErrorBoundary name="Outcomes Table">
              <OutcomesTable
                sortedMarketData={sortedMarketData}
                closedMarkets={closedMarketData}
                isOutcomeTableExpanded={isOutcomeTableExpanded}
                setIsOutcomeTableExpanded={setIsOutcomeTableExpanded}
                isConnected={isConnected}
                connectionState={connectionState}
                expandedOrderBookMarketId={expandedOrderBookMarketId}
                setExpandedOrderBookMarketId={setExpandedOrderBookMarketId}
                selectedMarketId={selectedMarketId}
                setSelectedMarketId={setSelectedMarketId}
                selectedOutcomeIndex={selectedOutcomeIndex}
                setSelectedOutcomeIndex={setSelectedOutcomeIndex}
                preloadOrderBook={preloadOrderBook}
                getMarketPosition={getMarketPosition}
                handlePriceClick={handlePriceClick}
                isSingleMarketEvent={isSingleMarketEvent}
                onSellSuccess={handleSellSuccess}
              />
            </ErrorBoundary>
          </div>

          {/* Trading Panel - Sticky on desktop, spans both rows so it sticks alongside comments too */}
          <div className="lg:col-span-1 lg:row-span-2 lg:sticky lg:top-20 lg:self-start">
            {selectedMarket && tradingOutcomes.length > 0 && (
              <ErrorBoundary name="Trading Form">
                <TradingForm
                  marketTitle={selectedMarket.groupItemTitle || event.title}
                  tokenId={tradingOutcomes[selectedOutcomeIndex]?.tokenId || ""}
                  outcomes={tradingOutcomes}
                  selectedOutcomeIndex={selectedOutcomeIndex}
                  onOutcomeChange={setSelectedOutcomeIndex}
                  negRisk={selectedMarket.negRisk || event.negRisk}
                  tickSize={tickSize}
                  minOrderSize={minOrderSize}
                  bestBid={bestBid}
                  bestAsk={bestAsk}
                  orderBook={orderBook}
                  maxSlippagePercent={2}
                  onOrderSuccess={handleOrderSuccess}
                  onOrderError={handleOrderError}
                  marketImage={selectedMarket.image}
                  yesProbability={selectedMarket.yesProbability}
                  isLiveData={isConnected}
                  initialSide={initialSide}
                  initialShares={initialShares}
                  conditionId={selectedMarket.conditionId}
                />
              </ErrorBoundary>
            )}
          </div>

          {/* Comments Section - appears after trading form on mobile, below outcomes on desktop */}
          {event?.id && (
            <div className="lg:col-span-2">
              <ErrorBoundary name="Comments Section">
                <CommentsSection
                  eventId={Number.parseInt(event.id, 10)}
                  variant="card"
                  tokenMarketMap={tokenMarketMap}
                />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
