"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getSportsWebSocketManager,
  type SportResult,
} from "@/lib/sports-websocket-manager";
import type { ConnectionState } from "@/types/websocket";

/**
 * Live game state enriched with local receive timestamp.
 */
export interface LiveGameState extends SportResult {
  receivedAt: number;
}

/** Ended games older than this are evicted from the map */
const EVICTION_AGE_MS = 30 * 60 * 1000; // 30 minutes
/** Non-live, non-ended games (scheduled, postponed, etc.) older than this are evicted */
const STALE_AGE_MS = 60 * 60 * 1000; // 1 hour
/** Live games that stopped receiving updates are evicted after this */
const LIVE_STALE_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
/** How often the eviction sweep runs */
const EVICTION_INTERVAL_MS = 60 * 1000; // 1 minute

interface UseSportsWebSocketOptions {
  enabled?: boolean;
  /** Filter to specific leagues (e.g. ["nfl", "nba"]). Empty = all. */
  leagues?: string[];
}

/**
 * Hook that uses the singleton SportsWebSocketManager.
 *
 * Follows the same thin-hook pattern as useSharedWebSocket / useWhaleLiveFeed:
 * - Does NOT create its own WebSocket connection
 * - Uses a shared singleton (ref-counted consumers)
 * - Stores ALL incoming game states (filtering is done at render time only)
 * - Periodically evicts ended games older than 30 minutes
 */
export function useSportsWebSocket(options: UseSportsWebSocketOptions = {}) {
  const { enabled = true, leagues } = options;

  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [games, setGames] = useState<Map<string, LiveGameState>>(new Map());
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);

  // Subscribe to connection state
  useEffect(() => {
    const manager = getSportsWebSocketManager();
    const unsubscribe = manager.addConnectionListener((state) => {
      setConnectionState(state);
    });
    return unsubscribe;
  }, []);

  // Register as consumer + listen for sport events (store ALL, no filtering)
  useEffect(() => {
    if (!enabled) return;

    const manager = getSportsWebSocketManager();

    const removeConsumer = manager.addConsumer();

    const removeListener = manager.addEventListener((event) => {
      const now = Date.now();
      setLastMessageAt(now);

      setGames((prev) => {
        const next = new Map(prev);
        next.set(String(event.gameId), { ...event, receivedAt: now });
        return next;
      });
    });

    return () => {
      removeListener();
      removeConsumer();
    };
  }, [enabled]);

  // Periodic eviction of stale ended games
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      setGames((prev) => {
        const now = Date.now();
        let evicted = 0;
        const next = new Map<string, LiveGameState>();

        for (const [key, game] of prev) {
          const age = now - game.receivedAt;
          if (game.ended && age > EVICTION_AGE_MS) {
            evicted++;
          } else if (!game.live && !game.ended && age > STALE_AGE_MS) {
            evicted++;
          } else if (game.live && !game.ended && age > LIVE_STALE_AGE_MS) {
            evicted++;
          } else {
            next.set(key, game);
          }
        }

        return evicted > 0 ? next : prev;
      });
    }, EVICTION_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled]);

  // Derive filtered views at render time (not at ingest time)
  const allGames = useMemo(() => Array.from(games.values()), [games]);

  const liveGames = useMemo(
    () => allGames.filter((g) => g.live && !g.ended),
    [allGames]
  );

  const finishedGames = useMemo(
    () => allGames.filter((g) => g.ended),
    [allGames]
  );

  // League-filtered subsets (for UI, not for storage)
  const filteredLiveGames = useMemo(() => {
    if (!leagues || leagues.length === 0) return liveGames;
    const set = new Set(leagues.map((l) => l.toLowerCase()));
    return liveGames.filter((g) =>
      set.has(g.leagueAbbreviation?.toLowerCase())
    );
  }, [liveGames, leagues]);

  const filteredAllGames = useMemo(() => {
    if (!leagues || leagues.length === 0) return allGames;
    const set = new Set(leagues.map((l) => l.toLowerCase()));
    return allGames.filter((g) => set.has(g.leagueAbbreviation?.toLowerCase()));
  }, [allGames, leagues]);

  return {
    connectionState,
    isConnected: connectionState === "connected",
    /** Full unfiltered game map (for event-to-game matching) */
    games,
    /** All live (in-progress) games, unfiltered */
    liveGames,
    /** All ended games, unfiltered */
    finishedGames,
    /** Every game regardless of status, unfiltered */
    allGames,
    /** Live games filtered by the `leagues` option */
    filteredLiveGames,
    /** All games filtered by the `leagues` option */
    filteredAllGames,
    lastMessageAt,
    reconnect: useCallback(() => {
      getSportsWebSocketManager().reconnect();
    }, []),
    getGame: useCallback(
      (gameId: string | number) => games.get(String(gameId)) ?? null,
      [games]
    ),
  };
}
