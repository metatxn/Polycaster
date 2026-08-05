import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSportsWebSocketManager,
  type SportResult,
  WS_SETTLE_MAX_MS,
} from "./sports-websocket-manager";

const BASE_GAME: SportResult = {
  gameId: 1,
  leagueAbbreviation: "fifa",
  slug: "fifa-colombia-italy-2026-06-24",
  homeTeam: "Colombia",
  awayTeam: "Italy",
  status: "InProgress",
  score: "0-0",
  period: "1H",
  live: true,
  ended: false,
};

describe("SportsWebSocketManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    const manager = getSportsWebSocketManager() as unknown as {
      disconnect: () => void;
      games?: Map<string, SportResult>;
      consumerCount?: number;
    };
    manager.disconnect();
    manager.games?.clear();
    manager.consumerCount = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("evicts stale cached games before exposing snapshots", () => {
    const manager = getSportsWebSocketManager() as unknown as {
      games: Map<string, SportResult>;
      getGamesSnapshot: () => Map<string, SportResult>;
    };
    const now = Date.now();
    manager.games.set("old", {
      ...BASE_GAME,
      gameId: 10,
      ended: true,
      live: false,
      updatedAt: new Date(now - 31 * 60 * 1000).toISOString(),
    });
    manager.games.set("fresh", {
      ...BASE_GAME,
      gameId: 11,
      updatedAt: new Date(now).toISOString(),
    });

    const snapshot = manager.getGamesSnapshot();

    expect(snapshot.has("old")).toBe(false);
    expect(snapshot.has("fresh")).toBe(true);
  });

  it("clears cached games on explicit disconnect", () => {
    const manager = getSportsWebSocketManager() as unknown as {
      games: Map<string, SportResult>;
      disconnect: () => void;
      getGamesSnapshot: () => Map<string, SportResult>;
    };
    manager.games.set("cached", BASE_GAME);

    manager.disconnect();

    expect(manager.getGamesSnapshot().size).toBe(0);
  });

  it("evicts timestamp-less games by their receive time", () => {
    const manager = getSportsWebSocketManager() as unknown as {
      broadcastEvent: (event: SportResult) => void;
      getGamesSnapshot: () => Map<string, SportResult>;
    };
    const receivedAt = new Date("2026-06-30T00:00:00.000Z");
    vi.setSystemTime(receivedAt);

    manager.broadcastEvent({
      ...BASE_GAME,
      gameId: 12,
      slug: "timestamp-less-live-game",
    });

    expect(manager.getGamesSnapshot().has("12")).toBe(true);

    vi.setSystemTime(receivedAt.getTime() + 2 * 60 * 60 * 1000 + 1);

    expect(manager.getGamesSnapshot().has("12")).toBe(false);
  });

  it("does not close the socket immediately during consumer handoff", () => {
    const close = vi.fn();
    const sockets: Array<{ close: () => void; readyState: number }> = [];
    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      close = close;

      constructor() {
        sockets.push(this);
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const manager = getSportsWebSocketManager();
    const removeConsumer = manager.addConsumer();
    expect(sockets).toHaveLength(1);

    removeConsumer();

    expect(close).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("drops non-ended games the reconnect burst did not re-stream", () => {
    const sockets: Array<{
      onopen: (() => void) | null;
      onmessage: ((event: { data: string }) => void) | null;
      onclose: ((event: CloseEvent) => void) | null;
    }> = [];
    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      send = vi.fn();
      close = vi.fn();

      constructor() {
        sockets.push(this);
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const manager = getSportsWebSocketManager();
    manager.addConsumer();
    sockets[0].onopen?.();
    sockets[0].onmessage?.({
      data: JSON.stringify({ ...BASE_GAME, gameId: 21 }),
    });
    sockets[0].onmessage?.({
      data: JSON.stringify({
        ...BASE_GAME,
        gameId: 22,
        live: false,
        ended: true,
      }),
    });

    // Abnormal close: games are retained so consumers do not blank.
    sockets[0].onclose?.({ code: 1006, reason: "dropped" } as CloseEvent);
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);

    // New epoch: the server re-streams active games — game 23 arrives but
    // game 21 does not (it ended while offline). Feed pings so the 10s
    // watchdog does not tear the socket down while time advances.
    sockets[1].onopen?.();
    sockets[1].onmessage?.({
      data: JSON.stringify({ ...BASE_GAME, gameId: 23 }),
    });
    vi.advanceTimersByTime(4_000);
    sockets[1].onmessage?.({ data: "ping" });
    vi.advanceTimersByTime(4_000);
    sockets[1].onmessage?.({ data: "ping" });

    // Still inside the reconcile window: the prior-epoch entry is retained.
    expect(manager.getGamesSnapshot().has("21")).toBe(true);

    vi.advanceTimersByTime(WS_SETTLE_MAX_MS - 8_000);

    const snapshot = manager.getGamesSnapshot();
    expect(snapshot.has("21")).toBe(false);
    expect(snapshot.has("23")).toBe(true);
    // Ended entries are exempt: never re-streamed, and they back the
    // ended-game baseline corrections.
    expect(snapshot.get("22")?.ended).toBe(true);
  });
});
