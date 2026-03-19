"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Public profile data structure from Polymarket
 */
export interface PublicProfile {
  createdAt: string;
  proxyWallet: string;
  displayUsernamePublic: boolean;
  pseudonym: string;
  name: string;
  bio?: string;
  profileImage?: string;
  bannerImage?: string;
  website?: string;
  twitter?: string;
  users: Array<{
    id: string;
    creator: boolean;
    mod: boolean;
  }>;
  verifiedBadge: boolean;
}

/**
 * API response structure
 */
interface ProfileResponse {
  success: boolean;
  profile: PublicProfile | null;
  error?: string;
}

/**
 * Fetch public profile from our API route (which proxies to Polymarket)
 */
async function fetchPublicProfile(
  address: string
): Promise<PublicProfile | null> {
  const response = await fetch(`/api/user/public-profile?address=${address}`);

  if (!response.ok) {
    throw new Error("Failed to fetch public profile");
  }

  const data: ProfileResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to fetch profile");
  }

  return data.profile;
}

/**
 * Hook to fetch user's public profile from Polymarket
 *
 * @param address - The wallet address (proxy or main)
 * @returns Query result with profile data
 */
export function usePublicProfile(address?: string) {
  return useQuery<PublicProfile | null, Error>({
    queryKey: ["publicProfile", address],
    queryFn: () => {
      if (!address) throw new Error("Address not available");
      return fetchPublicProfile(address);
    },
    enabled: !!address,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 10 * 60 * 1000, // Refetch every 10 minutes
    retry: (failureCount, error) => {
      // Don't retry if address is invalid or not found
      if (error.message.includes("404")) return false;
      return failureCount < 3;
    },
  });
}
