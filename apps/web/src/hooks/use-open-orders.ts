"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { useClobClient } from "./use-clob-client";
import { useClobCredentials } from "./use-clob-credentials";

/**
 * Open order data structure
 */
export interface OpenOrder {
  id: string;
  maker: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  filledSize: number;
  remainingSize: number;
  status: "LIVE" | "MATCHED" | "CANCELLED";
  createdAt: string;
  expiration: string;
  scoring?: boolean;
  market?: {
    question: string;
    slug: string;
    eventSlug: string;
    outcome: string;
    icon?: string;
  };
}

/**
 * Query options for fetching open orders
 */
export interface UseOpenOrdersOptions {
  /** Filter by market/token ID */
  market?: string;
  /** Enable/disable the query */
  enabled?: boolean;
  /** Override the user address (e.g., use proxy wallet) */
  userAddress?: string;
}

/**
 * API response type for market info
 */
interface MarketInfoResponse {
  success: boolean;
  market?: {
    question: string;
    slug: string;
    eventSlug: string;
    outcome: string;
    icon?: string;
  };
  error?: string;
}

/**
 * Fetch market info for a token ID
 */
async function fetchMarketInfo(tokenId: string): Promise<{
  question: string;
  slug: string;
  eventSlug: string;
  outcome: string;
  icon?: string;
} | null> {
  try {
    const response = await fetch(`/api/markets/by-token/${tokenId}`);
    if (!response.ok) return null;

    const data: MarketInfoResponse = await response.json();
    if (data.success && data.market) {
      return {
        question: data.market.question,
        slug: data.market.slug,
        eventSlug: data.market.eventSlug,
        outcome: data.market.outcome,
        icon: data.market.icon,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse expiration timestamp
 * Handles both Unix timestamps (seconds) and special values like "0" for GTC orders
 */
function parseExpiration(expiration: string | number | undefined): string {
  if (!expiration || expiration === "0" || expiration === 0) {
    return ""; // GTC (Good Till Cancelled) - no expiration
  }

  const timestamp = Number(expiration);

  // Check if it's a valid timestamp
  if (Number.isNaN(timestamp) || timestamp <= 0) {
    return "";
  }

  // If timestamp is very small (< year 2000 in seconds), it's likely invalid
  if (timestamp < 946684800) {
    return "";
  }

  // If timestamp is in seconds (Unix timestamp), convert to milliseconds
  // Unix timestamps from Polymarket are typically in seconds
  const timestampMs = timestamp < 10000000000 ? timestamp * 1000 : timestamp;

  // Check if the resulting date is valid and in the future
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

/**
 * Hook to fetch user's open orders using the CLOB client
 *
 * Uses the ClobClient's getOpenOrders() method which requires
 * wallet authentication (L2 credentials) and a deployed proxy wallet.
 *
 * @param options - Query options
 * @returns Query result with open orders
 */
export function useOpenOrders(options: UseOpenOrdersOptions = {}) {
  const { address, isConnected } = useConnection();
  const { hasCredentials } = useClobCredentials();
  const { getOpenOrders, hasProxyWallet, proxyAddress, areOrdersScoring } =
    useClobClient();

  // Use provided address or fall back to connected wallet
  const userAddress = options.userAddress || address;

  return useQuery({
    queryKey: ["openOrders", userAddress, options.market],
    queryFn: async () => {
      if (!userAddress) {
        return {
          success: false,
          userAddress: null,
          count: 0,
          orders: [],
          error: "Address not available",
        };
      }

      try {
        const orders = await getOpenOrders();

        // Transform orders to match our interface
        const transformedOrders: OpenOrder[] = (orders || []).map(
          (order: {
            id?: string;
            order_id?: string;
            maker?: string;
            asset_id?: string;
            token_id?: string;
            side?: string;
            price?: string | number;
            original_size?: string | number;
            size_matched?: string | number;
            status?: string;
            created_at?: string | number;
            expiration?: string | number;
          }) => ({
            id: order.id || order.order_id || "",
            maker: order.maker || userAddress,
            tokenId: order.asset_id || order.token_id || "",
            side: (order.side?.toUpperCase() || "BUY") as "BUY" | "SELL",
            price: Number(order.price || 0),
            size: Number(order.original_size || 0),
            filledSize: Number(order.size_matched || 0),
            remainingSize:
              Number(order.original_size || 0) -
              Number(order.size_matched || 0),
            status: (order.status?.toUpperCase() || "LIVE") as
              | "LIVE"
              | "MATCHED"
              | "CANCELLED",
            createdAt:
              typeof order.created_at === "number"
                ? new Date(order.created_at * 1000).toISOString()
                : order.created_at || new Date().toISOString(),
            expiration: parseExpiration(order.expiration),
          })
        );

        // Fetch market info and scoring info in parallel
        const uniqueTokenIds = [
          ...new Set(transformedOrders.map((o) => o.tokenId)),
        ];
        const orderIds = transformedOrders.map((o) => o.id);

        const [marketInfos, scoringInfo] = await Promise.all([
          Promise.all(
            uniqueTokenIds.map(async (tokenId) => ({
              tokenId,
              info: await fetchMarketInfo(tokenId),
            }))
          ),
          areOrdersScoring(orderIds).catch((err) => {
            console.error("Failed to fetch scoring info:", err);
            return {} as Record<string, boolean>;
          }),
        ]);

        const marketInfoMap = new Map<
          string,
          {
            question: string;
            slug: string;
            eventSlug: string;
            outcome: string;
            icon?: string;
          }
        >();

        for (const { tokenId, info } of marketInfos) {
          if (info) {
            marketInfoMap.set(tokenId, info);
          }
        }

        // Enrich orders with market info and scoring status
        const enrichedOrders = transformedOrders.map((order) => ({
          ...order,
          market: marketInfoMap.get(order.tokenId) || undefined,
          scoring: scoringInfo[order.id] || false,
        }));

        // Filter by market if specified
        const filteredOrders = options.market
          ? enrichedOrders.filter((o) => o.tokenId === options.market)
          : enrichedOrders;

        return {
          success: true,
          userAddress,
          count: filteredOrders.length,
          orders: filteredOrders,
        };
      } catch (err) {
        console.error("Failed to fetch open orders:", err);
        // Return empty result on error instead of throwing
        return {
          success: false,
          userAddress,
          count: 0,
          orders: [],
          error: err instanceof Error ? err.message : "Failed to fetch orders",
        };
      }
    },
    // Only enable when all prerequisites are met
    enabled:
      isConnected &&
      !!userAddress &&
      hasCredentials &&
      hasProxyWallet &&
      !!proxyAddress &&
      options.enabled !== false,
    staleTime: 10 * 1000, // 10 seconds (orders can change quickly)
    refetchInterval: 15 * 1000, // Refetch every 15 seconds
  });
}

/**
 * Hook to cancel an order using the CLOB client
 *
 * Returns a mutation that can be used to cancel orders.
 * Uses optimistic updates for instant UI feedback.
 *
 * @returns Mutation for canceling orders
 */
export function useCancelOrder() {
  const { address } = useConnection();
  const { cancelOrder } = useClobClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      if (!address) throw new Error("Address not available");
      return cancelOrder(orderId);
    },
    onMutate: async (orderId: string) => {
      // Cancel any outgoing refetches to prevent overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ["openOrders"] });

      // Snapshot previous values for all open orders queries
      const previousData = queryClient.getQueriesData({
        queryKey: ["openOrders"],
      });

      // Optimistically remove the order from all cached queries
      queryClient.setQueriesData(
        { queryKey: ["openOrders"] },
        (old: { orders?: OpenOrder[]; count?: number } | undefined) => {
          if (!old?.orders) return old;
          const filteredOrders = old.orders.filter(
            (order) => order.id !== orderId
          );
          return {
            ...old,
            orders: filteredOrders,
            count: filteredOrders.length,
          };
        }
      );

      // Return context with previous data for rollback
      return { previousData };
    },
    onError: (_err, _orderId, context) => {
      // Rollback to previous data on error
      if (context?.previousData) {
        for (const [queryKey, data] of context.previousData) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      // Refetch to ensure server state is synced
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
    },
  });
}

/**
 * Hook to cancel all open orders
 *
 * Returns a mutation that cancels all open orders for the user.
 *
 * @returns Mutation for canceling all orders
 */
export function useCancelAllOrders() {
  const { address } = useConnection();
  const { getOpenOrders, cancelOrder, proxyAddress } = useClobClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("Address not available");

      // First fetch all open orders
      const orders = await getOpenOrders();

      // Cancel each order
      const results = await Promise.allSettled(
        (orders || []).map((order: { id?: string; order_id?: string }) =>
          cancelOrder(order.id || order.order_id || "")
        )
      );

      // Return successful cancellations count
      const successCount = results.filter(
        (r) => r.status === "fulfilled"
      ).length;
      return { cancelled: successCount, total: orders?.length || 0 };
    },
    onSuccess: () => {
      // Invalidate all open orders queries
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });

      if (address) {
        queryClient.invalidateQueries({ queryKey: ["openOrders", address] });
      }
      if (proxyAddress) {
        queryClient.invalidateQueries({
          queryKey: ["openOrders", proxyAddress],
        });
      }
    },
  });
}

/**
 * Hook to get open orders count (optimized for badges/indicators)
 *
 * @returns Query result with just the count
 */
export function useOpenOrdersCount() {
  const { data, isLoading, error } = useOpenOrders();

  return {
    count: data?.count || 0,
    isLoading,
    error,
  };
}
