import { useQuery } from "@tanstack/react-query";

/**
 * Leaderboard Hook
 *
 * Fetches trader leaderboard rankings with filtering options.
 * Reference: https://docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings
 */

export interface LeaderboardTrader {
  rank: string;
  proxyWallet: string;
  userName: string | null;
  vol: number;
  pnl: number;
  profileImage: string | null;
  xUsername: string | null;
  verifiedBadge: boolean;
}

export interface LeaderboardResponse {
  traders: LeaderboardTrader[];
  category: string;
  timePeriod: string;
  orderBy: string;
  total: number;
}

export type LeaderboardCategory =
  | "OVERALL"
  | "POLITICS"
  | "SPORTS"
  | "CRYPTO"
  | "CULTURE"
  | "MENTIONS"
  | "WEATHER"
  | "ECONOMICS"
  | "TECH"
  | "FINANCE";

export type LeaderboardTimePeriod = "DAY" | "WEEK" | "MONTH" | "ALL";

export type LeaderboardOrderBy = "PNL" | "VOL";

export interface UseLeaderboardOptions {
  category?: LeaderboardCategory;
  timePeriod?: LeaderboardTimePeriod;
  orderBy?: LeaderboardOrderBy;
  limit?: number;
  offset?: number;
  user?: string;
  userName?: string;
  enabled?: boolean;
}

async function fetchLeaderboard(
  options: UseLeaderboardOptions
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams();

  if (options.category) params.set("category", options.category);
  if (options.timePeriod) params.set("timePeriod", options.timePeriod);
  if (options.orderBy) params.set("orderBy", options.orderBy);
  if (options.limit) params.set("limit", options.limit.toString());
  if (options.offset) params.set("offset", options.offset.toString());
  if (options.user) params.set("user", options.user);
  if (options.userName) params.set("userName", options.userName);

  const response = await fetch(`/api/leaderboard?${params.toString()}`);

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || "Failed to fetch leaderboard");
  }

  return response.json();
}

export function useLeaderboard(options: UseLeaderboardOptions = {}) {
  const {
    category = "OVERALL",
    timePeriod = "DAY",
    orderBy = "PNL",
    limit = 25,
    offset = 0,
    user,
    userName,
    enabled = true,
  } = options;

  return useQuery({
    queryKey: [
      "leaderboard",
      category,
      timePeriod,
      orderBy,
      limit,
      offset,
      user,
      userName,
    ],
    queryFn: () =>
      fetchLeaderboard({
        category,
        timePeriod,
        orderBy,
        limit,
        offset,
        user,
        userName,
      }),
    enabled,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}

/**
 * Hook to get a specific user's rank
 */
export function useUserRank(userAddress?: string) {
  return useLeaderboard({
    user: userAddress,
    enabled: !!userAddress,
  });
}
