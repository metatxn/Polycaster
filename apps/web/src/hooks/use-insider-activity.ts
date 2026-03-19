"use client";

import { useQuery } from "@tanstack/react-query";

export interface SuspicionFactor {
  name: string;
  points: number;
  description: string;
}

export interface SuspiciousAccount {
  address: string;
  name: string | null;
  profileImage: string | null;
  firstTradeDate: string | null;
  accountAgeHours: number;
  totalTrades: number;
}

export interface SuspiciousTrade {
  side: "BUY" | "SELL";
  outcome: string;
  outcomeIndex: number;
  size: number;
  price: number;
  usdcAmount: number;
}

export interface SuspiciousMarket {
  conditionId: string;
  title: string;
  slug: string;
  eventSlug: string;
  image?: string;
  currentPrice: number;
}

export interface SuspiciousAnalysis {
  suspicionScore: number;
  confidence: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  isContrarian: boolean;
  marketSentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  reason: string;
  factors: SuspicionFactor[];
  repeatOffender: boolean;
  marketsInvolved: number;
}

export interface SuspiciousActivity {
  id: string;
  timestamp: string;
  account: SuspiciousAccount;
  trade: SuspiciousTrade;
  market: SuspiciousMarket;
  analysis: SuspiciousAnalysis;
}

export interface SuspiciousActivityStats {
  totalTradesScanned: number;
  uniqueTradersFound: number;
  newAccountsFound: number;
  suspiciousActivities: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  repeatOffenders: number;
}

export interface SuspiciousActivityResponse {
  success: boolean;
  activities: SuspiciousActivity[];
  stats: SuspiciousActivityStats;
  lastUpdated: string;
  error?: string;
}

export type InsiderSortMode =
  | "suspicion"
  | "amount"
  | "newest_account"
  | "most_repeated";

export type InsiderSensitivity = "conservative" | "balanced" | "aggressive";

export const SENSITIVITY_PRESETS: Record<
  InsiderSensitivity,
  {
    minScore: number;
    maxAccountAge: number;
    minUsdValue: number;
    label: string;
    description: string;
  }
> = {
  conservative: {
    minScore: 50,
    maxAccountAge: 72,
    minUsdValue: 10000,
    label: "Conservative",
    description: "High-confidence flags only",
  },
  balanced: {
    minScore: 30,
    maxAccountAge: 168,
    minUsdValue: 5000,
    label: "Balanced",
    description: "Default detection sensitivity",
  },
  aggressive: {
    minScore: 15,
    maxAccountAge: 336,
    minUsdValue: 1000,
    label: "Aggressive",
    description: "Catches more, more false positives",
  },
};

export interface UseInsiderActivityOptions {
  maxAccountAge?: number;
  minUsdValue?: number;
  minShares?: number;
  minScore?: number;
  limit?: number;
  enabled?: boolean;
  refetchInterval?: number;
}

async function fetchInsiderActivity(
  options: UseInsiderActivityOptions
): Promise<SuspiciousActivityResponse> {
  const params = new URLSearchParams();

  if (options.maxAccountAge) {
    params.set("maxAccountAge", options.maxAccountAge.toString());
  }
  if (options.minUsdValue !== undefined) {
    params.set("minUsdValue", options.minUsdValue.toString());
  }
  if (options.minShares !== undefined && options.minShares > 0) {
    params.set("minShares", options.minShares.toString());
  }
  if (options.minScore !== undefined) {
    params.set("minScore", options.minScore.toString());
  }
  if (options.limit) {
    params.set("limit", options.limit.toString());
  }

  const response = await fetch(`/api/whales/suspicious?${params.toString()}`);

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || "Failed to fetch insider activity");
  }

  return response.json();
}

export function useInsiderActivity(options: UseInsiderActivityOptions = {}) {
  const {
    maxAccountAge = 168,
    minUsdValue = 5000,
    minShares = 0,
    minScore = 30,
    limit = 100,
    enabled = true,
    refetchInterval = 2 * 60 * 1000,
  } = options;

  return useQuery<SuspiciousActivityResponse, Error>({
    queryKey: [
      "insiderActivity",
      maxAccountAge,
      minUsdValue,
      minShares,
      minScore,
      limit,
    ],
    queryFn: () =>
      fetchInsiderActivity({
        maxAccountAge,
        minUsdValue,
        minShares,
        minScore,
        limit,
      }),
    enabled,
    staleTime: 60 * 1000,
    refetchInterval,
  });
}

export function useHighConfidenceInsiders() {
  return useInsiderActivity({
    maxAccountAge: 24,
    minUsdValue: 10000,
    minShares: 1000,
    minScore: 50,
    limit: 25,
  });
}

export function getInsiderActivityStats(activities: SuspiciousActivity[]) {
  const contrarianActivities = activities.filter(
    (a) => a.analysis.isContrarian
  );
  const highScoreActivities = activities.filter((a) => {
    const level = getSuspicionRiskLevel(a.analysis.suspicionScore);
    return level === "HIGH" || level === "CRITICAL";
  });
  const criticalActivities = activities.filter(
    (a) => a.analysis.confidence === "CRITICAL"
  );
  const repeatOffenders = activities.filter((a) => a.analysis.repeatOffender);

  const totalVolume = activities.reduce(
    (sum, a) => sum + a.trade.usdcAmount,
    0
  );

  const uniqueAccounts = new Set(activities.map((a) => a.account.address)).size;
  const uniqueMarkets = new Set(activities.map((a) => a.market.conditionId))
    .size;

  const avgAccountAge =
    activities.length > 0
      ? activities.reduce((sum, a) => sum + a.account.accountAgeHours, 0) /
        activities.length
      : 0;

  const avgSuspicionScore =
    activities.length > 0
      ? activities.reduce((sum, a) => sum + a.analysis.suspicionScore, 0) /
        activities.length
      : 0;

  const sentimentCounts = activities.reduce(
    (acc, a) => {
      acc[a.analysis.marketSentiment]++;
      return acc;
    },
    { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 }
  );

  return {
    totalActivities: activities.length,
    contrarianCount: contrarianActivities.length,
    highScoreCount: highScoreActivities.length,
    criticalCount: criticalActivities.length,
    repeatOffenderCount: repeatOffenders.length,
    totalVolume,
    uniqueAccounts,
    uniqueMarkets,
    avgAccountAge,
    avgSuspicionScore,
    sentimentBreakdown: sentimentCounts,
  };
}

export function sortInsiderActivities(
  activities: SuspiciousActivity[],
  sortMode: InsiderSortMode
): SuspiciousActivity[] {
  const sorted = [...activities];
  switch (sortMode) {
    case "suspicion":
      return sorted.sort(
        (a, b) => b.analysis.suspicionScore - a.analysis.suspicionScore
      );
    case "amount":
      return sorted.sort((a, b) => b.trade.usdcAmount - a.trade.usdcAmount);
    case "newest_account":
      return sorted.sort(
        (a, b) => a.account.accountAgeHours - b.account.accountAgeHours
      );
    case "most_repeated":
      return sorted.sort(
        (a, b) => b.analysis.marketsInvolved - a.analysis.marketsInvolved
      );
    default:
      return sorted;
  }
}

export function getSuspicionRiskLevel(
  score: number
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score >= 75) return "CRITICAL";
  if (score >= 55) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

export function getSuspicionColor(score: number): string {
  if (score >= 75) return "text-red-500";
  if (score >= 55) return "text-orange-500";
  if (score >= 35) return "text-yellow-500";
  return "text-green-500";
}

export function getConfidenceColor(
  confidence: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
): string {
  switch (confidence) {
    case "CRITICAL":
      return "text-red-500";
    case "HIGH":
      return "text-orange-500";
    case "MEDIUM":
      return "text-yellow-500";
    case "LOW":
      return "text-green-500";
  }
}

export function getConfidenceBgColor(
  confidence: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
): string {
  switch (confidence) {
    case "CRITICAL":
      return "bg-red-100 dark:bg-red-900/40";
    case "HIGH":
      return "bg-orange-100 dark:bg-orange-900/40";
    case "MEDIUM":
      return "bg-yellow-100 dark:bg-yellow-900/40";
    case "LOW":
      return "bg-green-100 dark:bg-green-900/40";
  }
}

export function formatAccountAge(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes}m`;
  }
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}
