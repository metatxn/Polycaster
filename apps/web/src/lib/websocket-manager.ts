"use client";

import { POLYMARKET_API, WEBSOCKET_CONFIG } from "@/constants/polymarket";
import { filterValidTokenIds } from "@/lib/token-validation";
import type { ConnectionState, WebSocketEvent } from "@/types/websocket";

/**
 * Singleton WebSocket Manager for Polymarket Market Channel
 *
 * Features:
 * - Single shared connection across all components
 * - Reference-counted subscriptions
 * - Automatic reconnection with exponential backoff
 * - Heartbeat monitoring for connection health
 * - Graceful cleanup on disconnect
 */

type EventCallback = (event: WebSocketEvent) => void;
type ConnectionCallback = (state: ConnectionState) => void;

interface Subscription {
  assetId: string;
  refCount: number;
}

/**
 * Heartbeat configuration
 */
const HEARTBEAT_CONFIG = {
  /** Interval between heartbeat checks (30 seconds) */
  INTERVAL_MS: 30000,
  /** Time to wait for pong response before considering connection dead (10 seconds) */
  TIMEOUT_MS: 10000,
};

/**
 * Reconnection limits to prevent infinite reconnection loops
 * and conserve resources on Cloudflare Workers
 */
const RECONNECT_LIMITS = {
  /** Maximum reconnection attempts before giving up */
  MAX_ATTEMPTS: 10,
  /** Time window to reset attempt counter (5 minutes) */
  RESET_WINDOW_MS: 5 * 60 * 1000,
};

class WebSocketManager {
  private static instance: WebSocketManager | null = null;

  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private firstReconnectTime: number = 0; // Track when reconnection attempts started
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private lastPongReceived: number = 0;
  private awaitingPong: boolean = false;

  // Subscriptions with reference counting
  private subscriptions: Map<string, Subscription> = new Map();

  // Event listeners
  private eventListeners: Set<EventCallback> = new Set();
  private connectionListeners: Set<ConnectionCallback> = new Set();

  // Pending subscriptions (when WS not yet connected)
  private pendingSubscriptions: Set<string> = new Set();

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  /**
   * Get list of currently subscribed asset IDs
   */
  getSubscribedAssets(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Add event listener for WebSocket events
   */
  addEventListener(callback: EventCallback): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  /**
   * Add connection state listener
   */
  addConnectionListener(callback: ConnectionCallback): () => void {
    this.connectionListeners.add(callback);
    // Immediately notify of current state
    callback(this.connectionState);
    return () => this.connectionListeners.delete(callback);
  }

  /**
   * Subscribe to asset IDs (with reference counting)
   * Returns unsubscribe function
   */
  subscribe(assetIds: string[]): () => void {
    const validIds = filterValidTokenIds(assetIds);
    if (validIds.length === 0) return () => {};

    const newSubscriptions: string[] = [];

    for (const assetId of validIds) {
      const existing = this.subscriptions.get(assetId);
      if (existing) {
        // Increment reference count
        existing.refCount++;
      } else {
        // New subscription
        this.subscriptions.set(assetId, { assetId, refCount: 1 });
        newSubscriptions.push(assetId);
      }
    }

    // Connect if not already connected
    if (this.connectionState === "disconnected") {
      this.connect();
    }

    // Send subscription for new assets
    if (newSubscriptions.length > 0) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendSubscription("subscribe", newSubscriptions);
      } else {
        // Queue for when connected
        for (const id of newSubscriptions) {
          this.pendingSubscriptions.add(id);
        }
      }
    }

    // Return unsubscribe function
    return () => this.unsubscribe(validIds);
  }

  /**
   * Unsubscribe from asset IDs (with reference counting)
   */
  private unsubscribe(assetIds: string[]): void {
    const toUnsubscribe: string[] = [];

    for (const assetId of assetIds) {
      const existing = this.subscriptions.get(assetId);
      if (existing) {
        existing.refCount--;
        if (existing.refCount <= 0) {
          this.subscriptions.delete(assetId);
          toUnsubscribe.push(assetId);
        }
      }
      this.pendingSubscriptions.delete(assetId);
    }

    // Send unsubscription
    if (toUnsubscribe.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscription("unsubscribe", toUnsubscribe);
    }

    // Disconnect if no more subscriptions
    if (this.subscriptions.size === 0) {
      this.disconnect();
    }
  }

  /**
   * Connect to WebSocket
   */
  private connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.clearReconnectTimeout();
    this.updateConnectionState("connecting");

    try {
      this.ws = new WebSocket(POLYMARKET_API.WSS.MARKET);

      this.ws.onopen = () => {
        console.log("[WSManager] Connected to Polymarket Market Channel");
        this.updateConnectionState("connected");
        // Reset reconnection tracking on successful connection
        this.reconnectAttempt = 0;
        this.firstReconnectTime = 0;

        // Subscribe to all pending + existing subscriptions
        const allAssets = [
          ...this.pendingSubscriptions,
          ...this.subscriptions.keys(),
        ];

        if (allAssets.length > 0) {
          this.sendSubscription("subscribe", Array.from(new Set(allAssets)));
        }
        this.pendingSubscriptions.clear();

        // Start heartbeat
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        // Handle non-JSON messages (like PONG heartbeat responses)
        if (typeof event.data === "string") {
          const msg = event.data.trim().toLowerCase();

          // Handle pong response for heartbeat
          if (msg === "pong") {
            this.handlePong();
            return;
          }

          // Skip other non-JSON messages
          if (!event.data.trim().startsWith("{")) {
            return;
          }
        }

        try {
          const data = JSON.parse(event.data) as WebSocketEvent;
          this.broadcastEvent(data);
        } catch (err) {
          // Only log if it's not a known non-JSON message
          if (typeof event.data === "string" && event.data.length < 100) {
            console.debug("[WSManager] Non-JSON message:", event.data);
          } else {
            console.error("[WSManager] Failed to parse message:", err);
          }
        }
      };

      this.ws.onerror = (event) => {
        console.error("[WSManager] WebSocket error:", event);
        this.updateConnectionState("error");
      };

      this.ws.onclose = (event) => {
        console.log(
          `[WSManager] Closed: code=${event.code}, reason=${event.reason}`
        );
        this.stopHeartbeat();

        // Don't reconnect if closed cleanly or no subscriptions
        if (event.code === 1000 || this.subscriptions.size === 0) {
          this.updateConnectionState("disconnected");
          return;
        }

        // Reconnect with exponential backoff
        this.scheduleReconnect();
      };
    } catch (err) {
      console.error("[WSManager] Failed to connect:", err);
      this.updateConnectionState("error");
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.clearReconnectTimeout();
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.updateConnectionState("disconnected");
  }

  /**
   * Force reconnect
   */
  reconnect(): void {
    this.disconnect();
    // Reset reconnection tracking for explicit user-initiated reconnect
    this.reconnectAttempt = 0;
    this.firstReconnectTime = 0;
    if (this.subscriptions.size > 0) {
      // Move all subscriptions to pending
      for (const assetId of this.subscriptions.keys()) {
        this.pendingSubscriptions.add(assetId);
      }
      this.connect();
    }
  }

  private sendSubscription(
    type: "subscribe" | "unsubscribe",
    assetIds: string[]
  ): void {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      assetIds.length === 0
    ) {
      return;
    }

    try {
      this.ws.send(JSON.stringify({ type, assets_ids: assetIds }));
      console.log(`[WSManager] ${type}d to ${assetIds.length} assets`);
    } catch (err) {
      console.error(`[WSManager] Failed to ${type}:`, err);
    }
  }

  private updateConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    for (const callback of this.connectionListeners) {
      try {
        callback(state);
      } catch (err) {
        console.error("[WSManager] Connection listener error:", err);
      }
    }
  }

  private broadcastEvent(event: WebSocketEvent): void {
    for (const callback of this.eventListeners) {
      try {
        callback(event);
      } catch (err) {
        console.error("[WSManager] Event listener error:", err);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    // Reset attempt counter if enough time has passed
    const now = Date.now();
    if (
      this.firstReconnectTime &&
      now - this.firstReconnectTime > RECONNECT_LIMITS.RESET_WINDOW_MS
    ) {
      this.reconnectAttempt = 0;
      this.firstReconnectTime = 0;
    }

    // Track when reconnection attempts started
    if (this.reconnectAttempt === 0) {
      this.firstReconnectTime = now;
    }

    this.reconnectAttempt++;

    // Check if we've exceeded max attempts
    if (this.reconnectAttempt > RECONNECT_LIMITS.MAX_ATTEMPTS) {
      console.warn(
        `[WSManager] Max reconnection attempts (${RECONNECT_LIMITS.MAX_ATTEMPTS}) reached. ` +
          `Giving up. User can manually refresh to retry.`
      );
      this.updateConnectionState("disconnected");
      return;
    }

    const delay = Math.min(
      WEBSOCKET_CONFIG.RECONNECT_DELAY_MS *
        WEBSOCKET_CONFIG.RECONNECT_BACKOFF ** (this.reconnectAttempt - 1),
      WEBSOCKET_CONFIG.MAX_RECONNECT_DELAY_MS
    );

    console.log(
      `[WSManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}/${RECONNECT_LIMITS.MAX_ATTEMPTS})`
    );
    this.updateConnectionState("reconnecting");

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Handle pong response from server
   */
  private handlePong(): void {
    this.lastPongReceived = Date.now();
    this.awaitingPong = false;

    // Clear the timeout since we got a response
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }

    console.debug("[WSManager] Heartbeat pong received");
  }

  /**
   * Send a ping to check connection health
   */
  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // If we're still waiting for a pong from the last ping, connection might be dead
    if (this.awaitingPong) {
      console.warn(
        "[WSManager] No pong received for previous ping, connection may be stale"
      );
      // Don't immediately reconnect, let the timeout handle it
    }

    try {
      // Try sending a ping message
      // Polymarket WebSocket may respond to "PING" with "PONG"
      this.ws.send("PING");
      this.awaitingPong = true;

      // Set a timeout - if we don't get pong within timeout, reconnect
      this.heartbeatTimeout = setTimeout(() => {
        if (this.awaitingPong) {
          console.warn(
            "[WSManager] Heartbeat timeout - no pong received, reconnecting..."
          );
          this.awaitingPong = false;
          this.reconnect();
        }
      }, HEARTBEAT_CONFIG.TIMEOUT_MS);
    } catch (err) {
      console.error("[WSManager] Failed to send ping:", err);
      // Connection is likely broken, trigger reconnect
      this.reconnect();
    }
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongReceived = Date.now();
    this.awaitingPong = false;

    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendPing();
      }
    }, HEARTBEAT_CONFIG.INTERVAL_MS);

    console.debug("[WSManager] Heartbeat monitoring started");
  }

  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }

    this.awaitingPong = false;
  }

  /**
   * Get time since last successful heartbeat
   */
  getTimeSinceLastHeartbeat(): number {
    if (this.lastPongReceived === 0) {
      return Infinity;
    }
    return Date.now() - this.lastPongReceived;
  }

  /**
   * Check if connection is healthy (received pong recently)
   */
  isConnectionHealthy(): boolean {
    if (!this.isConnected()) {
      return false;
    }
    // Consider unhealthy if no pong in last 2 heartbeat intervals
    return (
      this.getTimeSinceLastHeartbeat() < HEARTBEAT_CONFIG.INTERVAL_MS * 2.5
    );
  }
}

// Export singleton instance getter
export function getWebSocketManager(): WebSocketManager {
  return WebSocketManager.getInstance();
}
