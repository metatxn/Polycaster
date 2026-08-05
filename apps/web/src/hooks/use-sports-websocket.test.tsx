import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SportResult } from "@/lib/sports-websocket-manager";

const sportsManagerMock = vi.hoisted(() => {
  let eventListeners = new Set<(event: SportResult) => void>();
  let connectionListeners = new Set<(state: string) => void>();
  let games = new Map<string, SportResult>();
  let gameReceivedAt = new Map<string, number>();
  let connectionState = "disconnected";
  let connectedSince: number | null = null;

  return {
    addConsumer: vi.fn(() => () => undefined),
    addConnectionListener: vi.fn((listener: (state: string) => void) => {
      connectionListeners.add(listener);
      listener(connectionState);
      return () => connectionListeners.delete(listener);
    }),
    addEventListener: vi.fn((listener: (event: SportResult) => void) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    }),
    // Mirrors the real manager: entries carry their original receive stamp.
    getGamesSnapshot: vi.fn(() => {
      const snapshot = new Map<string, SportResult & { receivedAt: number }>();
      for (const [gameId, event] of games) {
        snapshot.set(gameId, {
          ...event,
          receivedAt: gameReceivedAt.get(gameId) ?? Date.now(),
        });
      }
      return snapshot;
    }),
    getConnectedSince: vi.fn(() => connectedSince),
    setConnection(state: string, since: number | null) {
      connectionState = state;
      connectedSince = since;
      for (const listener of connectionListeners) listener(state);
    },
    emitEvent(event: SportResult) {
      games.set(String(event.gameId), event);
      gameReceivedAt.set(String(event.gameId), Date.now());
      for (const listener of eventListeners) listener(event);
    },
    seedEvent(event: SportResult, receivedAt: number = Date.now()) {
      games.set(String(event.gameId), event);
      gameReceivedAt.set(String(event.gameId), receivedAt);
    },
    removeGame(gameId: number | string) {
      games.delete(String(gameId));
      gameReceivedAt.delete(String(gameId));
    },
    reset() {
      eventListeners = new Set();
      connectionListeners = new Set();
      games = new Map();
      gameReceivedAt = new Map();
      connectionState = "disconnected";
      connectedSince = null;
    },
    reconnect: vi.fn(),
  };
});

// Spread the real module so re-exported constants (WS_SETTLE_MAX_MS)
// resolve to their production values through the mock.
vi.mock("@/lib/sports-websocket-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sports-websocket-manager")>()),
  getSportsWebSocketManager: () => sportsManagerMock,
}));

import {
  useMatchedSportsLiveGame,
  useSportsWebSocket,
  WS_SETTLE_MAX_MS,
  WS_SETTLE_MS,
} from "./use-sports-websocket";

describe("useMatchedSportsLiveGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sportsManagerMock.reset();
  });

  it("does not re-render a detail consumer for unrelated sports updates", () => {
    const event = {
      id: "440791",
      slug: "fifa-colombia-italy-2026-06-24",
      title: "Colombia vs. Italy",
      startTime: "2026-06-24 12:00:00+00",
      teams: [
        { name: "Colombia", abbreviation: "COL" },
        { name: "Italy", abbreviation: "ITA" },
      ],
    };
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount += 1;
      return useMatchedSportsLiveGame(event, { enabled: true });
    });

    expect(result.current.game).toBeNull();
    expect(renderCount).toBe(1);
    sportsManagerMock.getGamesSnapshot.mockClear();

    act(() => {
      sportsManagerMock.emitEvent({
        gameId: 1,
        leagueAbbreviation: "fifa",
        slug: "fifa-spain-france-2026-06-24",
        homeTeam: "Spain",
        awayTeam: "France",
        status: "InProgress",
        score: "0-0",
        period: "1H",
        elapsed: "12",
        live: true,
        ended: false,
        updatedAt: "2026-06-24T12:12:00.000Z",
      });
    });

    expect(result.current.game).toBeNull();
    expect(renderCount).toBe(1);
    expect(sportsManagerMock.getGamesSnapshot).not.toHaveBeenCalled();

    act(() => {
      sportsManagerMock.emitEvent({
        gameId: 2,
        leagueAbbreviation: "fifa",
        slug: "fifa-colombia-italy-2026-06-24",
        homeTeam: "Colombia",
        awayTeam: "Italy",
        status: "InProgress",
        score: "1-0",
        period: "1H",
        elapsed: "24",
        live: true,
        ended: false,
        updatedAt: "2026-06-24T12:24:00.000Z",
      });
    });

    expect(result.current.game?.score).toBe("1-0");
    expect(renderCount).toBe(2);

    act(() => {
      sportsManagerMock.emitEvent({
        gameId: 3,
        leagueAbbreviation: "fifa",
        slug: "fifa-germany-brazil-2026-06-24",
        homeTeam: "Germany",
        awayTeam: "Brazil",
        status: "InProgress",
        score: "2-1",
        period: "2H",
        elapsed: "70",
        live: true,
        ended: false,
        updatedAt: "2026-06-24T13:10:00.000Z",
      });
    });

    expect(result.current.game?.score).toBe("1-0");
    expect(renderCount).toBe(2);
  });

  it("seeds the matched game from the manager snapshot on mount", async () => {
    sportsManagerMock.seedEvent({
      gameId: 2,
      leagueAbbreviation: "fifa",
      slug: "fifa-colombia-italy-2026-06-24",
      homeTeam: "Colombia",
      awayTeam: "Italy",
      status: "InProgress",
      score: "1-0",
      period: "1H",
      elapsed: "24",
      live: true,
      ended: false,
      updatedAt: "2026-06-24T12:24:00.000Z",
    });

    const event = {
      id: "440791",
      slug: "fifa-colombia-italy-2026-06-24",
      title: "Colombia vs. Italy",
      startTime: "2026-06-24 12:00:00+00",
      teams: [
        { name: "Colombia", abbreviation: "COL" },
        { name: "Italy", abbreviation: "ITA" },
      ],
    };

    const { result } = renderHook(() =>
      useMatchedSportsLiveGame(event, { enabled: true })
    );

    await waitFor(() => expect(result.current.game?.gameId).toBe(2));
    expect(result.current.game?.score).toBe("1-0");
  });

  it("keeps the best sports match when a lower-scoring duplicate game updates", () => {
    const event = {
      id: "440791",
      slug: "fifa-colombia-italy-2026-06-24",
      title: "Colombia vs. Italy",
      startTime: "2026-06-24 12:00:00+00",
      teams: [
        { name: "Colombia", abbreviation: "COL" },
        { name: "Italy", abbreviation: "ITA" },
      ],
    };

    const { result } = renderHook(() =>
      useMatchedSportsLiveGame(event, { enabled: true })
    );

    act(() => {
      sportsManagerMock.emitEvent({
        gameId: 2,
        leagueAbbreviation: "fifa",
        slug: "fifa-colombia-italy-2026-06-24",
        homeTeam: "Colombia",
        awayTeam: "Italy",
        status: "InProgress",
        score: "1-0",
        period: "1H",
        elapsed: "24",
        live: true,
        ended: false,
        updatedAt: "2026-06-24T12:24:00.000Z",
      });
    });

    expect(result.current.game?.gameId).toBe(2);
    expect(result.current.game?.score).toBe("1-0");

    act(() => {
      sportsManagerMock.emitEvent({
        gameId: 4,
        leagueAbbreviation: "fifa",
        homeTeam: "Colombia",
        awayTeam: "Italy",
        status: "InProgress",
        score: "0-0",
        period: "1H",
        elapsed: "25",
        live: true,
        ended: false,
      });
    });

    expect(result.current.game?.gameId).toBe(2);
    expect(result.current.game?.score).toBe("1-0");
  });

  it("updates an already matched game without cloning the full games snapshot", () => {
    const event = {
      id: "440791",
      slug: "fifa-colombia-italy-2026-06-24",
      title: "Colombia vs. Italy",
      startTime: "2026-06-24 12:00:00+00",
      teams: [
        { name: "Colombia", abbreviation: "COL" },
        { name: "Italy", abbreviation: "ITA" },
      ],
    };

    const { result } = renderHook(() =>
      useMatchedSportsLiveGame(event, { enabled: true })
    );

    act(() => {
      sportsManagerMock.emitEvent({
        gameId: 2,
        leagueAbbreviation: "fifa",
        slug: "fifa-colombia-italy-2026-06-24",
        homeTeam: "Colombia",
        awayTeam: "Italy",
        status: "InProgress",
        score: "1-0",
        period: "1H",
        elapsed: "24",
        live: true,
        ended: false,
        updatedAt: "2026-06-24T12:24:00.000Z",
      });
    });

    expect(result.current.game?.gameId).toBe(2);
    sportsManagerMock.getGamesSnapshot.mockClear();

    act(() => {
      sportsManagerMock.emitEvent({
        gameId: 2,
        leagueAbbreviation: "fifa",
        slug: "fifa-colombia-italy-2026-06-24",
        homeTeam: "Colombia",
        awayTeam: "Italy",
        status: "InProgress",
        score: "2-0",
        period: "2H",
        elapsed: "55",
        live: true,
        ended: false,
        updatedAt: "2026-06-24T12:55:00.000Z",
      });
    });

    expect(result.current.game?.score).toBe("2-0");
    expect(sportsManagerMock.getGamesSnapshot).not.toHaveBeenCalled();
  });
});

describe("useSportsWebSocket league filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sportsManagerMock.reset();
  });

  function gameFixture(overrides: Partial<SportResult>): SportResult {
    return {
      gameId: 0,
      leagueAbbreviation: "fifa",
      homeTeam: "Home",
      awayTeam: "Away",
      status: "InProgress",
      score: "0-0",
      period: "1H",
      live: true,
      ended: false,
      updatedAt: "2026-07-03T12:00:00.000Z",
      ...overrides,
    };
  }

  it("keeps slug-prefixed games whose feed row omits leagueAbbreviation", () => {
    const { result } = renderHook(() =>
      useSportsWebSocket({ enabled: true, leagues: ["NBA", "MLB"] })
    );

    act(() => {
      sportsManagerMock.emitEvent(
        gameFixture({
          gameId: 1,
          leagueAbbreviation: "MLB",
          slug: "mlb-nyy-bos-2026-07-03",
        })
      );
      sportsManagerMock.emitEvent(
        gameFixture({
          gameId: 2,
          // Feed row omits the league — membership must fall back to the
          // slug's league prefix instead of dropping the game entirely.
          leagueAbbreviation: undefined as unknown as string,
          slug: "nba-lal-bos-2026-07-03",
        })
      );
      sportsManagerMock.emitEvent(
        gameFixture({
          gameId: 3,
          leagueAbbreviation: "NHL",
          slug: "nhl-nyr-bos-2026-07-03",
        })
      );
      sportsManagerMock.emitEvent(
        gameFixture({
          gameId: 4,
          // Neither league nor slug — nothing to match on; stays excluded.
          leagueAbbreviation: undefined as unknown as string,
          slug: undefined,
        })
      );
    });

    expect(result.current.filteredAllGames.map((g) => g.gameId).sort()).toEqual(
      [1, 2]
    );
    expect(
      result.current.filteredLiveGames.map((g) => g.gameId).sort()
    ).toEqual([1, 2]);
  });
});

describe("useSportsWebSocket settle window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sportsManagerMock.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function gameFixture(overrides: Partial<SportResult>): SportResult {
    return {
      gameId: 0,
      leagueAbbreviation: "fifa",
      homeTeam: "Home",
      awayTeam: "Away",
      status: "InProgress",
      score: "0-0",
      period: "1H",
      live: true,
      ended: false,
      updatedAt: "2026-07-03T12:00:00.000Z",
      ...overrides,
    };
  }

  it("settles after a message and a quiet window, not on time alone", () => {
    const { result } = renderHook(() => useSportsWebSocket({ enabled: true }));
    expect(result.current.isSettled).toBe(false);

    act(() => {
      sportsManagerMock.setConnection("connected", Date.now());
    });
    expect(result.current.isConnected).toBe(true);
    expect(result.current.isSettled).toBe(false);

    act(() => {
      sportsManagerMock.emitEvent(gameFixture({ gameId: 1 }));
      vi.advanceTimersByTime(WS_SETTLE_MS);
    });
    expect(result.current.isSettled).toBe(true);
  });

  it("does not let a silent connection settle before the ceiling", () => {
    const { result } = renderHook(() => useSportsWebSocket({ enabled: true }));

    act(() => {
      sportsManagerMock.setConnection("connected", Date.now());
    });
    act(() => {
      vi.advanceTimersByTime(WS_SETTLE_MS);
    });
    // No message this epoch: the socket may be silently dead (the ping
    // watchdog only detects that at 10s), so an empty map must not become
    // authoritative yet.
    expect(result.current.isSettled).toBe(false);

    act(() => {
      vi.advanceTimersByTime(WS_SETTLE_MAX_MS - WS_SETTLE_MS);
    });
    // Past the watchdog the transport has proven liveness — silence now
    // genuinely means zero active games.
    expect(result.current.isSettled).toBe(true);
    expect(result.current.allGames).toEqual([]);
  });

  it("extends the settle window while the initial burst is still streaming", () => {
    const { result } = renderHook(() => useSportsWebSocket({ enabled: true }));

    act(() => {
      sportsManagerMock.setConnection("connected", Date.now());
    });
    act(() => {
      vi.advanceTimersByTime(WS_SETTLE_MS - 1_000);
      sportsManagerMock.emitEvent(gameFixture({ gameId: 1 }));
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // WS_SETTLE_MS after connect, but the latest message is only 1s old —
    // the burst may still be streaming.
    expect(result.current.isSettled).toBe(false);

    act(() => {
      vi.advanceTimersByTime(WS_SETTLE_MS - 1_000);
    });
    expect(result.current.isSettled).toBe(true);
  });

  it("settles at the ceiling under a continuous update stream and stays latched", () => {
    const { result } = renderHook(() => useSportsWebSocket({ enabled: true }));

    act(() => {
      sportsManagerMock.setConnection("connected", Date.now());
    });
    for (let elapsed = 0; elapsed < WS_SETTLE_MAX_MS; elapsed += 3_000) {
      act(() => {
        vi.advanceTimersByTime(3_000);
        sportsManagerMock.emitEvent(gameFixture({ gameId: 1 }));
      });
    }
    // Messages every 3s would extend the quiet window forever; the ceiling
    // still hands off from the bootstrap value.
    expect(result.current.isSettled).toBe(true);

    act(() => {
      sportsManagerMock.emitEvent(gameFixture({ gameId: 2 }));
    });
    // Latched: post-settle messages are ordinary updates, not a new burst.
    expect(result.current.isSettled).toBe(true);
  });

  it("seeds games and settles immediately when mounting into an established connection", () => {
    // Connected for a minute, burst received 30s ago — a late-mounting
    // consumer adopts the manager's map and is immediately authoritative.
    sportsManagerMock.seedEvent(
      gameFixture({ gameId: 7 }),
      Date.now() - 30_000
    );
    sportsManagerMock.setConnection("connected", Date.now() - 60_000);

    const { result } = renderHook(() => useSportsWebSocket({ enabled: true }));

    // The manager already holds the streamed burst — the hook must adopt it
    // rather than starting empty and waiting for per-game re-streams.
    expect(result.current.liveGames.map((g) => g.gameId)).toEqual([7]);
    expect(result.current.isSettled).toBe(true);
  });

  it("re-enters the settle window on reconnect while retaining games", () => {
    const { result } = renderHook(() => useSportsWebSocket({ enabled: true }));

    act(() => {
      sportsManagerMock.setConnection("connected", Date.now());
      sportsManagerMock.emitEvent(gameFixture({ gameId: 1 }));
      vi.advanceTimersByTime(WS_SETTLE_MS);
    });
    expect(result.current.isSettled).toBe(true);

    act(() => {
      sportsManagerMock.setConnection("reconnecting", null);
    });
    expect(result.current.isSettled).toBe(false);
    expect(result.current.liveGames).toHaveLength(1);

    act(() => {
      sportsManagerMock.setConnection("connected", Date.now());
    });
    // Reconnected, but the fresh epoch's burst has not settled yet.
    expect(result.current.isConnected).toBe(true);
    expect(result.current.isSettled).toBe(false);

    act(() => {
      // The server re-streams active games on connect; quiet after the
      // re-burst settles the new epoch.
      sportsManagerMock.emitEvent(gameFixture({ gameId: 1 }));
      vi.advanceTimersByTime(WS_SETTLE_MS);
    });
    expect(result.current.isSettled).toBe(true);
    expect(result.current.liveGames).toHaveLength(1);
  });

  it("drops live games the reconnect burst did not re-stream once the epoch settles", () => {
    const { result } = renderHook(() => useSportsWebSocket({ enabled: true }));

    act(() => {
      sportsManagerMock.setConnection("connected", Date.now());
      sportsManagerMock.emitEvent(gameFixture({ gameId: 1 }));
      sportsManagerMock.emitEvent(
        gameFixture({ gameId: 8, live: false, ended: true })
      );
      vi.advanceTimersByTime(WS_SETTLE_MS);
    });
    expect(result.current.isSettled).toBe(true);
    expect(result.current.liveGames.map((g) => g.gameId)).toEqual([1]);

    act(() => {
      sportsManagerMock.setConnection("reconnecting", null);
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
      sportsManagerMock.setConnection("connected", Date.now());
    });
    // Retained through the unsettled window: reconnects must not blank the
    // UI while the re-burst streams.
    expect(result.current.liveGames.map((g) => g.gameId)).toEqual([1]);

    act(() => {
      // The re-burst streams game 2 but never game 1 — it ended while the
      // socket was down, and ended games are not re-streamed.
      sportsManagerMock.emitEvent(gameFixture({ gameId: 2 }));
      vi.advanceTimersByTime(WS_SETTLE_MS);
    });
    expect(result.current.isSettled).toBe(true);
    // Settling makes the epoch authoritative: the un-restreamed live game
    // is dropped instead of overcounting Live until the 2h stale sweep.
    expect(result.current.liveGames.map((g) => g.gameId)).toEqual([2]);
    // Ended entries are exempt — they back the ended-corrections overlay.
    expect(result.current.finishedGames.map((g) => g.gameId)).toEqual([8]);
  });

  it("replaces hydrated state from the manager snapshot, including removals", () => {
    const { result } = renderHook(() => useSportsWebSocket({ enabled: true }));

    act(() => {
      sportsManagerMock.setConnection("connected", Date.now());
      sportsManagerMock.emitEvent(gameFixture({ gameId: 1 }));
      sportsManagerMock.emitEvent(gameFixture({ gameId: 2 }));
    });
    expect(result.current.allGames).toHaveLength(2);

    act(() => {
      sportsManagerMock.setConnection("reconnecting", null);
      sportsManagerMock.removeGame(1);
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
      sportsManagerMock.setConnection("connected", Date.now());
    });
    // Hydration is authoritative: a game the manager no longer holds must
    // not survive in hook state.
    expect(result.current.allGames.map((g) => g.gameId)).toEqual([2]);

    act(() => {
      sportsManagerMock.setConnection("reconnecting", null);
      sportsManagerMock.removeGame(2);
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
      sportsManagerMock.setConnection("connected", Date.now());
    });
    // An empty manager snapshot replaces local state too.
    expect(result.current.allGames).toEqual([]);
  });

  it("seeding preserves original receive stamps so eviction TTLs are not renewed", () => {
    // Ended game received 30+ minutes ago; the manager holds its original
    // stamp and the hook must adopt it, not restart the eviction clock.
    sportsManagerMock.seedEvent(
      gameFixture({ gameId: 9, live: false, ended: true }),
      Date.now() - (30 * 60 * 1000 + 1_000)
    );
    sportsManagerMock.setConnection("connected", Date.now() - 60_000);

    const { result } = renderHook(() => useSportsWebSocket({ enabled: true }));
    expect(result.current.finishedGames.map((g) => g.gameId)).toEqual([9]);

    act(() => {
      // First eviction sweep (60s) sees the true 30+ minute age.
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.finishedGames).toEqual([]);
  });
});
