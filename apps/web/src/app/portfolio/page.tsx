"use client";

import { useAppKit } from "@reown/appkit/react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useConnection } from "wagmi";
import { ProChromeHeader } from "@/components/app-pro-layout";
import { DepositModal } from "@/components/deposit-modal";
import { EditorialHero, HeroRefreshButton } from "@/components/editorial-hero";
import { Navbar } from "@/components/navbar";
import { PnLChart } from "@/components/pnl-chart";
import { HistoryTable } from "@/components/portfolio/history-table";
import { OrdersTable } from "@/components/portfolio/orders-table";
import { PositionsTable } from "@/components/portfolio/positions-table";
import { SearchBar } from "@/components/portfolio/search-bar";
import { SellPositionModal } from "@/components/portfolio/sell-position-modal";
import { TabNav } from "@/components/portfolio/tab-nav";
import type {
  PnLFilter,
  Position,
  SortDirection,
  SortField,
  TabType,
  Trade,
} from "@/components/portfolio/types";
import { PullStat, PullStatGrid, TrendGlyph } from "@/components/pull-stat";
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
          eventSlug: lp.market.eventSlug,
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
      <div className="min-h-screen bg-background relative overflow-x-hidden selection:bg-foreground/15">
        <Navbar />
        <ProChromeHeader />
        <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-24 xl:pb-8">
          <EditorialHero
            breadcrumbs={[
              { label: "Markets", href: "/markets" },
              { label: "Portfolio" },
            ]}
            title={<span>Portfolio</span>}
            subtitle="Connect a wallet to see every position, open order and realised dollar."
          />

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex flex-col items-start gap-5 py-10 max-w-md"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Wallet · Not connected
            </p>
            <p className="font-editorial italic text-2xl leading-snug text-foreground">
              Your positions live on-chain. Connect a wallet to pull them in.
            </p>
            <button
              type="button"
              onClick={() => open()}
              className="group inline-flex items-center gap-2 pt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground transition-colors hover:text-muted-foreground"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500/75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              <span className="underline underline-offset-4 decoration-border group-hover:decoration-foreground transition-colors">
                Connect wallet
              </span>
            </button>
          </motion.div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden selection:bg-foreground/15">
      <Navbar />
      <ProChromeHeader />
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-24 xl:pb-8"
      >
        <EditorialHero
          breadcrumbs={[
            { label: "Markets", href: "/markets" },
            { label: "Portfolio" },
          ]}
          title={<span>Portfolio</span>}
          subtitle="Every position, order and realised dollar — in one ledger. Refreshed on demand."
          rightSlot={
            <HeroRefreshButton
              onRefresh={handleRefresh}
              isFetching={loadingPositions || loadingPnl}
            />
          }
          belowSlot={
            <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
              {proxyAddress && (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="group inline-flex items-center gap-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="font-mono text-[11px] sm:text-xs uppercase tracking-[0.12em]">
                    {formatAddress(proxyAddress)}
                  </span>
                  {copied ? (
                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                  )}
                </button>
              )}
              {hasProxyWallet && proxyAddress && (
                <div className="flex items-center gap-5">
                  <button
                    type="button"
                    onClick={() => setShowDepositModal(true)}
                    className="group inline-flex items-center gap-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground transition-colors hover:text-muted-foreground"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <ArrowDownToLine className="h-3 w-3" />
                    <span className="underline underline-offset-4 decoration-border group-hover:decoration-foreground transition-colors">
                      Deposit
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowWithdrawModal(true)}
                    className="group inline-flex items-center gap-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ArrowUpFromLine className="h-3 w-3" />
                    <span className="underline underline-offset-4 decoration-border group-hover:decoration-foreground transition-colors">
                      Withdraw
                    </span>
                  </button>
                </div>
              )}
            </div>
          }
        />

        {/* Pull-numbers */}
        <div className="mb-6">
          <PullStatGrid cols={4}>
            <PullStat
              label="Portfolio Value"
              value={formatCurrency(portfolioValue)}
              caption="Cash + positions"
              isLoading={loadingPositions || isProxyLoading}
            />
            <PullStat
              label="Open Positions"
              value={formatCurrency(openPositionsValue)}
              caption={
                positionsData?.summary.positionCount
                  ? `${positionsData.summary.positionCount} markets`
                  : "—"
              }
              isLoading={loadingPositions}
            />
            <PullStat
              label="Cash Balance"
              value={formatCurrency(cashBalance)}
              caption="USDC available"
              isLoading={isProxyLoading}
            />
            <PullStat
              label="Total P&L"
              value={formatCurrency(totalPnl, true)}
              caption={
                totalInvested > 0
                  ? `${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}% on cost`
                  : "No cost basis yet"
              }
              valueClassName={
                totalPnl >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }
              mark={
                totalInvested > 0 ? (
                  <TrendGlyph direction={totalPnl >= 0 ? "up" : "down"} />
                ) : undefined
              }
              isLoading={loadingPnl || loadingUserDetails}
            />
          </PullStatGrid>
        </div>

        {/* P&L Chart */}
        <div className="mb-6">
          <PnLChart userAddress={tradingAddress || undefined} height={160} />
        </div>

        {/* Tabs Content */}
        <section>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-3">
            §&nbsp;&nbsp;Ledger
          </h2>
          <TabNav
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              setSearchQuery("");
            }}
            positionCount={positionsData?.summary.positionCount}
            orderCount={ordersData?.count}
          />

          <div className="py-4 border-b border-border/40">
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
        </section>
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
