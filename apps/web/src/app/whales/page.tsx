"use client";

import { useEffect, useMemo, useState } from "react";
import { ProChromeHeader } from "@/components/app-pro-layout";
import { Navbar } from "@/components/navbar";
import {
  type InsiderSensitivity,
  type InsiderSortMode,
  SENSITIVITY_PRESETS,
  sortInsiderActivities,
  useInsiderActivity,
} from "@/hooks/use-insider-activity";
import {
  getWhaleActivityStats,
  useWhaleActivity,
} from "@/hooks/use-whale-activity";
import { useWhaleLiveFeed } from "@/hooks/use-whale-live-feed";
import { ActivityLedger } from "./_components/activity-ledger";
import { HotMarketsList } from "./_components/hot-markets-list";
import { InsiderLedger } from "./_components/insider-ledger";
import { WhaleFilters } from "./_components/whale-filters";
import { WhaleHero } from "./_components/whale-hero";
import { WhaleLedger } from "./_components/whale-ledger";
import { WhalePressureChart } from "./_components/whale-pressure-chart";
import { WhalePullNumbers } from "./_components/whale-pull-numbers";
import {
  aggregateHotMarkets,
  aggregateWhales,
  buildPressureSeries,
} from "./_lib/aggregates";
import {
  type ActivitySideFilter,
  type ActivitySortColumn,
  TIME_PERIODS,
  type TimePeriodValue,
  type WhaleSortColumn,
  type WhaleTypeFilter,
} from "./_lib/constants";

type ViewTab = "whales" | "insiders";

export default function WhalesPage() {
  // Global cross-ledger filters
  const [activeTab, setActiveTab] = useState<ViewTab>("whales");
  const [timePeriod, setTimePeriod] = useState<TimePeriodValue>("24h");
  const [minTradeSize, setMinTradeSize] = useState("500");
  const [walletSearch, setWalletSearch] = useState("");

  // Insider-tab specific
  const [insiderSensitivity, setInsiderSensitivity] =
    useState<InsiderSensitivity>("balanced");
  const [insiderSortMode, setInsiderSortMode] =
    useState<InsiderSortMode>("suspicion");

  // Whale ledger sort
  const [whaleSort, setWhaleSort] = useState<{
    column: WhaleSortColumn;
    direction: "asc" | "desc";
  }>({ column: "volume", direction: "desc" });

  // Activity ledger sort / filters
  const [activitySort, setActivitySort] = useState<{
    column: ActivitySortColumn;
    direction: "asc" | "desc";
  }>({ column: "time", direction: "desc" });
  const [activitySide, setActivitySide] = useState<ActivitySideFilter>("all");
  const [marketFilter, setMarketFilter] = useState<string | null>(null);

  // Whale type filter — scopes the Whale Ledger to big-bet whales,
  // directional-conviction whales, or both (default).
  const [whaleTypeFilter, setWhaleTypeFilter] =
    useState<WhaleTypeFilter>("all");

  const apiPeriod =
    TIME_PERIODS.find((p) => p.value === timePeriod)?.apiPeriod ?? "DAY";
  const sensitivity = SENSITIVITY_PRESETS[insiderSensitivity];

  // Whale activity query — the primary data source for the page.
  const {
    data: whaleData,
    isLoading: whalesLoading,
    refetch: refetchWhales,
    isFetching: whalesFetching,
  } = useWhaleActivity({
    whaleCount: 50,
    minTradeSize: Number.parseFloat(minTradeSize),
    tradesPerWhale: 50,
    timePeriod: apiPeriod,
    enabled: activeTab === "whales",
  });

  // Insider query — loaded lazily when the user switches tabs.
  const {
    data: insiderData,
    isLoading: insidersLoading,
    refetch: refetchInsiders,
    isFetching: insidersFetching,
  } = useInsiderActivity({
    maxAccountAge: sensitivity.maxAccountAge,
    minUsdValue: sensitivity.minUsdValue,
    minScore: sensitivity.minScore,
    limit: 100,
    enabled: activeTab === "insiders",
  });

  // Derived: aggregates + stats for the whale tab
  const activities = whaleData?.activities ?? [];
  const whales = useMemo(() => aggregateWhales(activities), [activities]);
  const hotMarkets = useMemo(
    () => aggregateHotMarkets(activities, 12),
    [activities]
  );
  const pressureSeries = useMemo(
    () => buildPressureSeries(activities),
    [activities]
  );
  const stats = useMemo(() => getWhaleActivityStats(activities), [activities]);

  // Subscribe to the live WebSocket tape for the current hot markets so
  // the freshness indicator has something to tick on. Even though we
  // don't render a separate live banner anymore (it folds into the
  // ledger ordering by time), the connection state feeds the hero's
  // Live/Offline pill.
  const liveAssetIds = useMemo(
    () => hotMarkets.flatMap((m) => (m.conditionId ? [m.conditionId] : [])),
    [hotMarkets]
  );
  const { isConnected: isLiveConnected } = useWhaleLiveFeed({
    assetIds: liveAssetIds,
    minTradeSize: Number.parseFloat(minTradeSize),
    enabled: activeTab === "whales" && liveAssetIds.length > 0,
  });

  // Active market label for the filter chip above the activity ledger.
  const marketFilterLabel = useMemo(() => {
    if (!marketFilter) return null;
    const match = hotMarkets.find(
      (m) => m.conditionId === marketFilter || m.slug === marketFilter
    );
    return match?.title ?? null;
  }, [marketFilter, hotMarkets]);

  // Sorted insider activities (server returns all, we apply the
  // user-selected sort locally).
  const sortedInsiders = useMemo(() => {
    if (!insiderData?.activities) return [];
    return sortInsiderActivities(insiderData.activities, insiderSortMode);
  }, [insiderData?.activities, insiderSortMode]);

  // Tick-down ticker for the hero's "updated Xs ago" indicator.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const lastUpdatedMs = (() => {
    if (activeTab === "whales") {
      return whaleData?.lastUpdated
        ? now - new Date(whaleData.lastUpdated).getTime()
        : null;
    }
    return insiderData?.lastUpdated
      ? now - new Date(insiderData.lastUpdated).getTime()
      : null;
  })();

  const handleSortWhale = (col: WhaleSortColumn) => {
    setWhaleSort((prev) =>
      prev.column === col
        ? { column: col, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column: col, direction: "desc" }
    );
  };

  const handleSortActivity = (col: ActivitySortColumn) => {
    setActivitySort((prev) =>
      prev.column === col
        ? { column: col, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column: col, direction: "desc" }
    );
  };

  const handleRefresh = () => {
    if (activeTab === "whales") refetchWhales();
    else refetchInsiders();
  };

  const isFetching = activeTab === "whales" ? whalesFetching : insidersFetching;
  const isLoading = activeTab === "whales" ? whalesLoading : insidersLoading;

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <Navbar />
      <ProChromeHeader />

      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 xl:pb-8">
        <WhaleHero
          section={
            activeTab === "whales" ? "Whale Activity" : "Insider Detection"
          }
          dataAgeMs={lastUpdatedMs}
          isLive={activeTab === "whales" ? isLiveConnected : null}
          isFetching={isFetching}
          onRefresh={handleRefresh}
        />

        <WhaleFilters
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            setMarketFilter(null);
          }}
          timePeriod={timePeriod}
          onTimePeriodChange={setTimePeriod}
          minTradeSize={minTradeSize}
          onMinTradeSizeChange={setMinTradeSize}
          insiderSensitivity={insiderSensitivity}
          onInsiderSensitivityChange={setInsiderSensitivity}
          insiderSortMode={insiderSortMode}
          onInsiderSortModeChange={setInsiderSortMode}
          whaleTypeFilter={whaleTypeFilter}
          onWhaleTypeFilterChange={setWhaleTypeFilter}
          walletSearch={walletSearch}
          onWalletSearchChange={setWalletSearch}
        />

        {activeTab === "whales" && (
          <>
            <WhalePullNumbers
              totalVolume={stats.totalVolume}
              buyVolume={stats.totalBuyVolume}
              sellVolume={stats.totalSellVolume}
              uniqueTraders={stats.uniqueTraders}
              uniqueMarkets={stats.uniqueMarkets}
              totalTrades={stats.totalTrades}
              buyRatio={stats.buyRatio}
              sentiment={
                stats.sentiment === "bullish" || stats.sentiment === "bearish"
                  ? stats.sentiment
                  : "neutral"
              }
            />

            <WhalePressureChart series={pressureSeries} />

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)] gap-8 lg:gap-10 py-8">
              <WhaleLedger
                whales={whales}
                sort={whaleSort}
                onSortChange={handleSortWhale}
                walletSearch={walletSearch}
                typeFilter={whaleTypeFilter}
              />
              <HotMarketsList
                markets={hotMarkets.slice(0, 10)}
                activeMarketId={marketFilter}
                onMarketSelect={setMarketFilter}
              />
            </div>

            <ActivityLedger
              activities={activities}
              sort={activitySort}
              onSortChange={handleSortActivity}
              sideFilter={activitySide}
              onSideFilterChange={setActivitySide}
              marketFilter={marketFilter}
              onMarketFilterChange={setMarketFilter}
              marketFilterLabel={marketFilterLabel}
              walletSearch={walletSearch}
            />

            {isLoading && activities.length === 0 && (
              <p className="py-20 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Fetching whale tape…
              </p>
            )}
          </>
        )}

        {activeTab === "insiders" && (
          <div className="pt-8">
            <InsiderLedger
              activities={sortedInsiders}
              walletSearch={walletSearch}
            />

            {isLoading && sortedInsiders.length === 0 && (
              <p className="py-20 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Scanning for suspicious activity…
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
