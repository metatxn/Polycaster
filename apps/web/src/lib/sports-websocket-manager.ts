"use client";

import { POLYMARKET_API, WEBSOCKET_CONFIG } from "@/constants/polymarket";
import type { ConnectionState } from "@/types/websocket";

/**
 * Singleton WebSocket Manager for Polymarket Sports Channel
 *
 * Follows the same architecture as WebSocketManager (market channel) but
 * adapted for the sports protocol:
 * - Endpoint: wss://sports-api.polymarket.com/ws
 * - No authentication required
 * - No subscription message needed — streams all active sports on connect
 * - Server sends "ping" every 5s; client must reply "pong" within 10s
 * - Messages are `SportResult` JSON objects
 *
 * Features (inherited pattern from WebSocketManager):
 * - Single shared connection across all components
 * - Reference-counted consumers (auto-connect/disconnect)
 * - Automatic reconnection with exponential backoff
 * - Heartbeat handled via server-initiated ping/pong
 * - Graceful cleanup on disconnect
 */

export interface SportResult {
  gameId: number;
  leagueAbbreviation: string;
  slug?: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  score: string;
  period: string;
  elapsed?: string;
  live: boolean;
  ended: boolean;
  turn?: string;
  finished_timestamp?: string;
  updatedAt?: string;
  eventState?: {
    type: string;
    score: string;
    elapsed: string;
    period: string;
    live: boolean;
    ended: boolean;
  };
}

type SportEventCallback = (event: SportResult) => void;
type ConnectionCallback = (state: ConnectionState) => void;

const RECONNECT_LIMITS = {
  MAX_ATTEMPTS: 10,
  RESET_WINDOW_MS: 5 * 60 * 1000,
};

const PONG_TIMEOUT_MS = 10_000;

class SportsWebSocketManager {
  private static instance: SportsWebSocketManager | null = null;

  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private firstReconnectTime = 0;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;

  private consumerCount = 0;

  private eventListeners: Set<SportEventCallback> = new Set();
  private connectionListeners: Set<ConnectionCallback> = new Set();

  private constructor() {}

  static getInstance(): SportsWebSocketManager {
    if (!SportsWebSocketManager.instance) {
      SportsWebSocketManager.instance = new SportsWebSocketManager();
    }
    return SportsWebSocketManager.instance;
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  addEventListener(callback: SportEventCallback): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  addConnectionListener(callback: ConnectionCallback): () => void {
    this.connectionListeners.add(callback);
    callback(this.connectionState);
    return () => this.connectionListeners.delete(callback);
  }

  /**
   * Register a consumer. Connects on first consumer.
   * Returns an unregister function that disconnects when last consumer leaves.
   */
  addConsumer(): () => void {
    this.consumerCount++;

    if (this.consumerCount === 1 && this.connectionState === "disconnected") {
      this.connect();
    }

    return () => {
      this.consumerCount = Math.max(0, this.consumerCount - 1);
      if (this.consumerCount === 0) {
        this.disconnect();
      }
    };
  }

  reconnect(): void {
    this.clearReconnectTimeout();
    this.clearPongTimeout();
    this.cleanupConnection();
    this.reconnectAttempt = 0;
    this.firstReconnectTime = 0;
    if (this.consumerCount > 0) {
      this.connect();
    }
  }

  disconnect(): void {
    this.clearReconnectTimeout();
    this.clearPongTimeout();
    this.cleanupConnection();
    this.updateConnectionState("disconnected");
  }

  // ── Private ──────────────────────────────────────────────

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
      this.ws = new WebSocket(POLYMARKET_API.WSS.SPORTS);

      this.ws.onopen = () => {
        console.log("[SportsWS] Connected to Sports Channel");
        this.updateConnectionState("connected");
        this.reconnectAttempt = 0;
        this.firstReconnectTime = 0;
      };

      this.ws.onmessage = (event) => {
        const data = event.data as string;

        if (data === "ping") {
          this.ws?.send("pong");
          this.resetPongTimeout();
          return;
        }

        try {
          const parsed = JSON.parse(data) as SportResult;
          if (parsed.gameId) {
            this.broadcastEvent(parsed);
          }
        } catch {
          // Non-JSON message, ignore
        }
      };

      this.ws.onerror = (err) => {
        console.error("[SportsWS] Error:", err);
        this.updateConnectionState("error");
      };

      this.ws.onclose = (event) => {
        console.log(
          `[SportsWS] Closed: code=${event.code}, reason=${event.reason}`
        );
        this.clearPongTimeout();
        this.ws = null;

        if (event.code === 1000 || this.consumerCount === 0) {
          this.updateConnectionState("disconnected");
          return;
        }

        this.scheduleReconnect();
      };
    } catch (err) {
      console.error("[SportsWS] Failed to connect:", err);
      this.updateConnectionState("error");
      this.scheduleReconnect();
    }
  }

  /**
   * The sports server pings us every 5s. If we haven't received a ping
   * within 10s it means the connection is dead, so we reconnect.
   * This timeout resets every time we receive a ping.
   */
  private resetPongTimeout(): void {
    this.clearPongTimeout();
    this.pongTimeout = setTimeout(() => {
      console.warn("[SportsWS] No ping from server in 10s, reconnecting…");
      this.reconnect();
    }, PONG_TIMEOUT_MS);
  }

  private clearPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    const now = Date.now();
    if (
      this.firstReconnectTime &&
      now - this.firstReconnectTime > RECONNECT_LIMITS.RESET_WINDOW_MS
    ) {
      this.reconnectAttempt = 0;
      this.firstReconnectTime = 0;
    }

    if (this.reconnectAttempt === 0) {
      this.firstReconnectTime = now;
    }

    this.reconnectAttempt++;

    if (this.reconnectAttempt > RECONNECT_LIMITS.MAX_ATTEMPTS) {
      console.warn(
        `[SportsWS] Max reconnection attempts (${RECONNECT_LIMITS.MAX_ATTEMPTS}) reached.`
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
      `[SportsWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}/${RECONNECT_LIMITS.MAX_ATTEMPTS})`
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

  private cleanupConnection(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private updateConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    for (const cb of this.connectionListeners) {
      try {
        cb(state);
      } catch (err) {
        console.error("[SportsWS] Connection listener error:", err);
      }
    }
  }

  private broadcastEvent(event: SportResult): void {
    for (const cb of this.eventListeners) {
      try {
        cb(event);
      } catch (err) {
        console.error("[SportsWS] Event listener error:", err);
      }
    }
  }
}

export function getSportsWebSocketManager(): SportsWebSocketManager {
  return SportsWebSocketManager.getInstance();
}
