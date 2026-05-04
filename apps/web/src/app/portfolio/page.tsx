"use client";

import { useAppKit } from "@reown/appkit/react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useConnection } from "wagmi";
import { ChromeHeader } from "@/components/app-layout";
import { DepositModal } from "@/components/deposit-modal";
import { EditorialHero } from "@/components/editorial-hero";
import { Navbar } from "@/components/navbar";
import { HistoryTable } from "@/components/portfolio/history-table";
import { PortfolioLedgerHeader } from "@/components/portfolio/ledger-header";
import { OrdersTable } from "@/components/portfolio/orders-table";
import { PortfolioPnlCard } from "@/components/portfolio/pnl-card";
import { PositionsTable } from "@/components/portfolio/positions-table";
import { SellPositionModal } from "@/components/portfolio/sell-position-modal";
import { PortfolioStatsCard } from "@/components/portfolio/stats-card";
import type {
  PnLFilter,
  Position,
  SortDirection,
  SortField,
  TabType,
  Trade,
} from "@/components/portfolio/types";
import { PortfolioUtilityRow } from "@/components/portfolio/utility-row";
import { WithdrawModal } from "@/components/withdraw-modal";
import { useCtfOperations } from "@/hooks/use-ctf-operations";
import { useCancelOrder, useOpenOrders } from "@/hooks/use-open-orders";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useUserDetails } from "@/hooks/use-user-details";
import { useUserPnL } from "@/hooks/use-user-pnl";
import { useUserPositions } from "@/hooks/use-user-positions";
import { useUserTrades } from "@/hooks/use-user-trades";

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
        <ChromeHeader />
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
      <ChromeHeader />
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-24 xl:pb-8"
      >
        <PortfolioUtilityRow
          proxyAddress={proxyAddress ?? undefined}
          hasProxyWallet={hasProxyWallet}
          onDeposit={() => setShowDepositModal(true)}
          onWithdraw={() => setShowWithdrawModal(true)}
          onRefresh={handleRefresh}
          isRefreshing={
            loadingPositions ||
            loadingPnl ||
            loadingOrders ||
            loadingTrades ||
            loadingUserDetails ||
            isProxyLoading
          }
        />

        <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <PortfolioStatsCard
              portfolioValue={portfolioValue}
              openPositionsValue={openPositionsValue}
              positionCount={positionsData?.summary.positionCount}
              cashBalance={cashBalance}
              totalPnl={totalPnl}
              totalInvested={totalInvested}
              isPortfolioLoading={loadingPositions || isProxyLoading}
              isPositionsLoading={loadingPositions}
              isCashLoading={isProxyLoading}
              isPnlLoading={loadingPnl || loadingUserDetails}
            />
          </div>
          <div>
            <PortfolioPnlCard userAddress={tradingAddress || undefined} />
          </div>
        </div>

        <section>
          <PortfolioLedgerHeader
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              setSearchQuery("");
            }}
            positionCount={positionsData?.summary.positionCount}
            orderCount={ordersData?.count}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            pnlFilter={pnlFilter}
            onPnlFilterChange={setPnlFilter}
          />

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
