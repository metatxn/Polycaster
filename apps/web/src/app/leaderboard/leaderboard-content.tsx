"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  Bitcoin,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Cloud,
  Cpu,
  Crown,
  Globe,
  Landmark,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useConnection } from "wagmi";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { Navbar } from "@/components/navbar";
import { PageBackground } from "@/components/page-background";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type LeaderboardCategory,
  type LeaderboardOrderBy,
  type LeaderboardTimePeriod,
  useLeaderboard,
} from "@/hooks/use-leaderboard";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { cn } from "@/lib/utils";

const CATEGORIES: {
  value: LeaderboardCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: "OVERALL", label: "Overall", icon: Activity },
  { value: "POLITICS", label: "Politics", icon: Landmark },
  { value: "SPORTS", label: "Sports", icon: Trophy },
  { value: "CRYPTO", label: "Crypto", icon: Bitcoin },
  { value: "FINANCE", label: "Finance", icon: CircleDollarSign },
  { value: "TECH", label: "Tech", icon: Cpu },
  { value: "CULTURE", label: "Culture", icon: Users },
  { value: "ECONOMICS", label: "Economics", icon: TrendingUp },
  { value: "WEATHER", label: "Weather", icon: Cloud },
  { value: "MENTIONS", label: "Mentions", icon: MessageSquare },
];

const TIME_PERIODS: { value: LeaderboardTimePeriod; label: string }[] = [
  { value: "DAY", label: "Today" },
  { value: "WEEK", label: "This Week" },
  { value: "MONTH", label: "This Month" },
  { value: "ALL", label: "All Time" },
];

const ORDER_OPTIONS: { value: LeaderboardOrderBy; label: string }[] = [
  { value: "PNL", label: "Profit & Loss" },
  { value: "VOL", label: "Volume" },
];

const ITEMS_PER_PAGE = 25;

// Re-export type from server-cache for backwards compatibility
import type { InitialLeaderboardData } from "@/lib/server-cache";

export type { InitialLeaderboardData } from "@/lib/server-cache";

interface LeaderboardContentProps {
  initialData?: InitialLeaderboardData | null;
}

export function LeaderboardContent({ initialData }: LeaderboardContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address } = useConnection();
  const { proxyAddress } = useProxyWallet();

  // Get initial values from URL params
  const initialCategory =
    (searchParams.get("category") as LeaderboardCategory) || "OVERALL";
  const initialTimePeriod =
    (searchParams.get("timePeriod") as LeaderboardTimePeriod) || "DAY";
  const initialOrderBy =
    (searchParams.get("orderBy") as LeaderboardOrderBy) || "PNL";
  const initialPage = Number.parseInt(searchParams.get("page") || "1", 10);

  const [category, setCategory] =
    useState<LeaderboardCategory>(initialCategory);
  const [timePeriod, setTimePeriod] =
    useState<LeaderboardTimePeriod>(initialTimePeriod);
  const [orderBy, setOrderBy] = useState<LeaderboardOrderBy>(initialOrderBy);
  const [page, setPage] = useState(initialPage);

  const offset = (page - 1) * ITEMS_PER_PAGE;

  const { data, isLoading, error } = useLeaderboard({
    category,
    timePeriod,
    orderBy,
    limit: ITEMS_PER_PAGE,
    offset,
  });

  // Use initialData if we're on page 1 with default filters and no client data yet
  const useInitialData =
    initialData &&
    !data &&
    page === 1 &&
    category === "OVERALL" &&
    timePeriod === "DAY" &&
    orderBy === "PNL";

  const traders = useInitialData ? initialData.traders : data?.traders || [];
  const showLoading = isLoading && !useInitialData;

  // Update URL when filters change
  const updateURL = useCallback(
    (newParams: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(newParams)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      router.push(`/leaderboard?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const handleCategoryChange = (value: LeaderboardCategory) => {
    setCategory(value);
    setPage(1);
    updateURL({ category: value, page: "1" });
  };

  const handleTimePeriodChange = (value: LeaderboardTimePeriod) => {
    setTimePeriod(value);
    setPage(1);
    updateURL({ timePeriod: value, page: "1" });
  };

  const handleOrderByChange = (value: LeaderboardOrderBy) => {
    setOrderBy(value);
    setPage(1);
    updateURL({ orderBy: value, page: "1" });
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    updateURL({ page: newPage.toString() });
  };

  // hasMore is true only when we get a full page AND there's no indication we're on the last page
  // This heuristic may show "Next" on the exact last page if it has exactly ITEMS_PER_PAGE items,
  // but it's safer than prematurely hiding pagination. The API would ideally return a total count.
  const hasMore = traders.length === ITEMS_PER_PAGE;
  const userAddress = proxyAddress || address;

  return (
    <div className="min-h-screen flex flex-col bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
      <PageBackground />
      <Navbar />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-2xl bg-linear-to-br from-yellow-500 to-amber-500 shadow-lg shadow-yellow-500/25">
              <Crown className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Leaderboard
              </h1>
              <p className="text-muted-foreground">
                Top traders ranked by performance
              </p>
            </div>
          </div>

          {/* Category Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {CATEGORIES.map((cat) => {
              const isActive = category === cat.value;
              const Icon = cat.icon;
              return (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => handleCategoryChange(cat.value)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap transition-[background-color,box-shadow] duration-200",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {cat.label}
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Filters Row */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex flex-wrap items-center justify-between gap-4 mb-6"
        >
          <div className="flex items-center gap-3">
            {/* Time Period Filter */}
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Select value={timePeriod} onValueChange={handleTimePeriodChange}>
                <SelectTrigger className="w-[140px] rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_PERIODS.map((period) => (
                    <SelectItem key={period.value} value={period.value}>
                      {period.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Order By Filter */}
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <Select value={orderBy} onValueChange={handleOrderByChange}>
                <SelectTrigger className="w-[150px] rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Results Count */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {traders.length > 0 && (
              <span>
                Showing {offset + 1}-{offset + traders.length} traders
              </span>
            )}
          </div>
        </motion.div>

        {/* Error State */}
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-12 px-4 rounded-2xl bg-destructive/5 border border-destructive/20"
          >
            <Sparkles className="h-10 w-10 text-destructive mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-destructive mb-2">
              Failed to load leaderboard
            </h3>
            <p className="text-muted-foreground mb-4">
              {error.message || "Something went wrong"}
            </p>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              className="rounded-xl"
            >
              Try Again
            </Button>
          </motion.div>
        )}

        {/* Leaderboard Table */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${category}-${timePeriod}-${orderBy}-${page}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <LeaderboardTable
              traders={traders}
              isLoading={showLoading}
              orderBy={orderBy}
              highlightAddress={userAddress}
            />
          </motion.div>
        </AnimatePresence>

        {/* Pagination */}
        {!showLoading && traders.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex items-center justify-center gap-4 mt-8"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 1}
              className="rounded-xl gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>

            <div className="flex items-center gap-2">
              <span className="px-4 py-2 rounded-xl bg-muted font-medium">
                Page {page}
              </span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page + 1)}
              disabled={!hasMore}
              className="rounded-xl gap-1"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </motion.div>
        )}

        {/* Info Section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-12 p-6 rounded-2xl bg-muted/30 border border-border/50"
        >
          <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            About the Leaderboard
          </h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Rankings are based on trading performance on Polymarket. Traders are
            ranked by their Profit & Loss (P&L) or trading Volume across
            different market categories. Data is updated in real-time and
            reflects the selected time period.
          </p>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/30 py-6 bg-background/50 backdrop-blur-xl">
        <div className="px-3 sm:px-4 md:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-256x256.png"
              alt="Knoww Logo"
              width={24}
              height={24}
              className="rounded-md"
            />
            <span className="font-bold text-foreground">Knoww</span>
            <span>•</span>
            <span>Powered by Polymarket</span>
          </div>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
