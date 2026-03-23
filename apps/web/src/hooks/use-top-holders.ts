import { useQuery } from "@tanstack/react-query";
import { POLYMARKET_API } from "@/constants/polymarket";

export interface Holder {
  proxyWallet: string;
  bio?: string;
  asset: string; // token ID
  pseudonym?: string; // username
  amount: number; // share count
  displayUsernamePublic: boolean;
  outcomeIndex: number;
  name?: string;
  profileImage?: string;
  profileImageOptimized?: string;
}

export interface TopHoldersResponse {
  token: string; // condition ID
  holders: Holder[];
}

/**
 * Fetch top holders for a specific market using its condition ID
 * @param conditionId - The condition ID of the market
 * @param limit - Max number of holders to return (max 20)
 * @returns Array of top holders for each token associated with the condition ID
 */
async function fetchTopHolders(
  conditionId: string,
  limit = 20
): Promise<TopHoldersResponse[]> {
  if (!conditionId) return [];

  const params = new URLSearchParams({
    market: conditionId,
    limit: limit.toString(),
  });

  const response = await fetch(
    `${POLYMARKET_API.DATA.HOLDERS}?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch top holders");
  }

  return response.json();
}

/**
 * Hook to fetch top holders for a market
 * @param conditionId - The condition ID of the market
 * @param enabled - Whether to enable the query
 */
export function useTopHolders(conditionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["topHolders", conditionId],
    queryFn: () => fetchTopHolders(conditionId as string),
    enabled: !!conditionId && enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
