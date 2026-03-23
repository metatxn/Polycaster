import { useQuery } from "@tanstack/react-query";

/**
 * Trader Profile Hook
 *
 * Fetches comprehensive trader profile data including stats and rankings.
 */

export interface TraderProfile {
  // Basic Info
  proxyWallet: string;
  userName: string | null;
  profileImage: string | null;
  bio: string | null;
  xUsername: string | null;
  verifiedBadge: boolean;

  // Stats
  totalVolume: number;
  totalPnl: number;
  positionsCount: number;
  tradesCount: number;

  // Rankings
  rankings: {
    overall: { rank: string; pnl: number; vol: number } | null;
    day: { rank: string; pnl: number; vol: number } | null;
    week: { rank: string; pnl: number; vol: number } | null;
    month: { rank: string; pnl: number; vol: number } | null;
  };
}

async function fetchTraderProfile(address: string): Promise<TraderProfile> {
  const response = await fetch(`/api/profile/${address}`);

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || "Failed to fetch profile");
  }

  return response.json();
}

export function useTraderProfile(address?: string) {
  return useQuery({
    queryKey: ["traderProfile", address],
    queryFn: () => fetchTraderProfile(address as string),
    enabled: !!address && address.startsWith("0x"),
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}
