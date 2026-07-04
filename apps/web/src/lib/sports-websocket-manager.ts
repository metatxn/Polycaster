"use client";

import { createLogger } from "@knoww/logger";
import { POLYMARKET_API, WEBSOCKET_CONFIG } from "@/constants/polymarket";
import type { ConnectionState } from "@/types/websocket";

const log = createLogger("sports-ws");

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
const DISCONNECT_GRACE_MS = 1_500;
const ENDED_GAME_TTL_MS = 30 * 60 * 1000;
const STALE_GAME_TTL_MS = 2 * 60 * 60 * 1000;
const EVICTION_SWEEP_INTERVAL_MS = 60 * 1000;

class SportsWebSocketManager {
  private static instance: SportsWebSocketManager | null = null;

  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private disconnectGraceTimeout: ReturnType<typeof setTimeout> | null = null;
  private firstReconnectTime = 0;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;

  private consumerCount = 0;

  private games: Map<string, SportResult> = new Map();
  private gameReceivedAt: Map<string, number> = new Map();
  private lastEvictionSweepAt = 0;

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

  getGamesSnapshot(): Map<string, SportResult> {
    this.evictStaleGames();
    return new Map(this.games);
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
    this.clearDisconnectGraceTimeout();
    this.consumerCount++;

    if (this.consumerCount === 1 && this.connectionState === "disconnected") {
      this.connect();
    }

    return () => {
      this.consumerCount = Math.max(0, this.consumerCount - 1);
      if (this.consumerCount === 0) {
        this.scheduleDisconnect();
      }
    };
  }

  reconnect(): void {
    this.clearDisconnectGraceTimeout();
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
    this.clearDisconnectGraceTimeout();
    this.clearReconnectTimeout();
    this.clearPongTimeout();
    this.cleanupConnection();
    this.games.clear();
    this.gameReceivedAt.clear();
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
        log.info("connected");
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
        log.error("socket.error", { error: err });
        this.updateConnectionState("error");
      };

      this.ws.onclose = (event) => {
        log.info("closed", { code: event.code, reason: event.reason });
        this.clearPongTimeout();
        this.ws = null;

        if (event.code === 1000 || this.consumerCount === 0) {
          this.updateConnectionState("disconnected");
          return;
        }

        this.scheduleReconnect();
      };
    } catch (err) {
      log.error("connect.failed", { error: err });
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
      log.warn("ping.timeout", { timeoutMs: PONG_TIMEOUT_MS });
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
      log.warn("reconnect.max_attempts", {
        maxAttempts: RECONNECT_LIMITS.MAX_ATTEMPTS,
      });
      this.updateConnectionState("disconnected");
      return;
    }

    const delay = Math.min(
      WEBSOCKET_CONFIG.RECONNECT_DELAY_MS *
        WEBSOCKET_CONFIG.RECONNECT_BACKOFF ** (this.reconnectAttempt - 1),
      WEBSOCKET_CONFIG.MAX_RECONNECT_DELAY_MS
    );

    log.info("reconnect.schedule", {
      delayMs: delay,
      attempt: this.reconnectAttempt,
      maxAttempts: RECONNECT_LIMITS.MAX_ATTEMPTS,
    });
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

  private scheduleDisconnect(): void {
    if (this.disconnectGraceTimeout) return;
    this.disconnectGraceTimeout = setTimeout(() => {
      this.disconnectGraceTimeout = null;
      if (this.consumerCount === 0) {
        this.disconnect();
      }
    }, DISCONNECT_GRACE_MS);
  }

  private clearDisconnectGraceTimeout(): void {
    if (this.disconnectGraceTimeout) {
      clearTimeout(this.disconnectGraceTimeout);
      this.disconnectGraceTimeout = null;
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
        log.error("listener.connection.error", { error: err });
      }
    }
  }

  private broadcastEvent(event: SportResult): void {
    this.evictStaleGames();
    const gameId = String(event.gameId);
    this.games.set(gameId, event);
    this.gameReceivedAt.set(gameId, Date.now());
    for (const cb of this.eventListeners) {
      try {
        cb(event);
      } catch (err) {
        log.error("listener.event.error", { error: err });
      }
    }
  }

  private evictStaleGames(now = Date.now()): void {
    // The sweep walks the whole map and Date.parses per entry; callers invoke
    // it on every websocket message and snapshot, so gate it to once per
    // minute — the TTLs are 30min/2h, minute-level precision is plenty.
    // A negative elapsed (clock moved backwards, e.g. fake timers) sweeps.
    const elapsedSinceSweep = now - this.lastEvictionSweepAt;
    if (
      elapsedSinceSweep >= 0 &&
      elapsedSinceSweep < EVICTION_SWEEP_INTERVAL_MS
    ) {
      return;
    }
    this.lastEvictionSweepAt = now;
    for (const [gameId, event] of this.games) {
      const upstreamUpdatedAt = Date.parse(
        event.finished_timestamp ?? event.updatedAt ?? ""
      );
      const updatedAt = Number.isNaN(upstreamUpdatedAt)
        ? this.gameReceivedAt.get(gameId)
        : upstreamUpdatedAt;
      if (updatedAt === undefined) continue;

      const ttl = event.ended ? ENDED_GAME_TTL_MS : STALE_GAME_TTL_MS;
      if (now - updatedAt > ttl) {
        this.games.delete(gameId);
        this.gameReceivedAt.delete(gameId);
      }
    }
  }
}

export function getSportsWebSocketManager(): SportsWebSocketManager {
  return SportsWebSocketManager.getInstance();
}
