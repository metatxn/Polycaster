"use client";

import { createLogger } from "@knoww/logger";
import {
  createUnifiedPolymarketCredentialsOnlySigner,
  createUnifiedPolymarketSecureClient,
  isPolymarketFreshAuthenticationRequiredError,
  type UnifiedPolymarketSecureClient,
} from "@knoww/shared-types/polymarket-unified";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "wagmi";

const log = createLogger("notifications");

import { useClobCredentials } from "@/hooks/use-clob-credentials";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import {
  type DropNotificationParams,
  type Notification,
  type NotificationFilter,
  NotificationType,
} from "@/types/notifications";

/** Notification types we render with bespoke copy; anything else is logged. */
const KNOWN_NOTIFICATION_TYPES = new Set<number>([
  NotificationType.ORDER_CANCELLATION,
  NotificationType.ORDER_FILL,
  NotificationType.MARKET_RESOLVED,
]);

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
 * Narrow authenticated client surface used by this hook.
 */
interface UnifiedNotificationClient {
  fetchNotifications(): Promise<RawNotification[]>;
  dropNotifications(params?: DropNotificationParams): Promise<void>;
}

type NotificationClientCache = {
  key: string;
  promise: Promise<UnifiedPolymarketSecureClient & UnifiedNotificationClient>;
};

const authenticatedClientCache = new Map<string, NotificationClientCache>();

function buildNotificationClientCacheKey(
  signerAddress: string,
  walletAddress: string,
  apiKey: string
): string {
  return `${signerAddress.toLowerCase()}:${walletAddress.toLowerCase()}:${apiKey}`;
}

function clearNotificationClientCache(cacheKey: string): void {
  authenticatedClientCache.delete(cacheKey);
}

/**
 * Transform raw API notification to our typed Notification
 */
function transformNotification(
  raw: RawNotification,
  index: number
): Notification {
  // Coerce defensively: the API has been observed to send `type` as a string,
  // which silently breaks the numeric switch in the UI and shows "New
  // notification" for everything.
  const type = Number(raw.type);

  // Surface any type outside our known enum so we can map it precisely (e.g.
  // the "winning position redeemed" event Polymarket shows on its own site).
  if (!KNOWN_NOTIFICATION_TYPES.has(type)) {
    log.warn("notification.unrecognized_type", {
      type: raw.type,
      payload: raw.payload,
    });
  }

  return {
    id: raw.id ?? index, // Use index as fallback ID if not provided
    type,
    owner: raw.owner,
    payload: raw.payload as Notification["payload"],
    timestamp: raw.timestamp,
  };
}

/** Auto-refresh interval in milliseconds (30 seconds) */
const REFRESH_INTERVAL_MS = 30_000;

function isExpectedClobReadFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  const lower = message.toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("404")
  );
}

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
  const { address, isConnected } = useConnection();
  const { credentials, hasCredentials, clearCredentials } =
    useClobCredentials();
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
   * Uses the active trading wallet mode for CLOB authentication.
   */
  const getAuthenticatedClient = useCallback(async () => {
    if (!credentials) {
      throw new Error(
        "API credentials required. Please derive credentials first."
      );
    }

    if (!proxyAddress) {
      throw new Error("Trading wallet address required for notifications");
    }

    if (!address) {
      throw new Error("Wallet not connected");
    }

    const cacheKey = buildNotificationClientCacheKey(
      address,
      proxyAddress,
      credentials.apiKey
    );

    const cachedClient = authenticatedClientCache.get(cacheKey);
    if (cachedClient) {
      return cachedClient.promise;
    }

    let promise: Promise<
      UnifiedPolymarketSecureClient & UnifiedNotificationClient
    >;
    promise = createUnifiedPolymarketSecureClient({
      signer: createUnifiedPolymarketCredentialsOnlySigner(address),
      wallet: proxyAddress,
      credentials,
      allowFreshAuthentication: false,
    })
      .then(
        ({ client }) =>
          client as UnifiedPolymarketSecureClient & UnifiedNotificationClient
      )
      .catch((err) => {
        if (authenticatedClientCache.get(cacheKey)?.promise === promise) {
          clearNotificationClientCache(cacheKey);
        }
        throw err;
      });

    authenticatedClientCache.set(cacheKey, { key: cacheKey, promise });
    return promise;
  }, [address, credentials, proxyAddress]);

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
      const rawData = await client.fetchNotifications();

      // SDK types claim Notification[] but the API may return null or an
      // error envelope; harden the boundary before iterating.
      const list: RawNotification[] = Array.isArray(rawData) ? rawData : [];
      const transformed = list.map((raw, index) =>
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
      if (isPolymarketFreshAuthenticationRequiredError(err)) {
        if (address && proxyAddress && credentials) {
          clearNotificationClientCache(
            buildNotificationClientCacheKey(
              address,
              proxyAddress,
              credentials.apiKey
            )
          );
        }
        clearCredentials();
        log.debug("fetch.skipped", { reason: "credentials_invalid" });
      } else if (isExpectedClobReadFailure(err)) {
        log.debug("fetch.skipped", { reason: error.message });
      } else {
        log.error("fetch.failed", { error: err });
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    hasCredentials,
    isConnected,
    getAuthenticatedClient,
    clearCredentials,
    address,
    proxyAddress,
    credentials,
  ]);

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
        log.error("dismiss.failed", { error: err });
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
