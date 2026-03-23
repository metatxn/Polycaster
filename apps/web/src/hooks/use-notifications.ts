"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "wagmi";
import { useClobCredentials } from "@/hooks/use-clob-credentials";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { SignatureType } from "@/lib/polymarket";
import type {
  DropNotificationParams,
  Notification,
  NotificationFilter,
} from "@/types/notifications";

/**
 * Raw notification from the SDK (may have different shape than docs)
 * The SDK types are incomplete, so we define the actual API response shape
 */
interface RawNotification {
  id?: number;
  type: number;
  owner: string;
  payload: unknown;
  timestamp?: number;
}

/**
 * Extended ClobClient interface with notification methods
 * These methods exist in the SDK but TypeScript doesn't resolve them correctly
 */
interface ClobClientWithNotificationMethods {
  getNotifications(): Promise<RawNotification[]>;
  dropNotifications(params?: DropNotificationParams): Promise<void>;
}

/**
 * Transform raw API notification to our typed Notification
 */
function transformNotification(
  raw: RawNotification,
  index: number
): Notification {
  return {
    id: raw.id ?? index, // Use index as fallback ID if not provided
    type: raw.type,
    owner: raw.owner,
    payload: raw.payload as Notification["payload"],
    timestamp: raw.timestamp,
  };
}

/** Auto-refresh interval in milliseconds (30 seconds) */
const REFRESH_INTERVAL_MS = 30_000;

/**
 * Hook for managing Polymarket CLOB notifications
 *
 * Provides:
 * - Fetching notifications from the CLOB API
 * - Dismissing (dropping) notifications
 * - Unread count for badge display
 * - Auto-refresh on interval
 * - Filtering by notification type
 *
 * Reference: https://docs.polymarket.com/developers/CLOB/clients/methods-l2#notifications
 */
export function useNotifications() {
  const { isConnected } = useConnection();
  const { credentials, hasCredentials } = useClobCredentials();
  const { proxyAddress, isDeployed: hasProxyWallet } = useProxyWallet();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>("all");

  // Track dismissed notification IDs locally (for optimistic updates)
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());

  // Ref for interval cleanup
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Helper to get an authenticated CLOB client with notification methods
   * Uses SignatureType.POLY_GNOSIS_SAFE (1) for proxy wallet authentication
   */
  const getAuthenticatedClient = useCallback(async () => {
    if (!credentials) {
      throw new Error(
        "API credentials required. Please derive credentials first."
      );
    }

    if (!proxyAddress) {
      throw new Error("Proxy wallet address required for notifications");
    }

    if (typeof window === "undefined" || !window.ethereum) {
      throw new Error("No wallet provider found");
    }

    const [{ ClobClient }, ethersModule] = await Promise.all([
      import("@polymarket/clob-client"),
      import("ethers"),
    ]);

    const provider = new ethersModule.providers.Web3Provider(
      // biome-ignore lint/suspicious/noExplicitAny: window.ethereum is the wallet provider
      window.ethereum as any
    );
    await provider.send("eth_requestAccounts", []);
    const signer = provider.getSigner();

    const creds = {
      key: credentials.apiKey,
      secret: credentials.apiSecret,
      passphrase: credentials.apiPassphrase,
    };

    // Use POLY_GNOSIS_SAFE signature type (1) for proxy wallet
    return new ClobClient(
      process.env.NEXT_PUBLIC_POLYMARKET_HOST || "https://clob.polymarket.com",
      137,
      signer,
      creds,
      SignatureType.POLY_GNOSIS_SAFE,
      proxyAddress
    ) as InstanceType<typeof ClobClient> & ClobClientWithNotificationMethods;
  }, [credentials, proxyAddress]);

  /**
   * Fetch notifications from the CLOB API
   */
  const fetchNotifications = useCallback(async () => {
    if (!hasCredentials || !isConnected) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const client = await getAuthenticatedClient();
      const rawData = await client.getNotifications();

      // Transform raw data to our typed notifications
      const transformed = rawData.map((raw, index) =>
        transformNotification(raw, index)
      );

      // Sort by timestamp descending (newest first), then by id
      const sorted = [...transformed].sort((a, b) => {
        const timeA = a.timestamp ?? 0;
        const timeB = b.timestamp ?? 0;
        if (timeB !== timeA) return timeB - timeA;
        return b.id - a.id;
      });

      setNotifications(sorted);
      // Clear dismissed IDs since we have fresh data
      setDismissedIds(new Set());
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Failed to fetch notifications");
      setError(error);
      console.error("[Notifications] Failed to fetch:", err);
    } finally {
      setIsLoading(false);
    }
  }, [hasCredentials, isConnected, getAuthenticatedClient]);

  /**
   * Dismiss (drop) specific notifications
   */
  const dismissNotifications = useCallback(
    async (ids: number[]) => {
      if (!hasCredentials || ids.length === 0) {
        return;
      }

      // Optimistic update - mark as dismissed locally
      setDismissedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          next.add(id);
        }
        return next;
      });

      try {
        const client = await getAuthenticatedClient();
        await client.dropNotifications({
          ids: ids.map((id) => String(id)),
        });

        // Remove from local state after successful API call
        setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
        setDismissedIds(new Set());
      } catch (err) {
        // Revert optimistic update on error
        setDismissedIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) {
            next.delete(id);
          }
          return next;
        });
        console.error("[Notifications] Failed to dismiss:", err);
        throw err;
      }
    },
    [hasCredentials, getAuthenticatedClient]
  );

  /**
   * Dismiss a single notification
   */
  const dismissNotification = useCallback(
    async (id: number) => {
      await dismissNotifications([id]);
    },
    [dismissNotifications]
  );

  /**
   * Dismiss all notifications
   */
  const dismissAll = useCallback(async () => {
    const ids = notifications.map((n) => n.id);
    await dismissNotifications(ids);
  }, [notifications, dismissNotifications]);

  /**
   * Filtered notifications based on current filter
   */
  const filteredNotifications = useMemo(() => {
    // Exclude dismissed notifications (optimistic update)
    const visible = notifications.filter((n) => !dismissedIds.has(n.id));

    if (filter === "all") {
      return visible;
    }
    return visible.filter((n) => n.type === filter);
  }, [notifications, filter, dismissedIds]);

  /**
   * Unread count (total visible notifications)
   */
  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !dismissedIds.has(n.id)).length;
  }, [notifications, dismissedIds]);

  /**
   * Check if user can view notifications
   * Requires: connected wallet + API credentials + deployed proxy wallet
   */
  const canViewNotifications = useMemo(() => {
    return isConnected && hasCredentials && hasProxyWallet && !!proxyAddress;
  }, [isConnected, hasCredentials, hasProxyWallet, proxyAddress]);

  // Auto-fetch on mount and when credentials change
  useEffect(() => {
    if (canViewNotifications) {
      fetchNotifications();
    }
  }, [canViewNotifications, fetchNotifications]);

  // Set up auto-refresh interval
  useEffect(() => {
    if (!canViewNotifications) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      fetchNotifications();
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [canViewNotifications, fetchNotifications]);

  // Clear notifications when disconnected
  useEffect(() => {
    if (!isConnected) {
      setNotifications([]);
      setDismissedIds(new Set());
      setError(null);
    }
  }, [isConnected]);

  return {
    // State
    notifications: filteredNotifications,
    allNotifications: notifications,
    unreadCount,
    isLoading,
    error,
    filter,
    canViewNotifications,

    // Actions
    fetchNotifications,
    dismissNotification,
    dismissNotifications,
    dismissAll,
    setFilter,
  };
}
