"use client";

import { useAppKit } from "@reown/appkit/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Check,
  Copy,
  LayoutGrid,
  RefreshCw,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useConnection } from "wagmi";
import { DepositModal } from "@/components/deposit-modal";
import { Navbar } from "@/components/navbar";
import { PageBackground } from "@/components/page-background";
import { PnLChart } from "@/components/pnl-chart";
import { HistoryTable } from "@/components/portfolio/history-table";
import { OrdersTable } from "@/components/portfolio/orders-table";
import { PositionsTable } from "@/components/portfolio/positions-table";
import { SearchBar } from "@/components/portfolio/search-bar";
import { SellPositionModal } from "@/components/portfolio/sell-position-modal";
import { StatCard } from "@/components/portfolio/stat-card";
import { TabNav } from "@/components/portfolio/tab-nav";
import type {
  PnLFilter,
  Position,
  SortDirection,
  SortField,
  TabType,
  Trade,
} from "@/components/portfolio/types";
import { Button } from "@/components/ui/button";
import { WithdrawModal } from "@/components/withdraw-modal";
import { useCtfOperations } from "@/hooks/use-ctf-operations";
import { useCancelOrder, useOpenOrders } from "@/hooks/use-open-orders";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useUserDetails } from "@/hooks/use-user-details";
import { useUserPnL } from "@/hooks/use-user-pnl";
import { useUserPositions } from "@/hooks/use-user-positions";
import { useUserTrades } from "@/hooks/use-user-trades";
import { formatAddress, formatCurrency } from "@/lib/formatters";

function areClosedTimesEqual(
  prev: Record<string, string>,
  next: Record<string, string>
) {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  if (prevKeys.length !== nextKeys.length) return false;
  return prevKeys.every((key) => prev[key] === next[key]);
}

export default function PortfolioPage() {
  const { isConnected, address } = useConnection();
  const { open } = useAppKit();
  const [activeTab, setActiveTab] = useState<TabType>("positions");
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);

  // Sorting & Filtering state
  const [sortField, setSortField] = useState<SortField>("value");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pnlFilter, setPnlFilter] = useState<PnLFilter>("all");

  // Proxy wallet data
  const {
    proxyAddress,
    isDeployed: hasProxyWallet,
    usdcBalance: proxyUsdcBalance,
    isLoading: isProxyLoading,
    refresh: refreshProxyWallet,
  } = useProxyWallet();

  const tradingAddress =
    hasProxyWallet && proxyAddress ? proxyAddress : address;

  // Data fetching
  const {
    data: positionsData,
    isLoading: loadingPositions,
    refetch: refetchPositions,
  } = useUserPositions({ userAddress: tradingAddress || undefined });

  const {
    data: tradesData,
    isLoading: loadingTrades,
    refetch: refetchTrades,
  } = useUserTrades({ limit: 100, userAddress: tradingAddress || undefined });

  const {
    data: ordersData,
    isLoading: loadingOrders,
    refetch: refetchOrders,
  } = useOpenOrders({ userAddress: tradingAddress || undefined });

  const {
    data: pnlData,
    isLoading: loadingPnl,
    refetch: refetchPnl,
  } = useUserPnL({ period: "all", userAddress: tradingAddress || undefined });

  const {
    data: userDetailsData,
    isLoading: loadingUserDetails,
    refetch: refetchUserDetails,
  } = useUserDetails({
    userAddress: tradingAddress || undefined,
    timePeriod: "all",
  });

  const { mutate: cancelOrder } = useCancelOrder();
  const [cancellingOrderId, setCancellingOrderId] = useState<string>();
  const { redeemPositions, isLoading: isRedeemingLost } = useCtfOperations();
  const [closingConditionId, setClosingConditionId] = useState<string | null>(
    null
  );

  // Sell position modal state
  const [sellPosition, setSellPosition] = useState<Position | null>(null);
  const [showSellModal, setShowSellModal] = useState(false);

  // Handlers
  const handleCopy = () => {
    if (proxyAddress) {
      navigator.clipboard.writeText(proxyAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRefresh = () => {
    refetchPositions();
    refetchTrades();
    refetchOrders();
    refetchPnl();
    refetchUserDetails();
    refreshProxyWallet();
  };

  const handleCancelOrder = (orderId: string) => {
    setCancellingOrderId(orderId);
    cancelOrder(orderId, {
      onSettled: () => setCancellingOrderId(undefined),
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const handleCloseLostPosition = async (conditionId: string) => {
    if (!tradingAddress || isRedeemingLost) return;
    setClosingConditionId(conditionId);
    try {
      const result = await redeemPositions(conditionId, tradingAddress);
      if (result.success) {
        toast.success("Position closed successfully");
        refetchTrades();
        refetchPositions();
        refreshProxyWallet();
      } else {
        toast.error("Failed to close position");
      }
    } catch {
      toast.error("Failed to close position");
    } finally {
      setClosingConditionId(null);
    }
  };

  // Handle sell position
  const handleSellPosition = (position: Position) => {
    setSellPosition(position);
    setShowSellModal(true);
  };

  const sellRefetchTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearSellRefetchTimers = useCallback(() => {
    for (const id of sellRefetchTimers.current) clearTimeout(id);
    sellRefetchTimers.current = [];
  }, []);

  useEffect(() => clearSellRefetchTimers, [clearSellRefetchTimers]);

  const handleSellSuccess = () => {
    clearSellRefetchTimers();

    refetchPositions();
    refreshProxyWallet();

    // Polymarket's Data API can take 10-30 seconds to update positions
    const refetchAll = () => {
      refetchPositions();
      refreshProxyWallet();
    };

    const delays = [1000, 3000, 5000, 10000, 15000, 20000, 30000];
    for (const ms of delays) {
      sellRefetchTimers.current.push(setTimeout(refetchAll, ms));
    }

    setSellPosition(null);
  };

  // Computed values
  const openPositionsValue = positionsData?.summary.totalValue ?? 0;
  const cashBalance = proxyUsdcBalance ?? 0;
  const portfolioValue = openPositionsValue + cashBalance;
  const totalPnl = userDetailsData?.details?.pnl || pnlData?.pnl.total || 0;
  // Calculate total invested from positions
  const totalInvested = useMemo(() => {
    return (
      positionsData?.positions?.reduce((sum, p) => sum + p.initialValue, 0) ?? 0
    );
  }, [positionsData?.positions]);
  const pnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  // Resolve accurate closedTime timestamps for lost positions via same-origin API.
  const lostPositions = useMemo(
    () => positionsData?.lostPositions ?? [],
    [positionsData?.lostPositions]
  );
  const [closedTimes, setClosedTimes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!lostPositions.length) {
      setClosedTimes((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    const conditionIds = [...new Set(lostPositions.map((p) => p.conditionId))];
    let cancelled = false;

    fetch(`/api/markets/closed-time?ids=${conditionIds.join(",")}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const payload = data as { closedTimes?: Record<string, string> } | null;
        if (!cancelled && payload?.closedTimes) {
          const nextClosedTimes = payload.closedTimes;
          setClosedTimes((prev) =>
            areClosedTimesEqual(prev, nextClosedTimes) ? prev : nextClosedTimes
          );
        }
      })
      .catch(() => {
        // keep fallback timestamps
      });

    return () => {
      cancelled = true;
    };
  }, [lostPositions]);

  const mergedHistory = useMemo<Trade[]>(() => {
    const trades: Trade[] = tradesData?.trades || [];
    if (!lostPositions.length) return trades;

    const syntheticLost: Trade[] = lostPositions.map((lp) => {
      const resolvedTimestamp = closedTimes[lp.conditionId] || lp.endDate;
      const timestamp = resolvedTimestamp.includes("T")
        ? resolvedTimestamp
        : `${resolvedTimestamp}T23:59:59Z`;

      return {
        id: `lost-${lp.conditionId}-${lp.outcomeIndex}`,
        timestamp,
        type: "REDEEM",
        side: null,
        size: lp.size,
        price: lp.avgPrice,
        usdcAmount: 0,
        outcome: lp.outcome,
        transactionHash: "",
        market: {
          conditionId: lp.conditionId,
          title: lp.market.title,
          slug: lp.market.slug,
          icon: lp.market.icon,
        },
      };
    });

    // Avoid duplicate entries if activity already contains a matching redeem row.
    const knownLostKeys = new Set(
      trades
        .filter((t) => t.type === "REDEEM")
        .map((t) => `${t.market.conditionId}-${t.outcome}`)
    );

    const merged = [
      ...trades,
      ...syntheticLost.filter(
        (t) => !knownLostKeys.has(`${t.market.conditionId}-${t.outcome}`)
      ),
    ];

    merged.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    return merged;
  }, [tradesData?.trades, lostPositions, closedTimes]);

  // Not connected state
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
        <PageBackground />

        <Navbar />
        <main className="relative z-10 container max-w-5xl mx-auto px-4 py-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-linear-to-r from-violet-500 to-fuchsia-500 blur-3xl opacity-20" />
              <div className="relative w-20 h-20 rounded-2xl bg-linear-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center mb-6">
                <Wallet className="h-10 w-10 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-bold mb-2">Connect Your Wallet</h1>
            <p className="text-muted-foreground mb-6 text-center max-w-md text-sm">
              Connect your wallet to view your portfolio, track positions, and
              manage your trades.
            </p>
            <Button
              onClick={() => open()}
              className="bg-linear-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
            >
              <Wallet className="mr-2 h-4 w-4" />
              Connect Wallet
            </Button>
          </motion.div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
      <PageBackground />

      <Navbar />
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative z-10 container max-w-5xl mx-auto px-4 py-6"
      >
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-3">
            Portfolio
          </h1>
          {/* Address and Action Buttons Row */}
          <div className="flex items-center justify-between gap-3">
            {proxyAddress && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/50 hover:bg-muted transition-colors group border border-border/50"
              >
                <code className="text-[10px] sm:text-xs font-mono text-muted-foreground group-hover:text-foreground">
                  {formatAddress(proxyAddress)}
                </code>
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground group-hover:text-foreground" />
                )}
              </button>
            )}
            <div className="flex items-center gap-2">
              {hasProxyWallet && proxyAddress ? (
                <>
                  <Button
                    onClick={() => setShowDepositModal(true)}
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20 h-9 px-3 sm:px-4 font-bold transition-all active:scale-95"
                  >
                    <ArrowDownToLine className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Deposit</span>
                  </Button>
                  <Button
                    onClick={() => setShowWithdrawModal(true)}
                    size="sm"
                    variant="outline"
                    className="border-border hover:bg-secondary text-foreground h-9 px-3 sm:px-4 font-bold transition-all active:scale-95"
                  >
                    <ArrowUpFromLine className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Withdraw</span>
                  </Button>
                </>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                className="h-9 px-3 border-2 font-bold transition-all active:scale-95"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="sr-only">Refresh</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="Portfolio Value"
            value={formatCurrency(portfolioValue)}
            isLoading={loadingPositions || isProxyLoading}
            isHighlighted={false}
            icon={Wallet}
          />
          <StatCard
            label="Open Positions"
            value={formatCurrency(openPositionsValue)}
            isLoading={loadingPositions}
            icon={LayoutGrid}
          />
          <StatCard
            label="Cash Balance"
            value={formatCurrency(cashBalance)}
            isLoading={isProxyLoading}
            icon={BarChart3}
          />
          <StatCard
            label="Total P&L"
            value={formatCurrency(totalPnl, true)}
            isLoading={loadingPnl || loadingUserDetails}
            valueClassName={totalPnl >= 0 ? "text-emerald-500" : "text-red-500"}
            trend={
              totalInvested > 0
                ? { value: pnlPercent, isPositive: totalPnl >= 0 }
                : undefined
            }
            icon={TrendingUp}
          />
        </div>

        {/* P&L Chart */}
        <div className="mb-6">
          <PnLChart userAddress={tradingAddress || undefined} height={160} />
        </div>

        {/* Tabs Content */}
        <div className="bg-card rounded-xl border border-border">
          {/* Tab Navigation */}
          <TabNav
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              setSearchQuery("");
            }}
            positionCount={positionsData?.summary.positionCount}
            orderCount={ordersData?.count}
          />

          {/* Search Bar with Filters */}
          <div className="p-4 border-b border-border">
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={`Search ${
                activeTab === "positions"
                  ? "markets"
                  : activeTab === "orders"
                    ? "orders"
                    : "history"
              }...`}
              pnlFilter={pnlFilter}
              onPnlFilterChange={setPnlFilter}
              showFilter={activeTab === "positions"}
            />
          </div>

          {/* Tab Content */}
          <AnimatePresence mode="wait">
            {activeTab === "positions" && (
              <motion.div
                key="positions"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <PositionsTable
                  positions={positionsData?.positions || []}
                  isLoading={loadingPositions}
                  searchQuery={searchQuery}
                  pnlFilter={pnlFilter}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  onSell={handleSellPosition}
                />
              </motion.div>
            )}

            {activeTab === "orders" && (
              <motion.div
                key="orders"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <OrdersTable
                  orders={ordersData?.orders || []}
                  isLoading={loadingOrders}
                  searchQuery={searchQuery}
                  onCancel={handleCancelOrder}
                  cancellingOrderId={cancellingOrderId}
                />
              </motion.div>
            )}

            {activeTab === "history" && (
              <motion.div
                key="history"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <HistoryTable
                  trades={mergedHistory}
                  isLoading={loadingTrades || loadingPositions}
                  searchQuery={searchQuery}
                  onCloseLostPosition={handleCloseLostPosition}
                  closingPositionId={closingConditionId}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.main>

      {/* Deposit Modal */}
      <DepositModal
        open={showDepositModal}
        onOpenChange={setShowDepositModal}
      />

      {/* Withdraw Modal */}
      <WithdrawModal
        open={showWithdrawModal}
        onOpenChange={setShowWithdrawModal}
      />

      {/* Sell Position Modal */}
      <SellPositionModal
        open={showSellModal}
        onOpenChange={setShowSellModal}
        position={sellPosition}
        onSellSuccess={handleSellSuccess}
      />
    </div>
  );
}
