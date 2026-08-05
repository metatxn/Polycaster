"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  matchSportsEventToGame,
  type SportsEventMatchCandidate,
} from "@/lib/sports-event-match";
import {
  getSportsWebSocketManager,
  type SportResult,
  WS_SETTLE_MAX_MS,
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
/**
 * Initial-burst quiet window. On connect the sports socket streams every
 * active game as an individual message with no "snapshot complete" marker,
 * so WS-derived counts are not authoritative until the epoch has produced
 * data and then gone quiet for this long (measured from both the connect
 * and the latest message). Applies per connection epoch — first connect
 * AND every reconnect.
 */
export const WS_SETTLE_MS = 4_000;
/**
 * Ceiling on the settle window per epoch — defined in the manager (whose
 * reconnect reconciliation shares it; see the constant's doc there) and
 * re-exported so settle-window consumers keep one import site.
 */
export { WS_SETTLE_MAX_MS };

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
export function gameMatchesLeagues(
  game: SportResult,
  leagueSet: ReadonlySet<string>
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
  const [connectedSince, setConnectedSince] = useState<number | null>(null);
  const [settled, setSettled] = useState(false);
  const [games, setGames] = useState<Map<string, LiveGameState>>(new Map());
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);

  // Subscribe to connection state
  useEffect(() => {
    const manager = getSportsWebSocketManager();
    const unsubscribe = manager.addConnectionListener((state) => {
      setConnectionState(state);
      setConnectedSince(manager.getConnectedSince());
    });
    return unsubscribe;
  }, []);

  // Per-epoch settle window: consumers must not treat the game map as
  // complete off a partially streamed initial burst. An epoch settles once
  // it has produced data and gone WS_SETTLE_MS quiet (the burst finished
  // streaming), or unconditionally at WS_SETTLE_MAX_MS — past the
  // manager's ping watchdog, so a silently dead socket is torn down before
  // its empty map could become authoritative. Latched per epoch: a message
  // arriving after settle is an ordinary update, not a reopened burst.
  const settledEpochRef = useRef<number | null>(null);
  useEffect(() => {
    if (connectedSince === null) {
      settledEpochRef.current = null;
      setSettled(false);
      return;
    }
    if (settledEpochRef.current === connectedSince) {
      setSettled(true);
      return;
    }
    const epochDataAt =
      lastMessageAt !== null && lastMessageAt >= connectedSince
        ? lastMessageAt
        : null;
    const settleAt =
      epochDataAt === null
        ? connectedSince + WS_SETTLE_MAX_MS
        : Math.min(
            connectedSince + WS_SETTLE_MAX_MS,
            Math.max(connectedSince + WS_SETTLE_MS, epochDataAt + WS_SETTLE_MS)
          );
    const settleNow = () => {
      settledEpochRef.current = connectedSince;
      setSettled(true);
      // The epoch's burst has finished streaming: every still-active game
      // now carries an in-epoch stamp. A non-ended entry stamped before
      // the epoch was not re-streamed — it ended or vanished while we were
      // disconnected — and keeping it would overcount Live until the 2h
      // stale sweep. Drop it (mirrors the manager's own epoch reconcile).
      // Ended entries stay: they are never re-streamed and back the
      // ended-corrections overlay.
      setGames((prev) => {
        let dropped = false;
        const next = new Map<string, LiveGameState>();
        for (const [key, game] of prev) {
          if (!game.ended && game.receivedAt < connectedSince) {
            dropped = true;
            continue;
          }
          next.set(key, game);
        }
        return dropped ? next : prev;
      });
    };
    const remaining = settleAt - Date.now();
    if (remaining <= 0) {
      settleNow();
      return;
    }
    setSettled(false);
    const timer = setTimeout(settleNow, remaining);
    return () => clearTimeout(timer);
  }, [connectedSince, lastMessageAt]);

  // Register as consumer + listen for sport events (store ALL, no filtering)
  useEffect(() => {
    if (!enabled) return;

    const manager = getSportsWebSocketManager();

    const removeConsumer = manager.addConsumer();

    // Hydrate from the singleton's accumulated map: the manager may already
    // hold the full stream (mounted after other consumers connected, or
    // games retained across a manager-level reconnect). Listener-only state
    // would start empty and undercount until every game re-streams. The
    // manager map is authoritative — REPLACE local state (even with an
    // empty map, so manager-side evictions propagate) and keep each game's
    // original receive stamp so remounts/reconnects do not renew eviction
    // TTLs.
    const seedFromSnapshot = () => {
      const snapshot = manager.getGamesSnapshot();
      let latestReceivedAt: number | null = null;
      const seeded = new Map<string, LiveGameState>();
      for (const [gameId, entry] of snapshot) {
        seeded.set(gameId, entry);
        if (latestReceivedAt === null || entry.receivedAt > latestReceivedAt) {
          latestReceivedAt = entry.receivedAt;
        }
      }
      setGames(seeded);
      // The stamps carry manager-side data knowledge (the burst may have
      // arrived before this consumer mounted); fold the newest into
      // lastMessageAt so the settle window sees the epoch's data.
      if (latestReceivedAt !== null) {
        const latest = latestReceivedAt;
        setLastMessageAt((prev) =>
          prev === null || latest > prev ? latest : prev
        );
      }
    };
    // Fires immediately with the current state (covers mounting into an
    // established connection) and again on every reconnect transition.
    const removeSeedListener = manager.addConnectionListener((state) => {
      if (state === "connected") seedFromSnapshot();
    });

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
      removeSeedListener();
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
    /**
     * True once the current connection epoch's stream has settled: the
     * epoch produced data and went WS_SETTLE_MS quiet, or stayed silent to
     * the WS_SETTLE_MAX_MS ceiling (past the manager's ping watchdog, so
     * silence means genuinely no active games). Gate anything that treats
     * the game map as complete (counts, badges) on this rather than on
     * isConnected/lastMessageAt.
     */
    isSettled: enabled && connectionState === "connected" && settled,
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

      const candidateGames: Map<string, LiveGameState> =
        manager.getGamesSnapshot();
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
      const bestMatch = matchSportsEventToGame(
        currentEvent,
        manager.getGamesSnapshot()
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
