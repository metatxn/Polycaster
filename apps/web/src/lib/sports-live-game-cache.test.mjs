import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldUseCachedSportsLiveGame,
  sportsLiveGameCacheKey,
} from "./sports-live-game-cache.ts";

test("uses a recent cached websocket score when it is newer than the API event", () => {
  const now = Date.UTC(2026, 4, 8, 3, 36, 0);

  const shouldUse = shouldUseCachedSportsLiveGame(
    {
      score: "80-93",
      period: "Q3",
      elapsed: "00:10",
      updatedAt: "2026-05-08T03:35:50.000Z",
      receivedAt: now - 10_000,
      live: true,
      ended: false,
    },
    {
      score: "78-89",
      period: "Q3",
      elapsed: "01:31",
      updatedAt: "2026-05-08T03:33:58.000Z",
      live: true,
    },
    now
  );

  assert.equal(shouldUse, true);
});

test("rejects a cached websocket score after the live cache ttl", () => {
  const now = Date.UTC(2026, 4, 8, 3, 40, 0);

  const shouldUse = shouldUseCachedSportsLiveGame(
    {
      score: "80-93",
      period: "Q3",
      elapsed: "00:10",
      updatedAt: "2026-05-08T03:35:50.000Z",
      receivedAt: now - 6 * 60_000,
      live: true,
      ended: false,
    },
    {
      score: "78-89",
      period: "Q3",
      elapsed: "01:31",
      updatedAt: "2026-05-08T03:33:58.000Z",
      live: true,
    },
    now
  );

  assert.equal(shouldUse, false);
});

test("does not use cached score when the API event is newer", () => {
  const now = Date.UTC(2026, 4, 8, 3, 40, 0);

  const shouldUse = shouldUseCachedSportsLiveGame(
    {
      score: "80-93",
      period: "Q3",
      elapsed: "00:10",
      updatedAt: "2026-05-08T03:35:50.000Z",
      receivedAt: now - 10_000,
      live: true,
      ended: false,
    },
    {
      score: "82-95",
      period: "Q4",
      elapsed: "11:30",
      updatedAt: "2026-05-08T03:36:10.000Z",
      live: true,
    },
    now
  );

  assert.equal(shouldUse, false);
});

test("builds a per-event session storage key", () => {
  assert.equal(
    sportsLiveGameCacheKey("nba-lal-okc-2026-05-07"),
    "sports-live-game:nba-lal-okc-2026-05-07"
  );
});
