"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  matchSportsEventToGame,
  type SportsEventMatchCandidate,
} from "@/lib/sports-event-match";
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

interface UseMatchedSportsLiveGameOptions {
  enabled?: boolean;
}

/**
 * League membership for filtered views. Some feed rows omit
 * `leagueAbbreviation`; recover membership from the slug's league prefix
 * (e.g. "nba-lal-bos-2026-07-03") instead of silently dropping the game
 * from every league-filtered view.
 */
function gameMatchesLeagues(
  game: SportResult,
  leagueSet: Set<string>
): boolean {
  const league = game.leagueAbbreviation?.toLowerCase();
  if (league) return leagueSet.has(league);
  const slug = game.slug?.toLowerCase();
  if (!slug) return false;
  for (const candidate of leagueSet) {
    if (slug.startsWith(`${candidate}-`)) return true;
  }
  return false;
}

function sportsEventKey(
  event: SportsEventMatchCandidate | null | undefined
): string {
  if (!event) return "";

  const teams = (event.teams ?? [])
    .map(
      (team) =>
        `${team.name ?? ""}:${team.abbreviation ?? ""}:${team.alias ?? ""}:${
          team.league ?? ""
        }`
    )
    .join("|");
  const marketStarts = (event.markets ?? [])
    .map((market) => market.gameStartTime ?? "")
    .join("|");

  return [
    event.id ?? "",
    event.slug ?? "",
    event.title ?? "",
    event.startDate ?? "",
    event.startTime ?? "",
    teams,
    marketStarts,
  ].join("::");
}

function liveGameEquals(
  a: LiveGameState | null,
  b: LiveGameState | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.gameId === b.gameId &&
    a.leagueAbbreviation === b.leagueAbbreviation &&
    a.slug === b.slug &&
    a.homeTeam === b.homeTeam &&
    a.awayTeam === b.awayTeam &&
    a.status === b.status &&
    a.score === b.score &&
    a.period === b.period &&
    a.elapsed === b.elapsed &&
    a.live === b.live &&
    a.ended === b.ended &&
    a.updatedAt === b.updatedAt
  );
}

function toLiveGameState(
  event: SportResult,
  receivedAt: number
): LiveGameState {
  return {
    ...event,
    receivedAt,
  };
}

function snapshotToLiveGames(
  snapshot: Map<string, SportResult>,
  receivedAt: number
): Map<string, LiveGameState> {
  const games = new Map<string, LiveGameState>();
  for (const [gameId, event] of snapshot) {
    games.set(gameId, toLiveGameState(event, receivedAt));
  }
  return games;
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
    return liveGames.filter((g) => gameMatchesLeagues(g, set));
  }, [liveGames, leagues]);

  const filteredAllGames = useMemo(() => {
    if (!leagues || leagues.length === 0) return allGames;
    const set = new Set(leagues.map((l) => l.toLowerCase()));
    return allGames.filter((g) => gameMatchesLeagues(g, set));
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

/**
 * Single-event sports websocket subscription.
 *
 * The generic `useSportsWebSocket` hook keeps every sports game in React state,
 * which is useful for board/list pages. Event-detail pages only need the one
 * matching game, so this hook filters before touching React state and avoids a
 * full detail-page render for unrelated live sports updates.
 */
export function useMatchedSportsLiveGame(
  event: SportsEventMatchCandidate | null | undefined,
  options: UseMatchedSportsLiveGameOptions = {}
) {
  const { enabled = true } = options;
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [game, setGame] = useState<LiveGameState | null>(null);
  const eventRef = useRef<SportsEventMatchCandidate | null | undefined>(event);
  const matchedGameIdRef = useRef<string | null>(null);
  const eventKey = useMemo(() => sportsEventKey(event), [event]);
  const previousEventKeyRef = useRef(eventKey);

  useEffect(() => {
    eventRef.current = event;
    if (previousEventKeyRef.current !== eventKey) {
      previousEventKeyRef.current = eventKey;
      matchedGameIdRef.current = null;
      setGame(null);
    }
  }, [event, eventKey]);

  useEffect(() => {
    if (!enabled || !eventKey) {
      setConnectionState("disconnected");
      return;
    }

    const manager = getSportsWebSocketManager();
    const unsubscribe = manager.addConnectionListener((state) => {
      setConnectionState(state);
    });

    return unsubscribe;
  }, [enabled, eventKey]);

  useEffect(() => {
    if (!enabled || !eventKey) return;

    const manager = getSportsWebSocketManager();
    const removeConsumer = manager.addConsumer();
    const removeListener = manager.addEventListener((eventUpdate) => {
      const currentEvent = eventRef.current;
      if (!currentEvent) return;

      const receivedAt = Date.now();
      const nextGame = toLiveGameState(eventUpdate, receivedAt);
      const gameId = String(nextGame.gameId);
      const alreadyMatched = matchedGameIdRef.current === gameId;
      if (alreadyMatched) {
        setGame((current) =>
          liveGameEquals(current, nextGame) ? current : nextGame
        );
        return;
      }

      const incomingMatch = matchSportsEventToGame(
        currentEvent,
        new Map([[gameId, nextGame]])
      );
      if (!incomingMatch) return;

      const candidateGames = snapshotToLiveGames(
        manager.getGamesSnapshot(),
        receivedAt
      );
      candidateGames.set(gameId, nextGame);
      const bestMatch = matchSportsEventToGame(currentEvent, candidateGames);
      const isBestIncomingMatch =
        bestMatch && String(bestMatch.gameId) === gameId;

      if (!isBestIncomingMatch) return;

      matchedGameIdRef.current = gameId;
      setGame((current) =>
        liveGameEquals(current, nextGame) ? current : nextGame
      );
    });

    const currentEvent = eventRef.current;
    if (currentEvent) {
      const receivedAt = Date.now();
      const bestMatch = matchSportsEventToGame(
        currentEvent,
        snapshotToLiveGames(manager.getGamesSnapshot(), receivedAt)
      );
      if (bestMatch) {
        matchedGameIdRef.current = String(bestMatch.gameId);
        setGame((current) =>
          liveGameEquals(current, bestMatch) ? current : bestMatch
        );
      }
    }

    return () => {
      removeListener();
      removeConsumer();
    };
  }, [enabled, eventKey]);

  return {
    connectionState,
    isConnected: connectionState === "connected",
    game,
    reconnect: useCallback(() => {
      getSportsWebSocketManager().reconnect();
    }, []),
  };
}
