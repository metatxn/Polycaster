"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Clock,
  Crown,
  Eye,
  Fish,
  Flame,
  Gauge,
  Radio,
  RefreshCw,
  Repeat,
  Shield,
  SortAsc,
  Target,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  Wifi,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { VList } from "virtua";
import { Navbar } from "@/components/navbar";
import { PageBackground } from "@/components/page-background";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatAccountAge,
  getConfidenceBgColor,
  getConfidenceColor,
  getInsiderActivityStats,
  type InsiderSensitivity,
  type InsiderSortMode,
  SENSITIVITY_PRESETS,
  type SuspiciousActivity,
  sortInsiderActivities,
  useInsiderActivity,
} from "@/hooks/use-insider-activity";
import {
  getWhaleActivityStats,
  useWhaleActivity,
  type WhaleActivity,
} from "@/hooks/use-whale-activity";
import { useWhaleLiveFeed } from "@/hooks/use-whale-live-feed";
import { formatCurrencyCompact } from "@/lib/formatters";
import { cn } from "@/lib/utils";

type ViewTab = "whales" | "insiders";

const TIME_PERIODS = [
  {
    value: "24h",
    label: "Last 24 Hours",
    hours: 24,
    apiPeriod: "DAY" as const,
  },
  { value: "7d", label: "Last 7 Days", hours: 168, apiPeriod: "WEEK" as const },
  {
    value: "30d",
    label: "Last 30 Days",
    hours: 720,
    apiPeriod: "MONTH" as const,
  },
  {
    value: "all",
    label: "All Time",
    hours: Infinity,
    apiPeriod: "ALL" as const,
  },
];

const TRADE_SIZE_OPTIONS = [
  { value: "100", label: "$100+" },
  { value: "500", label: "$500+" },
  { value: "1000", label: "$1K+" },
  { value: "5000", label: "$5K+" },
];

const INSIDER_SORT_OPTIONS: { value: InsiderSortMode; label: string }[] = [
  { value: "suspicion", label: "Most Suspicious" },
  { value: "amount", label: "Largest Amount" },
  { value: "newest_account", label: "Newest Account" },
  { value: "most_repeated", label: "Most Repeated" },
];

function formatAddress(address: string | null | undefined) {
  if (!address) return "";
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimeAgo(timestamp: string) {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString();
}

function getInitials(name: string | null, address: string) {
  if (name && name.length > 0) {
    const parts = name.split(/[\s-]+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return address.slice(2, 4).toUpperCase();
}

function getPeriodLabel(value: string): string {
  switch (value) {
    case "24h":
      return "24H";
    case "7d":
      return "7D";
    case "30d":
      return "30D";
    case "all":
      return "All";
    default:
      return value;
  }
}

function getHotMarkets(activities: WhaleActivity[]) {
  const marketMap = new Map<
    string,
    {
      title: string;
      slug: string;
      eventSlug: string;
      image?: string;
      buyVolume: number;
      sellVolume: number;
      tradeCount: number;
      whaleCount: number;
      whales: Set<string>;
      tokenIds: Set<string>;
      latestPrice: number;
      sentiment: "bullish" | "bearish" | "neutral";
    }
  >();

  for (const activity of activities) {
    const key = activity.market.conditionId || activity.market.slug;
    if (!key) continue;
    const existing = marketMap.get(key);
    if (existing) {
      if (activity.trade.side === "BUY")
        existing.buyVolume += activity.trade.usdcAmount;
      else existing.sellVolume += activity.trade.usdcAmount;
      existing.tradeCount++;
      existing.whales.add(activity.trader.address);
      existing.whaleCount = existing.whales.size;
      existing.latestPrice = activity.trade.price;
      if (activity.market.tokenId)
        existing.tokenIds.add(activity.market.tokenId);
    } else {
      const whales = new Set<string>();
      whales.add(activity.trader.address);
      const tokenIds = new Set<string>();
      if (activity.market.tokenId) tokenIds.add(activity.market.tokenId);
      marketMap.set(key, {
        title: activity.market.title,
        slug: activity.market.slug,
        eventSlug: activity.market.eventSlug,
        image: activity.market.image,
        buyVolume:
          activity.trade.side === "BUY" ? activity.trade.usdcAmount : 0,
        sellVolume:
          activity.trade.side === "SELL" ? activity.trade.usdcAmount : 0,
        tradeCount: 1,
        whaleCount: 1,
        whales,
        tokenIds,
        latestPrice: activity.trade.price,
        sentiment: "neutral",
      });
    }
  }

  return Array.from(marketMap.entries())
    .map(([id, data]) => {
      const totalVolume = data.buyVolume + data.sellVolume;
      const buyRatio = totalVolume > 0 ? data.buyVolume / totalVolume : 0.5;
      return {
        id,
        ...data,
        totalVolume,
        buyRatio,
        sentiment:
          buyRatio > 0.65
            ? ("bullish" as const)
            : buyRatio < 0.35
              ? ("bearish" as const)
              : ("neutral" as const),
        tokenIdList: [...data.tokenIds],
      };
    })
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 8);
}

function getTopWhales(activities: WhaleActivity[]) {
  const whaleMap = new Map<
    string,
    {
      address: string;
      name: string | null;
      profileImage: string | null;
      rank: number;
      buyVolume: number;
      sellVolume: number;
      tradeCount: number;
      markets: Set<string>;
    }
  >();

  for (const activity of activities) {
    const existing = whaleMap.get(activity.trader.address);
    if (existing) {
      if (activity.trade.side === "BUY")
        existing.buyVolume += activity.trade.usdcAmount;
      else existing.sellVolume += activity.trade.usdcAmount;
      existing.tradeCount++;
      existing.markets.add(activity.market.conditionId);
    } else {
      const markets = new Set<string>();
      markets.add(activity.market.conditionId);
      whaleMap.set(activity.trader.address, {
        address: activity.trader.address,
        name: activity.trader.name,
        profileImage: activity.trader.profileImage,
        rank: activity.trader.rank,
        buyVolume:
          activity.trade.side === "BUY" ? activity.trade.usdcAmount : 0,
        sellVolume:
          activity.trade.side === "SELL" ? activity.trade.usdcAmount : 0,
        tradeCount: 1,
        markets,
      });
    }
  }

  return Array.from(whaleMap.values())
    .map((w) => ({
      ...w,
      totalVolume: w.buyVolume + w.sellVolume,
      marketCount: w.markets.size,
    }))
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 10);
}

// ==================== SHARED COMPONENTS ====================

function DataFreshnessBadge({
  lastUpdated,
  dataAge,
  isLive,
}: {
  lastUpdated: string;
  dataAge?: number;
  isLive?: boolean;
}) {
  const age = dataAge ?? Date.now() - new Date(lastUpdated).getTime();
  const ageSeconds = Math.floor(age / 1000);
  const isFresh = ageSeconds < 120;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium",
        isFresh
          ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
          : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
      )}
    >
      {isLive ? (
        <Radio className="h-3 w-3 animate-pulse" />
      ) : (
        <Clock className="h-3 w-3" />
      )}
      <span>
        {isLive
          ? "Live"
          : ageSeconds < 60
            ? "Just updated"
            : `${Math.floor(ageSeconds / 60)}m ago`}
      </span>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  className,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
  className?: string;
}) {
  return (
    <Card
      className={cn("bg-card/80 backdrop-blur-sm border-border", className)}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-foreground/70 font-semibold uppercase tracking-wide">
            {title}
          </span>
          <Icon className="h-4 w-4 text-foreground/60" />
        </div>
        <div className="flex items-center gap-2">
          {trend === "up" && (
            <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          )}
          {trend === "down" && (
            <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400" />
          )}
          <span
            className={cn(
              "text-2xl font-bold",
              trend === "up" && "text-emerald-600 dark:text-emerald-400",
              trend === "down" && "text-red-600 dark:text-red-400",
              !trend && "text-foreground"
            )}
          >
            {value}
          </span>
        </div>
        {subtitle && (
          <p className="text-sm text-foreground/60 mt-1.5">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== WHALE CHART ====================

function generateTimeSeriesData(activities: WhaleActivity[]) {
  if (activities.length === 0)
    return { buyData: [], sellData: [], maxVolume: 0 };
  const sorted = [...activities].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const bucketMap = new Map<string, { buy: number; sell: number }>();
  for (const activity of sorted) {
    const date = new Date(activity.timestamp);
    date.setMinutes(0, 0, 0);
    const key = date.toISOString();
    const existing = bucketMap.get(key) || { buy: 0, sell: 0 };
    if (activity.trade.side === "BUY")
      existing.buy += activity.trade.usdcAmount;
    else existing.sell += activity.trade.usdcAmount;
    bucketMap.set(key, existing);
  }
  const entries = Array.from(bucketMap.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  let cumulativeBuy = 0,
    cumulativeSell = 0;
  const buyData: { time: string; value: number }[] = [];
  const sellData: { time: string; value: number }[] = [];
  for (const [time, { buy, sell }] of entries) {
    cumulativeBuy += buy;
    cumulativeSell += sell;
    buyData.push({ time, value: cumulativeBuy });
    sellData.push({ time, value: cumulativeSell });
  }
  return {
    buyData,
    sellData,
    maxVolume: Math.max(cumulativeBuy, cumulativeSell),
  };
}

function BuySellAreaChart({
  activities,
  buyVolume,
  sellVolume,
  buyCount,
  sellCount,
  className,
}: {
  activities: WhaleActivity[];
  buyVolume: number;
  sellVolume: number;
  buyCount: number;
  sellCount: number;
  className?: string;
}) {
  const instanceId = useId();
  const buyGradientId = `buyGradient-${instanceId}`;
  const sellGradientId = `sellGradient-${instanceId}`;
  const { buyData, sellData, maxVolume } = useMemo(
    () => generateTimeSeriesData(activities),
    [activities]
  );
  const totalCount = buyCount + sellCount;
  const buyPercent = totalCount > 0 ? (buyCount / totalCount) * 100 : 50;
  const sellPercent = totalCount > 0 ? (sellCount / totalCount) * 100 : 50;

  const generatePath = (
    data: { time: string; value: number }[],
    isReversed: boolean
  ) => {
    if (data.length === 0) return "";
    const width = 100,
      height = 100;
    const points = data.map((d, i) => {
      const x = isReversed
        ? width - (i / Math.max(data.length - 1, 1)) * width
        : (i / Math.max(data.length - 1, 1)) * width;
      const y =
        height - (maxVolume > 0 ? (d.value / maxVolume) * height * 0.9 : 0);
      return `${x},${y}`;
    });
    return isReversed
      ? `M${width},${height} L${points.join(" L")} L0,${height} Z`
      : `M0,${height} L${points.join(" L")} L${width},${height} Z`;
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center mb-3">
        <div
          className="h-2 bg-emerald-500 rounded-l-full transition-[width] duration-500"
          style={{ width: `${buyPercent}%` }}
        />
        <div className="relative flex items-center justify-center px-2">
          <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-8 border-l-transparent border-r-transparent border-t-foreground/60" />
        </div>
        <div
          className="h-2 bg-red-500 rounded-r-full transition-[width] duration-500"
          style={{ width: `${sellPercent}%` }}
        />
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-foreground">
            {buyCount.toLocaleString()}
          </span>
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrencyCompact(buyVolume)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-red-600 dark:text-red-400">
            {formatCurrencyCompact(sellVolume)}
          </span>
          <span className="text-lg font-bold text-foreground">
            {sellCount.toLocaleString()}
          </span>
        </div>
      </div>
      <div className="relative h-40 flex">
        <div className="flex-1 relative overflow-hidden bg-emerald-50 dark:bg-emerald-950/30 rounded-l-lg border-r border-dashed border-foreground/20">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            aria-label="Buy volume chart"
            role="img"
          >
            <defs>
              <linearGradient
                id={buyGradientId}
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop
                  offset="0%"
                  stopColor="rgb(16, 185, 129)"
                  stopOpacity="0.8"
                />
                <stop
                  offset="100%"
                  stopColor="rgb(16, 185, 129)"
                  stopOpacity="0.2"
                />
              </linearGradient>
            </defs>
            <motion.path
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8 }}
              d={generatePath(buyData, true)}
              fill={`url(#${buyGradientId})`}
              stroke="rgb(16, 185, 129)"
              strokeWidth="1"
            />
          </svg>
          <div className="absolute left-2 top-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            {formatCurrencyCompact(maxVolume)}
          </div>
          <div className="absolute left-2 bottom-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            0
          </div>
        </div>
        <div className="flex-1 relative overflow-hidden bg-red-50 dark:bg-red-950/30 rounded-r-lg">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            aria-label="Sell volume chart"
            role="img"
          >
            <defs>
              <linearGradient
                id={sellGradientId}
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop
                  offset="0%"
                  stopColor="rgb(239, 68, 68)"
                  stopOpacity="0.8"
                />
                <stop
                  offset="100%"
                  stopColor="rgb(239, 68, 68)"
                  stopOpacity="0.2"
                />
              </linearGradient>
            </defs>
            <motion.path
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8 }}
              d={generatePath(sellData, false)}
              fill={`url(#${sellGradientId})`}
              stroke="rgb(239, 68, 68)"
              strokeWidth="1"
            />
          </svg>
          <div className="absolute right-2 top-2 text-xs font-medium text-red-700 dark:text-red-400">
            {formatCurrencyCompact(maxVolume)}
          </div>
          <div className="absolute right-2 bottom-2 text-xs font-medium text-red-700 dark:text-red-400">
            0
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          <span className="text-sm font-bold text-foreground">BUY</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-foreground">SELL</span>
          <TrendingDown className="h-4 w-4 text-red-500" />
        </div>
      </div>
    </div>
  );
}

// ==================== WHALE COMPONENTS ====================

function HotMarketCard({
  market,
  index,
}: {
  market: ReturnType<typeof getHotMarkets>[0];
  index: number;
}) {
  const isBullish = market.sentiment === "bullish";
  const isBearish = market.sentiment === "bearish";
  const sellRatio = 1 - market.buyRatio;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Link href={`/events/detail/${market.eventSlug || market.slug}`}>
        <Card className="bg-card/90 hover:bg-card border-border hover:border-primary/50 transition-[background-color,border-color] duration-150 cursor-pointer group shadow-sm">
          <CardContent className="p-3">
            <h4 className="font-bold text-base text-foreground line-clamp-2 mb-2 group-hover:text-primary transition-colors">
              {market.title}
            </h4>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-foreground/70 font-medium">
                <Users className="h-3.5 w-3.5 inline mr-1.5 text-foreground/60" />
                {market.whaleCount} whales
              </span>
              <span className="text-foreground/70 font-medium">
                {market.tradeCount} trades
              </span>
            </div>
            <div className="h-3 rounded-full overflow-hidden flex mb-2">
              <div
                className="h-full bg-linear-to-r from-emerald-600 to-emerald-500 dark:from-emerald-500 dark:to-emerald-400"
                style={{ width: `${market.buyRatio * 100}%` }}
              />
              <div
                className="h-full bg-linear-to-l from-red-600 to-red-500 dark:from-red-500 dark:to-red-400"
                style={{ width: `${sellRatio * 100}%` }}
              />
            </div>
            <div className="flex items-center text-sm">
              <span className="text-emerald-600 dark:text-emerald-400 font-bold flex-1 text-left">
                Buy {formatCurrencyCompact(market.buyVolume)}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs px-2 py-0.5 font-semibold shrink-0 mx-2",
                  isBullish &&
                    "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-400",
                  isBearish &&
                    "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-400",
                  !isBullish &&
                    !isBearish &&
                    "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-400"
                )}
              >
                {isBullish ? "Bullish" : isBearish ? "Bearish" : "Neutral"}
              </Badge>
              <span className="text-red-600 dark:text-red-400 font-bold flex-1 text-right">
                Sell {formatCurrencyCompact(market.sellVolume)}
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}

function TopWhaleCard({
  whale,
  index,
}: {
  whale: ReturnType<typeof getTopWhales>[0];
  index: number;
}) {
  const isBuying = whale.buyVolume > whale.sellVolume;
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Link href={`/profile/${whale.address}`}>
        <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-card/80 hover:bg-card border border-border hover:border-primary/50 transition-[background-color,border-color] duration-150 group shadow-sm">
          <div className="relative">
            <Avatar className="h-10 w-10 border-2 border-amber-400">
              {whale.profileImage && (
                <AvatarImage
                  src={whale.profileImage}
                  alt={whale.name || "Whale"}
                />
              )}
              <AvatarFallback className="bg-linear-to-br from-amber-500 to-orange-500 text-white text-xs font-bold">
                {getInitials(whale.name, whale.address)}
              </AvatarFallback>
            </Avatar>
            {whale.rank > 0 && (
              <span className="absolute -bottom-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold border-2 border-background">
                {whale.rank}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-foreground truncate group-hover:text-primary transition-colors">
              {whale.name || formatAddress(whale.address)}
            </div>
            <div className="text-xs text-foreground/70 font-medium">
              {whale.tradeCount} trades • {whale.marketCount} markets
            </div>
          </div>
          <div className="text-right">
            <div
              className={cn(
                "text-sm font-bold",
                isBuying
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              {formatCurrencyCompact(whale.totalVolume)}
            </div>
            <div className="text-[10px] text-foreground/60 font-medium">
              {isBuying ? "Net Buyer" : "Net Seller"}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function RecentActivityRow({
  activity,
  index,
  animatedIds,
  maxIds,
}: {
  activity: WhaleActivity;
  index: number;
  animatedIds: Set<string>;
  maxIds: number;
}) {
  const isBuy = activity.trade.side === "BUY";
  const shouldAnimate = !animatedIds.has(activity.id);
  useEffect(() => {
    animatedIds.add(activity.id);
    if (animatedIds.size > maxIds) {
      const iter = animatedIds.values();
      const excess = animatedIds.size - maxIds;
      for (let i = 0; i < excess; i++) {
        const oldest = iter.next().value;
        if (oldest !== undefined) animatedIds.delete(oldest);
      }
    }
  }, [animatedIds, activity.id, maxIds]);

  return (
    <motion.div
      initial={shouldAnimate ? { opacity: 0, y: 5 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldAnimate ? { delay: index * 0.02 } : { duration: 0 }}
      className="flex items-center gap-3 py-3.5 border-b border-border last:border-0"
    >
      <div
        className={cn(
          "flex items-center justify-center w-9 h-9 rounded-full shrink-0",
          isBuy
            ? "bg-emerald-100 dark:bg-emerald-900/40"
            : "bg-red-100 dark:bg-red-900/40"
        )}
      >
        {isBuy ? (
          <ArrowUpRight className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <ArrowDownRight className="h-5 w-5 text-red-600 dark:text-red-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/profile/${activity.trader.address}`}
            className="font-bold text-sm text-foreground hover:text-primary transition-colors"
          >
            {activity.trader.name || formatAddress(activity.trader.address)}
          </Link>
          {activity.trader.rank > 0 && (
            <Badge
              variant="outline"
              className="text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-400 font-semibold"
            >
              #{activity.trader.rank}
            </Badge>
          )}
          {activity.source === "global_scan" && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-blue-400 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
            >
              New
            </Badge>
          )}
          <span
            className={cn(
              "text-sm font-semibold",
              isBuy
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            )}
          >
            {isBuy ? "bought" : "sold"}
          </span>
          <span className="text-sm text-foreground/70 font-medium">
            {activity.trade.outcome} @ {(activity.trade.price * 100).toFixed(0)}
            ¢
          </span>
        </div>
        <Link
          href={`/events/detail/${activity.market.eventSlug || activity.market.slug}`}
          className="text-sm text-foreground/60 hover:text-foreground transition-colors line-clamp-1 mt-0.5"
        >
          {activity.market.title}
        </Link>
      </div>
      <div className="text-right shrink-0">
        <div
          className={cn(
            "text-base font-bold",
            isBuy
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          )}
        >
          {formatCurrencyCompact(activity.trade.usdcAmount)}
        </div>
        <div className="text-xs text-foreground/60 font-medium">
          {formatTimeAgo(activity.timestamp)}
        </div>
      </div>
    </motion.div>
  );
}

// ==================== INSIDER COMPONENTS ====================

function ConfidenceBadge({
  confidence,
}: {
  confidence: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold",
        getConfidenceBgColor(confidence)
      )}
    >
      <AlertTriangle
        className={cn("h-3 w-3", getConfidenceColor(confidence))}
      />
      <span className={getConfidenceColor(confidence)}>{confidence}</span>
    </div>
  );
}

function FactorBreakdown({
  factors,
  isOpen,
  onToggle,
}: {
  factors: { name: string; points: number; description: string }[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground/80 transition-colors mt-1"
      >
        {isOpen ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        <span>
          {isOpen ? "Hide" : "Show"} factor breakdown ({factors.length})
        </span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1">
              {factors.map((factor) => (
                <div
                  key={factor.name}
                  className="flex items-center gap-2 text-xs"
                >
                  <div className="w-16 text-right font-bold text-foreground/80">
                    +{factor.points}
                  </div>
                  <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        factor.points >= 20
                          ? "bg-red-500"
                          : factor.points >= 10
                            ? "bg-orange-500"
                            : "bg-yellow-500"
                      )}
                      style={{ width: `${Math.min(factor.points * 3, 100)}%` }}
                    />
                  </div>
                  <div className="flex-1 text-foreground/60 truncate">
                    {factor.description}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InsiderActivityRow({
  activity,
  index,
}: {
  activity: SuspiciousActivity;
  index: number;
}) {
  const [showFactors, setShowFactors] = useState(false);
  const isBuy = activity.trade.side === "BUY";

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      className={cn(
        "p-3 rounded-xl transition-colors",
        "hover:bg-slate-100 dark:hover:bg-slate-800/60",
        index % 2 === 0
          ? "bg-slate-50/50 dark:bg-slate-800/30"
          : "bg-transparent"
      )}
    >
      <div className="flex items-center gap-3">
        <ConfidenceBadge confidence={activity.analysis.confidence} />

        <Link
          href={`/profile/${activity.account.address}`}
          className="shrink-0 group"
        >
          <Avatar className="h-9 w-9 ring-2 ring-amber-400/50 group-hover:ring-amber-400 transition-shadow duration-150">
            <AvatarImage
              src={activity.account.profileImage || undefined}
              alt={activity.account.name || "Trader"}
            />
            <AvatarFallback className="bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-xs font-bold">
              <UserPlus className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/profile/${activity.account.address}`}
              className="text-sm font-bold text-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
            >
              {activity.account.name || formatAddress(activity.account.address)}
            </Link>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30"
            >
              {formatAccountAge(activity.account.accountAgeHours)} old
            </Badge>
            {activity.analysis.repeatOffender && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-purple-400 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30"
              >
                <Repeat className="h-2.5 w-2.5 mr-0.5" />
                {activity.analysis.marketsInvolved} mkts
              </Badge>
            )}
            <span
              className={cn(
                "text-sm font-semibold",
                isBuy
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              {isBuy ? "bought" : "sold"}
            </span>
            <span className="text-sm text-foreground/70 font-medium">
              {activity.trade.outcome} @{" "}
              {(activity.trade.price * 100).toFixed(0)}¢
            </span>
          </div>
          <Link
            href={`/events/detail/${activity.market.eventSlug || activity.market.slug}`}
            className="text-sm text-foreground/60 hover:text-foreground transition-colors line-clamp-1 mt-0.5"
          >
            {activity.market.title}
          </Link>
          <FactorBreakdown
            factors={activity.analysis.factors}
            isOpen={showFactors}
            onToggle={() => setShowFactors(!showFactors)}
          />
        </div>

        <div className="text-right shrink-0">
          <div
            className={cn(
              "text-base font-bold",
              isBuy
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            )}
          >
            {formatCurrencyCompact(activity.trade.usdcAmount)}
          </div>
          <div className="text-xs text-foreground/60 font-medium">
            Market: {(activity.market.currentPrice * 100).toFixed(0)}%
          </div>
          <div className="text-xs text-foreground/50">
            {formatTimeAgo(activity.timestamp)}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function InsiderStatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "warning" | "neutral";
}) {
  return (
    <Card className="bg-card/80 backdrop-blur-sm border-border shadow-sm overflow-hidden relative">
      <div
        className={cn(
          "absolute inset-0 opacity-5",
          trend === "up" && "bg-emerald-500",
          trend === "down" && "bg-red-500",
          trend === "warning" && "bg-amber-500",
          !trend && "bg-slate-500"
        )}
      />
      <CardContent className="p-4 relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wide">
              {title}
            </p>
            <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
            <p className="text-xs text-foreground/60 mt-1">{subtitle}</p>
          </div>
          <div
            className={cn(
              "p-2.5 rounded-xl",
              trend === "up" && "bg-emerald-100 dark:bg-emerald-900/40",
              trend === "down" && "bg-red-100 dark:bg-red-900/40",
              trend === "warning" && "bg-amber-100 dark:bg-amber-900/40",
              !trend && "bg-slate-100 dark:bg-slate-800"
            )}
          >
            <Icon
              className={cn(
                "h-5 w-5",
                trend === "up" && "text-emerald-600 dark:text-emerald-400",
                trend === "down" && "text-red-600 dark:text-red-400",
                trend === "warning" && "text-amber-600 dark:text-amber-400",
                !trend && "text-foreground/70"
              )}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== SKELETONS ====================

function InsiderLoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={`is-${i}`} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={`ia-${i}`} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={`ws-${i}`} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={`wm-${i}`} className="h-36 rounded-xl" />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-8 w-32" />
          {[...Array(5)].map((_, i) => (
            <Skeleton key={`ww-${i}`} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== MAIN PAGE ====================

export default function WhalesPage() {
  const [activeTab, setActiveTab] = useState<ViewTab>("whales");
  const [timePeriod, setTimePeriod] = useState("24h");
  const [minTradeSize, setMinTradeSize] = useState("100");
  const animatedActivityIdsRef = useRef<Set<string>>(new Set());
  const MAX_ANIMATED_IDS = 500;

  // Insider state
  const [insiderSensitivity, setInsiderSensitivity] =
    useState<InsiderSensitivity>("balanced");
  const [insiderSortMode, setInsiderSortMode] =
    useState<InsiderSortMode>("suspicion");

  const sensitivityPreset = SENSITIVITY_PRESETS[insiderSensitivity];

  const selectedPeriod = TIME_PERIODS.find((p) => p.value === timePeriod);
  const apiTimePeriod = selectedPeriod?.apiPeriod || "DAY";

  // Whale Activity Query
  const { data, isLoading, error, refetch, isFetching } = useWhaleActivity({
    whaleCount: 25,
    minTradeSize: Number.parseFloat(minTradeSize),
    tradesPerWhale: 25,
    timePeriod: apiTimePeriod,
    enabled: activeTab === "whales",
  });

  // Insider Activity Query — uses sensitivity preset
  const {
    data: insiderData,
    isLoading: insiderLoading,
    error: insiderError,
    refetch: refetchInsiders,
    isFetching: insiderFetching,
  } = useInsiderActivity({
    maxAccountAge: sensitivityPreset.maxAccountAge,
    minUsdValue: sensitivityPreset.minUsdValue,
    minScore: sensitivityPreset.minScore,
    limit: 200,
    enabled: activeTab === "insiders",
  });

  const filteredActivities = data?.activities ?? [];

  // Collect token IDs from hot markets for the live WebSocket feed
  const hotMarkets = useMemo(
    () => getHotMarkets(filteredActivities),
    [filteredActivities]
  );
  const topWhales = useMemo(
    () => getTopWhales(filteredActivities),
    [filteredActivities]
  );
  const stats = useMemo(
    () => getWhaleActivityStats(filteredActivities),
    [filteredActivities]
  );

  // Sorted insider activities
  const sortedInsiderActivities = useMemo(() => {
    if (!insiderData?.activities) return [];
    return sortInsiderActivities(insiderData.activities, insiderSortMode);
  }, [insiderData?.activities, insiderSortMode]);

  const insiderStats = useMemo(
    () => getInsiderActivityStats(insiderData?.activities ?? []),
    [insiderData?.activities]
  );

  // Live feed — subscribe to actual token IDs (not condition IDs)
  const liveAssetIds = useMemo(() => {
    return hotMarkets
      .flatMap((m) => m.tokenIdList)
      .filter(Boolean)
      .slice(0, 20);
  }, [hotMarkets]);

  const {
    liveTrades,
    isConnected: isLiveConnected,
    tradeCount: liveTradeCount,
  } = useWhaleLiveFeed({
    assetIds: liveAssetIds,
    minTradeSize: Number.parseFloat(minTradeSize),
    enabled: activeTab === "whales" && liveAssetIds.length > 0,
  });

  return (
    <div className="min-h-screen flex flex-col bg-linear-to-b from-slate-50 via-white to-slate-50 dark:from-background dark:via-background dark:to-background relative overflow-x-hidden selection:bg-purple-500/30">
      <PageBackground />
      <Navbar />

      <main className="relative z-10 flex-1 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-24 xl:pb-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-6"
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="p-3 rounded-2xl bg-linear-to-br from-cyan-500 to-blue-500 shadow-lg shadow-cyan-500/25">
              <Fish className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Whale Tracker
              </h1>
              <p className="text-foreground/70 text-base font-medium">
                {activeTab === "whales"
                  ? "See what the top traders are buying and selling"
                  : "Detect potential insider activity from new accounts"}
              </p>
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex items-center gap-2 mb-4 p-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-xl w-fit border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setActiveTab("whales")}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-[background-color,box-shadow] duration-150",
                activeTab === "whales"
                  ? "bg-white dark:bg-slate-900 text-foreground shadow-sm"
                  : "text-foreground/60 hover:text-foreground hover:bg-white/50 dark:hover:bg-slate-900/50"
              )}
            >
              <Fish className="h-4 w-4" />
              <span>Whale Activity</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("insiders")}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-[background-color,box-shadow] duration-150",
                activeTab === "insiders"
                  ? "bg-amber-500 text-white shadow-sm"
                  : "text-foreground/60 hover:text-foreground hover:bg-amber-100 dark:hover:bg-amber-900/30"
              )}
            >
              <Eye className="h-4 w-4" />
              <span>Insider Detection</span>
              {insiderData && insiderData.stats.suspiciousActivities > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-500 text-white">
                  {insiderData.stats.suspiciousActivities}
                </span>
              )}
            </button>
          </div>

          {/* Filters Bar */}
          <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 shadow-sm">
            {activeTab === "whales" && (
              <>
                {/* Mobile Dropdowns */}
                <div className="flex items-center gap-3 sm:hidden">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-foreground/60 font-medium">
                      Period:
                    </span>
                    <Select value={timePeriod} onValueChange={setTimePeriod}>
                      <SelectTrigger
                        className="h-9 px-3 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 rounded-xl font-semibold"
                        aria-label="Period"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_PERIODS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {getPeriodLabel(p.value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-foreground/60 font-medium">
                      Min:
                    </span>
                    <Select
                      value={minTradeSize}
                      onValueChange={setMinTradeSize}
                    >
                      <SelectTrigger
                        className="h-9 px-3 bg-cyan-500 text-white border-cyan-500 rounded-xl font-semibold"
                        aria-label="Minimum trade size"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRADE_SIZE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Desktop Pills */}
                <div className="hidden sm:flex items-center gap-4">
                  <div className="flex items-center gap-1.5 p-1.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    {TIME_PERIODS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setTimePeriod(p.value)}
                        className={cn(
                          "px-4 py-2 rounded-lg text-sm font-semibold transition-[background-color,box-shadow] duration-150",
                          timePeriod === p.value
                            ? "bg-primary text-primary-foreground shadow-md"
                            : "text-foreground/70 hover:text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
                        )}
                      >
                        {getPeriodLabel(p.value)}
                      </button>
                    ))}
                  </div>
                  <div className="h-10 w-px bg-slate-300 dark:bg-slate-600" />
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-foreground/80 font-semibold whitespace-nowrap">
                      Min Trade:
                    </span>
                    <div className="flex items-center gap-1.5 p-1.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                      {TRADE_SIZE_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => setMinTradeSize(o.value)}
                          className={cn(
                            "px-3 py-2 rounded-lg text-sm font-semibold transition-[background-color,box-shadow] duration-150",
                            minTradeSize === o.value
                              ? "bg-cyan-500 text-white shadow-md"
                              : "text-foreground/70 hover:text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === "insiders" && (
              <>
                {/* Mobile */}
                <div className="flex items-center gap-3 sm:hidden">
                  <Select
                    value={insiderSensitivity}
                    onValueChange={(v) =>
                      setInsiderSensitivity(v as InsiderSensitivity)
                    }
                  >
                    <SelectTrigger
                      className="h-9 px-3 bg-amber-500 text-white border-amber-500 rounded-xl font-semibold"
                      aria-label="Sensitivity"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.keys(SENSITIVITY_PRESETS) as InsiderSensitivity[]
                      ).map((k) => (
                        <SelectItem key={k} value={k}>
                          {SENSITIVITY_PRESETS[k].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={insiderSortMode}
                    onValueChange={(v) =>
                      setInsiderSortMode(v as InsiderSortMode)
                    }
                  >
                    <SelectTrigger
                      className="h-9 px-3 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 rounded-xl font-semibold"
                      aria-label="Sort by"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INSIDER_SORT_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Desktop */}
                <div className="hidden sm:flex items-center gap-4">
                  <div className="flex items-center gap-3">
                    <Gauge className="h-4 w-4 text-foreground/60" />
                    <span className="text-sm text-foreground/80 font-semibold whitespace-nowrap">
                      Sensitivity:
                    </span>
                    <div className="flex items-center gap-1.5 p-1.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                      {(
                        Object.keys(SENSITIVITY_PRESETS) as InsiderSensitivity[]
                      ).map((k) => (
                        <TooltipProvider key={k}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => setInsiderSensitivity(k)}
                                className={cn(
                                  "px-3 py-2 rounded-lg text-sm font-semibold transition-[background-color,box-shadow] duration-150",
                                  insiderSensitivity === k
                                    ? "bg-amber-500 text-white shadow-md"
                                    : "text-foreground/70 hover:text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
                                )}
                              >
                                {SENSITIVITY_PRESETS[k].label}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {SENSITIVITY_PRESETS[k].description}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ))}
                    </div>
                  </div>
                  <div className="h-10 w-px bg-slate-300 dark:bg-slate-600" />
                  <div className="flex items-center gap-3">
                    <SortAsc className="h-4 w-4 text-foreground/60" />
                    <span className="text-sm text-foreground/80 font-semibold whitespace-nowrap">
                      Sort:
                    </span>
                    <div className="flex items-center gap-1.5 p-1.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                      {INSIDER_SORT_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => setInsiderSortMode(o.value)}
                          className={cn(
                            "px-3 py-2 rounded-lg text-sm font-semibold transition-[background-color,box-shadow] duration-150",
                            insiderSortMode === o.value
                              ? "bg-purple-500 text-white shadow-md"
                              : "text-foreground/70 hover:text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="flex-1" />

            {/* Refresh */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      activeTab === "whales" ? refetch() : refetchInsiders()
                    }
                    disabled={
                      activeTab === "whales" ? isFetching : insiderFetching
                    }
                    className="rounded-xl gap-2 font-semibold h-10 px-4 border-slate-300 dark:border-slate-600"
                  >
                    <RefreshCw
                      className={cn(
                        "h-4 w-4",
                        (activeTab === "whales"
                          ? isFetching
                          : insiderFetching) && "animate-spin"
                      )}
                    />
                    <span className="hidden sm:inline">Refresh</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh data</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Freshness + Stats */}
            {activeTab === "whales" && data && (
              <div className="hidden md:flex items-center gap-3">
                <DataFreshnessBadge
                  lastUpdated={data.lastUpdated}
                  dataAge={data.dataAge}
                  isLive={isLiveConnected}
                />
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm">
                  <span className="text-sm text-foreground/80 font-medium">
                    <span className="font-bold text-foreground">
                      {data.whaleCount}
                    </span>{" "}
                    whales
                  </span>
                  <span className="text-slate-400 dark:text-slate-500">•</span>
                  <span className="text-sm text-foreground/80 font-medium">
                    <span className="font-bold text-foreground">
                      {filteredActivities.length}
                    </span>{" "}
                    trades
                  </span>
                  {stats.globalScanCount > 0 && (
                    <>
                      <span className="text-slate-400 dark:text-slate-500">
                        •
                      </span>
                      <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                        <Zap className="h-3 w-3 inline mr-0.5" />
                        {stats.globalScanCount} new
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
            {activeTab === "insiders" && insiderData && (
              <div className="hidden md:flex items-center gap-3">
                <DataFreshnessBadge lastUpdated={insiderData.lastUpdated} />
              </div>
            )}
          </div>
        </motion.div>

        {/* ========== WHALE VIEW ========== */}
        {activeTab === "whales" && (
          <>
            {isLoading && <LoadingSkeleton />}
            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-12 px-4 rounded-2xl bg-destructive/5 border border-destructive/20"
              >
                <Fish className="h-10 w-10 text-destructive mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-destructive mb-2">
                  Failed to load whale data
                </h3>
                <p className="text-muted-foreground mb-4">{error.message}</p>
                <Button
                  variant="outline"
                  onClick={() => refetch()}
                  className="rounded-xl"
                >
                  Try Again
                </Button>
              </motion.div>
            )}

            {!isLoading && !error && data && (
              <>
                {/* Live Feed Banner */}
                {isLiveConnected && liveTrades.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-3 rounded-xl bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Wifi className="h-4 w-4 text-cyan-600 dark:text-cyan-400 animate-pulse" />
                      <span className="text-sm font-bold text-cyan-700 dark:text-cyan-300">
                        Live Feed
                      </span>
                      <span className="text-xs text-cyan-600 dark:text-cyan-400">
                        {liveTradeCount} trades detected
                      </span>
                    </div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {liveTrades.slice(0, 5).map((trade) => (
                        <div
                          key={trade.id}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span
                            className={cn(
                              "font-bold",
                              trade.side === "BUY"
                                ? "text-emerald-600"
                                : "text-red-600"
                            )}
                          >
                            {trade.side}
                          </span>
                          <span className="font-bold text-foreground">
                            {formatCurrencyCompact(trade.usdcAmount)}
                          </span>
                          <span className="text-foreground/60">
                            @ {(trade.price * 100).toFixed(0)}¢
                          </span>
                          <span className="text-foreground/40 ml-auto">
                            {formatTimeAgo(trade.timestamp)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Stats Row */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"
                >
                  <StatCard
                    title="Total Volume"
                    value={formatCurrencyCompact(stats.totalVolume)}
                    subtitle={`${stats.totalTrades} trades from ${stats.uniqueTraders} whales`}
                    icon={BarChart3}
                  />
                  <StatCard
                    title="Buy Pressure"
                    value={formatCurrencyCompact(stats.totalBuyVolume)}
                    subtitle={`${stats.buyCount} buy orders`}
                    icon={TrendingUp}
                    trend="up"
                  />
                  <StatCard
                    title="Sell Pressure"
                    value={formatCurrencyCompact(stats.totalSellVolume)}
                    subtitle={`${stats.sellCount} sell orders`}
                    icon={TrendingDown}
                    trend="down"
                  />
                  <StatCard
                    title="Market Sentiment"
                    value={
                      stats.sentiment === "bullish"
                        ? "Bullish"
                        : stats.sentiment === "bearish"
                          ? "Bearish"
                          : "Neutral"
                    }
                    subtitle={`${(stats.buyRatio * 100).toFixed(0)}% of volume is buying`}
                    icon={Activity}
                    trend={
                      stats.sentiment === "bullish"
                        ? "up"
                        : stats.sentiment === "bearish"
                          ? "down"
                          : "neutral"
                    }
                  />
                </motion.div>

                {/* Buy vs Sell Chart */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="mb-6 p-4 rounded-2xl bg-card/80 backdrop-blur-sm border border-border shadow-sm"
                >
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <BarChart3 className="h-5 w-5 text-foreground/70" />
                    <span className="text-base font-bold text-foreground">
                      Buy vs Sell Pressure
                    </span>
                  </div>
                  <BuySellAreaChart
                    activities={filteredActivities}
                    buyVolume={stats.totalBuyVolume}
                    sellVolume={stats.totalSellVolume}
                    buyCount={stats.buyCount}
                    sellCount={stats.sellCount}
                  />
                </motion.div>

                {/* Two Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="lg:col-span-2"
                  >
                    <Card className="bg-card/80 backdrop-blur-sm border-border shadow-sm">
                      <CardHeader className="px-4 py-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Flame className="h-5 w-5 text-orange-500" />
                          <span className="text-foreground font-bold">
                            Hot Markets
                          </span>
                          <span className="text-sm font-medium text-foreground/60 ml-1">
                            Where whales are most active
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 pt-0">
                        {hotMarkets.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {hotMarkets.map((m, i) => (
                              <HotMarketCard key={m.id} market={m} index={i} />
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8 text-foreground/60">
                            <Target className="h-10 w-10 mx-auto mb-3 opacity-60" />
                            <p className="text-base font-medium">
                              No market activity in this time period
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                  >
                    <Card className="bg-card/80 backdrop-blur-sm border-border shadow-sm">
                      <CardHeader className="px-4 py-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Crown className="h-5 w-5 text-amber-500" />
                          <span className="text-foreground font-bold">
                            Most Active Whales
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 px-4 pb-4 pt-0">
                        {topWhales.length > 0 ? (
                          topWhales.map((w, i) => (
                            <TopWhaleCard key={w.address} whale={w} index={i} />
                          ))
                        ) : (
                          <div className="text-center py-8 text-foreground/60">
                            <Users className="h-10 w-10 mx-auto mb-3 opacity-60" />
                            <p className="text-base font-medium">
                              No whale activity
                            </p>
                          </div>
                        )}
                        <Link href="/leaderboard">
                          <Button
                            variant="outline"
                            className="w-full mt-3 text-sm font-semibold text-foreground/80 hover:text-foreground border-border"
                          >
                            View Full Leaderboard
                            <ArrowRight className="h-4 w-4 ml-2" />
                          </Button>
                        </Link>
                      </CardContent>
                    </Card>
                  </motion.div>
                </div>

                {/* Recent Activity Feed */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="mt-6"
                >
                  <Card className="bg-card/80 backdrop-blur-sm border-border shadow-sm">
                    <CardHeader className="px-4 py-3">
                      <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-lg">
                          <Clock className="h-5 w-5 text-blue-500" />
                          <span className="text-foreground font-bold">
                            Recent Activity
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-foreground/70 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-lg">
                          {filteredActivities.length} trades
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-0">
                      {filteredActivities.length > 0 ? (
                        <VList style={{ height: 500 }} className="pr-2">
                          {filteredActivities
                            .slice(0, 100)
                            .map((activity, index) => (
                              <RecentActivityRow
                                key={`${activity.id}-${index}`}
                                activity={activity}
                                index={index}
                                animatedIds={animatedActivityIdsRef.current}
                                maxIds={MAX_ANIMATED_IDS}
                              />
                            ))}
                        </VList>
                      ) : (
                        <div className="text-center py-10 text-foreground/60">
                          <Activity className="h-10 w-10 mx-auto mb-3 opacity-60" />
                          <p className="text-base font-medium">
                            No activity in this time period
                          </p>
                          <p className="text-sm mt-2 text-foreground/50">
                            Try selecting a longer time range
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </>
            )}
          </>
        )}

        {/* ========== INSIDER DETECTION VIEW ========== */}
        {activeTab === "insiders" && (
          <>
            {insiderLoading && <InsiderLoadingSkeleton />}
            {insiderError && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-12 px-4 rounded-2xl bg-destructive/5 border border-destructive/20"
              >
                <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-destructive mb-2">
                  Failed to load insider data
                </h3>
                <p className="text-muted-foreground mb-4">
                  {insiderError.message}
                </p>
                <Button
                  variant="outline"
                  onClick={() => refetchInsiders()}
                  className="rounded-xl"
                >
                  Try Again
                </Button>
              </motion.div>
            )}

            {!insiderLoading && !insiderError && insiderData && (
              <>
                {/* Stats Row */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"
                >
                  <InsiderStatCard
                    title="Suspicious Activities"
                    value={insiderData.stats.suspiciousActivities}
                    subtitle={`${insiderData.stats.newAccountsFound} new accounts`}
                    icon={AlertTriangle}
                    trend="warning"
                  />
                  <InsiderStatCard
                    title="Critical / High"
                    value={`${insiderData.stats.criticalCount} / ${insiderData.stats.highCount}`}
                    subtitle="Highest confidence flags"
                    icon={Shield}
                    trend={
                      insiderData.stats.criticalCount > 0 ? "down" : "neutral"
                    }
                  />
                  <InsiderStatCard
                    title="Total Volume"
                    value={formatCurrencyCompact(insiderStats.totalVolume)}
                    subtitle={`${insiderStats.uniqueAccounts} unique accounts`}
                    icon={BarChart3}
                  />
                  <InsiderStatCard
                    title="Repeat Offenders"
                    value={insiderData.stats.repeatOffenders}
                    subtitle="Active across multiple markets"
                    icon={Repeat}
                    trend={
                      insiderData.stats.repeatOffenders > 0 ? "warning" : "up"
                    }
                  />
                </motion.div>

                {/* Suspicious Activity Feed */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <Card className="bg-card/80 backdrop-blur-sm border-border shadow-sm">
                    <CardHeader className="px-4 py-3">
                      <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-lg">
                          <Eye className="h-5 w-5 text-amber-500" />
                          <span className="text-foreground font-bold">
                            Suspicious Activity
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-3 py-1 rounded-lg">
                            {sortedInsiderActivities.length} flagged
                          </span>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-0">
                      {sortedInsiderActivities.length > 0 ? (
                        <VList style={{ height: 600 }} className="pr-2">
                          {sortedInsiderActivities.map((activity, index) => (
                            <InsiderActivityRow
                              key={`${activity.id}-${index}`}
                              activity={activity}
                              index={index}
                            />
                          ))}
                        </VList>
                      ) : (
                        <div className="text-center py-10 text-foreground/60">
                          <Shield className="h-10 w-10 mx-auto mb-3 opacity-60 text-emerald-500" />
                          <p className="text-base font-medium text-emerald-600 dark:text-emerald-400">
                            No suspicious activity detected
                          </p>
                          <p className="text-sm mt-2 text-foreground/50">
                            All clear! Try the &quot;Aggressive&quot;
                            sensitivity to cast a wider net.
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>

                {/* Info Section */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="mt-8 p-6 rounded-2xl bg-linear-to-br from-amber-100/80 to-orange-100/80 dark:from-amber-900/30 dark:to-orange-900/30 border border-amber-300 dark:border-amber-700 shadow-sm"
                >
                  <h3 className="text-base font-bold mb-3 flex items-center gap-2 text-foreground">
                    <Eye className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    How Insider Detection Works
                  </h3>
                  <ul className="text-sm text-foreground/80 space-y-2.5">
                    <li className="flex items-start gap-3">
                      <span className="text-amber-600 dark:text-amber-400 font-bold text-lg leading-none">
                        •
                      </span>
                      <span>
                        <strong className="text-foreground">
                          Confidence Levels
                        </strong>{" "}
                        — CRITICAL, HIGH, MEDIUM, LOW based on a weighted
                        multi-factor score
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-amber-600 dark:text-amber-400 font-bold text-lg leading-none">
                        •
                      </span>
                      <span>
                        <strong className="text-foreground">Factors</strong> —
                        Account age, trade count, contrarian position, trade
                        size, repeat patterns, size/age ratio
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-amber-600 dark:text-amber-400 font-bold text-lg leading-none">
                        •
                      </span>
                      <span>
                        <strong className="text-foreground">
                          Repeat Offenders
                        </strong>{" "}
                        — Wallets flagged across multiple different markets are
                        scored higher
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-amber-600 dark:text-amber-400 font-bold text-lg leading-none">
                        •
                      </span>
                      <span>
                        <strong className="text-foreground">
                          Sensitivity Presets
                        </strong>{" "}
                        — Conservative for high-confidence only, Aggressive to
                        catch more (with more false positives)
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-amber-600 dark:text-amber-400 font-bold text-lg leading-none">
                        •
                      </span>
                      <span>
                        <strong className="text-red-500">Disclaimer</strong> —
                        This is for informational purposes only. Not all flagged
                        activity is malicious.
                      </span>
                    </li>
                  </ul>
                </motion.div>
              </>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border py-6 bg-background/80 backdrop-blur-xl hidden xl:block">
        <div className="px-3 sm:px-4 md:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-foreground/70">
          <div className="flex items-center gap-2 font-medium">
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
          <span className="font-medium">&copy; {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
