import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SportResult } from "@/lib/sports-websocket-manager";

const sportsManagerMock = vi.hoisted(() => {
  let eventListeners = new Set<(event: SportResult) => void>();
  let connectionListeners = new Set<(state: string) => void>();
  let games = new Map<string, SportResult>();

  return {
    addConsumer: vi.fn(() => () => undefined),
    addConnectionListener: vi.fn((listener: (state: string) => void) => {
      connectionListeners.add(listener);
      listener("disconnected");
      return () => connectionListeners.delete(listener);
    }),
    addEventListener: vi.fn((listener: (event: SportResult) => void) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    }),
    getGamesSnapshot: vi.fn(() => new Map(games)),
    emitEvent(event: SportResult) {
      games.set(String(event.gameId), event);
      for (const listener of eventListeners) listener(event);
    },
    seedEvent(event: SportResult) {
      games.set(String(event.gameId), event);
    },
    reset() {
      eventListeners = new Set();
      connectionListeners = new Set();
      games = new Map();
    },
    reconnect: vi.fn(),
  };
});

vi.mock("@/lib/sports-websocket-manager", () => ({
  getSportsWebSocketManager: () => sportsManagerMock,
}));

import {
  useMatchedSportsLiveGame,
  useSportsWebSocket,
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
