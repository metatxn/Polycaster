"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";

/**
 * User details from Polymarket
 */
export interface UserDetails {
  rank: number;
  proxyWallet: string;
  userName: string;
  xUsername: string | null;
  verifiedBadge: boolean;
  volume: number;
  pnl: number;
  profileImage: string | null;
}

/**
 * API response structure
 */
interface UserDetailsResponse {
  success: boolean;
  user: string;
  timePeriod: string;
  category: string;
  details: UserDetails | null;
  message?: string;
  error?: string;
}

/**
 * Time period options
 */
export type TimePeriod = "day" | "week" | "month" | "all";

/**
 * Category options
 */
export type Category = "overall" | "crypto" | "sports" | "politics";

/**
 * Query options for fetching user details
 */
export interface UseUserDetailsOptions {
  /** Time period for stats (default: day) */
  timePeriod?: TimePeriod;
  /** Category filter (default: overall) */
  category?: Category;
  /** Enable/disable the query */
  enabled?: boolean;
  /** Override the user address (e.g., use proxy wallet) */
  userAddress?: string;
}

/**
 * Fetch user details from the API
 */
async function fetchUserDetails(
  userAddress: string,
  options: UseUserDetailsOptions
): Promise<UserDetailsResponse> {
  const params = new URLSearchParams({
    user: userAddress,
    timePeriod: options.timePeriod || "day",
    category: options.category || "overall",
  });

  const response = await fetch(`/api/user/details?${params.toString()}`);

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || "Failed to fetch user details");
  }

  return response.json() as Promise<UserDetailsResponse>;
}

/**
 * Hook to fetch user details from Polymarket leaderboard
 *
 * @param options - Query options
 * @returns Query result with user details
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useUserDetails({ timePeriod: 'week' });
 *
 * return (
 *   <div>
 *     <p>Rank: #{data?.details?.rank}</p>
 *     <p>P&L: ${data?.details?.pnl.toFixed(2)}</p>
 *   </div>
 * );
 * ```
 */
export function useUserDetails(options: UseUserDetailsOptions = {}) {
  const { address, isConnected } = useConnection();

  // Use provided address or fall back to connected wallet
  const userAddress = options.userAddress || address;

  return useQuery<UserDetailsResponse, Error>({
    queryKey: [
      "userDetails",
      userAddress,
      options.timePeriod,
      options.category,
    ],
    queryFn: () => {
      if (!userAddress) throw new Error("Address not available");
      return fetchUserDetails(userAddress, options);
    },
    enabled: isConnected && !!userAddress && options.enabled !== false,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}
