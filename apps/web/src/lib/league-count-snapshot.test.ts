import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAGINATION_COUNT_TIMEOUT_MS,
  type PaginationCountQuery,
  type PaginationCountResult,
} from "./gamma-pagination-count";
import {
  buildLeagueCountFilters,
  getLeagueCountSnapshot,
  knownCountTagSlugCount,
  type LeagueCountSnapshot,
  LIVE_STALE_KEY,
  REFRESH_DEADLINE_MS,
  refreshLeagueCountSnapshot,
  resetLeagueCountSnapshotForTests,
  SCHEDULE_WINDOW_MS,
  SNAPSHOT_FRESH_MS,
  toPaginationQuery,
} from "./league-count-snapshot";
import { ALL_SPORTS_TAG_SLUG, SPORT_GROUPS } from "./sport-categories";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const GROUP_TAGS = new Set(SPORT_GROUPS.map((group) => group.tagSlug));
const ALL_LEAGUES = SPORT_GROUPS.flatMap((group) => group.leagues);
/** Filter task list plus the extra live-baseline task. */
const EXPECTED_TASK_COUNT = knownCountTagSlugCount() + 1;

function makeFetchTotal(
  handler: (query: PaginationCountQuery) => PaginationCountResult
) {
  const calls: PaginationCountQuery[] = [];
  const fetchTotal = async (
    query: PaginationCountQuery
  ): Promise<PaginationCountResult> => {
    calls.push(query);
    return handler(query);
  };
  return { calls, fetchTotal };
}

const ok = (total: number): PaginationCountResult => ({ ok: true, total });
const fail = (): PaginationCountResult => ({
  ok: false,
  reason: "network_error",
});

describe("buildLeagueCountFilters", () => {
  const filters = buildLeagueCountFilters();

  it("covers the sports total, every group tag and every league tag", () => {
    expect(filters.get(ALL_SPORTS_TAG_SLUG)).toEqual({
      tagSlug: ALL_SPORTS_TAG_SLUG,
    });
    for (const group of SPORT_GROUPS) {
      expect(filters.has(group.tagSlug)).toBe(true);
    }
    for (const league of ALL_LEAGUES) {
      expect(filters.get(league.tagSlug)).toMatchObject({
        tagSlug: league.tagSlug,
        scheduleWindow: true,
      });
    }
    expect(filters.size).toBe(knownCountTagSlugCount());
  });

  it("resolves group/league tag collisions in favor of the league filter", () => {
    const collisions = ALL_LEAGUES.filter((league) =>
      GROUP_TAGS.has(league.tagSlug)
    );
    // The taxonomy currently collides on "nfl" (Football group broad tag
    // vs the NFL league); the schedule-bounded league filter must win.
    expect(collisions.length).toBeGreaterThan(0);
    for (const league of collisions) {
      expect(filters.get(league.tagSlug)?.scheduleWindow).toBe(true);
    }
  });
});

describe("toPaginationQuery", () => {
  const NOW = Date.parse("2026-07-30T12:00:00.000Z");

  it("bounds schedule-window filters with start_time_min = now - 8h", () => {
    const query = toPaginationQuery(
      { tagSlug: "epl", scheduleWindow: true },
      NOW
    );
    expect(query.tagSlug).toBe("epl");
    expect(query.startTimeMin).toBe(
      new Date(NOW - SCHEDULE_WINDOW_MS).toISOString()
    );
    expect("live" in query ? query.live : undefined).toBeUndefined();
  });

  it("prefers seriesId and drops the tag slug when one is configured", () => {
    const query = toPaginationQuery(
      { tagSlug: "nba", seriesId: 10345, scheduleWindow: true },
      NOW
    );
    expect(query.seriesId).toBe(10345);
    expect(query.tagSlug).toBeUndefined();
  });

  it("leaves broad group filters unbounded", () => {
    const query = toPaginationQuery({ tagSlug: "soccer" }, NOW);
    expect(query).toEqual({
      tagSlug: "soccer",
      seriesId: undefined,
      startTimeMin: undefined,
    });
  });
});

describe("refreshLeagueCountSnapshot", () => {
  const T0 = Date.parse("2026-07-30T12:00:00.000Z");
  const now = () => T0;

  it("builds a full snapshot with exactly one live-baseline query", async () => {
    const { calls, fetchTotal } = makeFetchTotal(() => ok(7));
    const snapshot = await refreshLeagueCountSnapshot(null, {
      fetchTotal,
      now,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.generatedAt).toBe(new Date(T0).toISOString());
    expect(snapshot?.lastSuccessAt).toBe(new Date(T0).toISOString());
    expect(snapshot?.sports).toBe(7);
    expect(snapshot?.live).toBe(7);
    expect(snapshot?.staleKeys).toEqual([]);
    expect(snapshot?.byTagSlug[ALL_SPORTS_TAG_SLUG]).toBe(7);
    expect(LIVE_STALE_KEY in (snapshot?.byTagSlug ?? {})).toBe(false);

    expect(calls).toHaveLength(EXPECTED_TASK_COUNT);
    const liveCalls = calls.filter((query) => query.live !== undefined);
    expect(liveCalls).toEqual([{ tagSlug: ALL_SPORTS_TAG_SLUG, live: true }]);
  });

  it("counts series-configured leagues by series_id with the schedule bound", async () => {
    const league = ALL_LEAGUES.find((entry) => entry.seriesId !== undefined);
    expect(league).toBeDefined();
    const { calls, fetchTotal } = makeFetchTotal(() => ok(1));
    await refreshLeagueCountSnapshot(null, { fetchTotal, now });

    const seriesCall = calls.find(
      (query) => query.seriesId === league?.seriesId
    );
    expect(seriesCall).toBeDefined();
    expect(seriesCall?.tagSlug).toBeUndefined();
    expect(seriesCall?.startTimeMin).toBe(
      new Date(T0 - SCHEDULE_WINDOW_MS).toISOString()
    );
  });

  it("carries the previous value forward and flags the key when a filter fails", async () => {
    const target = ALL_LEAGUES.find(
      (league) =>
        league.seriesId === undefined && !GROUP_TAGS.has(league.tagSlug)
    );
    expect(target).toBeDefined();
    const previous: LeagueCountSnapshot = {
      generatedAt: new Date(T0 - 60_000).toISOString(),
      lastSuccessAt: new Date(T0 - 60_000).toISOString(),
      sports: 100,
      live: 5,
      byTagSlug: { [target?.tagSlug ?? ""]: 42 },
      staleKeys: [],
    };
    const { fetchTotal } = makeFetchTotal((query) =>
      query.live === undefined && query.tagSlug === target?.tagSlug
        ? fail()
        : ok(2)
    );

    const snapshot = await refreshLeagueCountSnapshot(previous, {
      fetchTotal,
      now,
    });
    expect(snapshot?.byTagSlug[target?.tagSlug ?? ""]).toBe(42);
    expect(snapshot?.staleKeys).toEqual([target?.tagSlug]);
    expect(snapshot?.sports).toBe(2);
    expect(snapshot?.live).toBe(2);
    // The attempt time advances, but the carried key means this refresh was
    // not a full success — lastSuccessAt must not move.
    expect(snapshot?.generatedAt).toBe(new Date(T0).toISOString());
    expect(snapshot?.lastSuccessAt).toBe(previous.lastSuccessAt);
  });

  it("omits a failed key entirely when there is no previous value", async () => {
    const target = ALL_LEAGUES.find(
      (league) =>
        league.seriesId === undefined && !GROUP_TAGS.has(league.tagSlug)
    );
    const { fetchTotal } = makeFetchTotal((query) =>
      query.live === undefined && query.tagSlug === target?.tagSlug
        ? fail()
        : ok(2)
    );

    const snapshot = await refreshLeagueCountSnapshot(null, {
      fetchTotal,
      now,
    });
    expect(snapshot).not.toBeNull();
    expect((target?.tagSlug ?? "") in (snapshot?.byTagSlug ?? {})).toBe(false);
    expect(snapshot?.staleKeys).toEqual([target?.tagSlug]);
    expect(snapshot?.lastSuccessAt).toBeNull();
  });

  it("carries the live baseline forward when only the live query fails", async () => {
    const previous: LeagueCountSnapshot = {
      generatedAt: new Date(T0 - 60_000).toISOString(),
      lastSuccessAt: new Date(T0 - 60_000).toISOString(),
      sports: 100,
      live: 9,
      byTagSlug: {},
      staleKeys: [],
    };
    const { fetchTotal } = makeFetchTotal((query) =>
      query.live === true ? fail() : ok(3)
    );

    const snapshot = await refreshLeagueCountSnapshot(previous, {
      fetchTotal,
      now,
    });
    expect(snapshot?.live).toBe(9);
    expect(snapshot?.staleKeys).toEqual([LIVE_STALE_KEY]);
  });

  it("keeps live null (never zero) when it has never succeeded", async () => {
    const { fetchTotal } = makeFetchTotal((query) =>
      query.live === true ? fail() : ok(3)
    );
    const snapshot = await refreshLeagueCountSnapshot(null, {
      fetchTotal,
      now,
    });
    expect(snapshot?.live).toBeNull();
    expect(snapshot?.staleKeys).toEqual([LIVE_STALE_KEY]);
  });

  it("returns null only on total failure with no previous snapshot", async () => {
    const { fetchTotal } = makeFetchTotal(() => fail());
    await expect(
      refreshLeagueCountSnapshot(null, { fetchTotal, now })
    ).resolves.toBeNull();
  });

  it("fails remaining filters fast once the refresh deadline passes", async () => {
    let t = T0;
    const calls: PaginationCountQuery[] = [];
    const timeouts: Array<number | undefined> = [];
    const fetchTotal = async (
      query: PaginationCountQuery,
      options?: { timeoutMs?: number }
    ): Promise<PaginationCountResult> => {
      calls.push(query);
      timeouts.push(options?.timeoutMs);
      // The first upstream call consumes the entire deadline budget.
      t += REFRESH_DEADLINE_MS + 1;
      return ok(4);
    };
    const previous: LeagueCountSnapshot = {
      generatedAt: new Date(T0 - 60_000).toISOString(),
      lastSuccessAt: new Date(T0 - 60_000).toISOString(),
      sports: 100,
      live: 9,
      byTagSlug: {},
      staleKeys: [],
    };

    const snapshot = await refreshLeagueCountSnapshot(previous, {
      fetchTotal,
      now: () => t,
    });

    // Only the first task reached Gamma; every later task failed fast as a
    // timeout instead of starting a doomed upstream call.
    expect(calls).toHaveLength(1);
    expect(timeouts[0]).toBe(PAGINATION_COUNT_TIMEOUT_MS);
    // The first task is the all-sports total; its result landed, everything
    // else carried forward into staleKeys.
    expect(snapshot?.sports).toBe(4);
    expect(snapshot?.live).toBe(9);
    expect(snapshot?.staleKeys).toHaveLength(EXPECTED_TASK_COUNT - 1);
    expect(snapshot?.staleKeys).toContain(LIVE_STALE_KEY);
    expect(snapshot?.lastSuccessAt).toBe(previous.lastSuccessAt);
  });

  it("retries previously stale filters first so deadline cuts rotate", async () => {
    // A broad group tag no league filter overrides, so its query keeps the
    // tag slug; taken from the tail of the fixed taxonomy order.
    const target = SPORT_GROUPS.filter(
      (group) =>
        group.tagSlug &&
        !ALL_LEAGUES.some((league) => league.tagSlug === group.tagSlug)
    ).at(-1)?.tagSlug;
    expect(target).toBeDefined();
    const previous: LeagueCountSnapshot = {
      generatedAt: new Date(T0 - 60_000).toISOString(),
      lastSuccessAt: new Date(T0 - 60_000).toISOString(),
      sports: 100,
      live: 9,
      byTagSlug: { [target ?? ""]: 5 },
      staleKeys: [target ?? "", LIVE_STALE_KEY],
    };
    const { calls, fetchTotal } = makeFetchTotal(() => ok(2));

    const snapshot = await refreshLeagueCountSnapshot(previous, {
      fetchTotal,
      now,
    });

    // The two carried-forward keys jump the queue (keeping their relative
    // order); the rest of the taxonomy still runs after them.
    expect(calls[0]?.tagSlug).toBe(target);
    expect(calls[0]?.live).toBeUndefined();
    expect(calls[1]?.live).toBe(true);
    expect(calls).toHaveLength(EXPECTED_TASK_COUNT);
    expect(snapshot?.staleKeys).toEqual([]);
    expect(snapshot?.lastSuccessAt).toBe(new Date(T0).toISOString());
  });

  it("serves a fully carried snapshot when every filter fails but a previous exists", async () => {
    const leagueTag = ALL_LEAGUES[0].tagSlug;
    const previous: LeagueCountSnapshot = {
      generatedAt: new Date(T0 - 60_000).toISOString(),
      lastSuccessAt: new Date(T0 - 60_000).toISOString(),
      sports: 100,
      live: 9,
      byTagSlug: { [leagueTag]: 3 },
      staleKeys: [],
    };
    const { fetchTotal } = makeFetchTotal(() => fail());

    const snapshot = await refreshLeagueCountSnapshot(previous, {
      fetchTotal,
      now,
    });
    expect(snapshot?.sports).toBe(100);
    expect(snapshot?.live).toBe(9);
    expect(snapshot?.byTagSlug).toEqual({ [leagueTag]: 3 });
    expect(snapshot?.staleKeys).toHaveLength(EXPECTED_TASK_COUNT);
  });
});

describe("getLeagueCountSnapshot", () => {
  const T0 = Date.parse("2026-07-30T12:00:00.000Z");

  beforeEach(() => {
    resetLeagueCountSnapshotForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes on cold start, then serves from per-isolate memory", async () => {
    const { calls, fetchTotal } = makeFetchTotal(() => ok(5));

    const first = await getLeagueCountSnapshot({
      deps: { fetchTotal, now: () => T0 },
    });
    expect(first.source).toBe("refresh");
    expect(first.snapshot?.sports).toBe(5);
    expect(calls).toHaveLength(EXPECTED_TASK_COUNT);

    const second = await getLeagueCountSnapshot({
      deps: { fetchTotal, now: () => T0 + 1_000 },
    });
    expect(second.source).toBe("memory");
    expect(second.ageMs).toBe(1_000);
    expect(calls).toHaveLength(EXPECTED_TASK_COUNT);
  });

  it("serves stale immediately and refreshes via waitUntil when provided", async () => {
    const cold = makeFetchTotal(() => ok(5));
    await getLeagueCountSnapshot({
      deps: { fetchTotal: cold.fetchTotal, now: () => T0 },
    });

    const T1 = T0 + SNAPSHOT_FRESH_MS + 1_000;
    const scheduled: Promise<unknown>[] = [];
    const warm = makeFetchTotal(() => ok(9));

    const stale = await getLeagueCountSnapshot({
      waitUntil: (promise) => scheduled.push(promise),
      deps: { fetchTotal: warm.fetchTotal, now: () => T1 },
    });
    expect(stale.source).toBe("stale");
    expect(stale.snapshot?.sports).toBe(5);
    expect(stale.ageMs).toBe(SNAPSHOT_FRESH_MS + 1_000);
    expect(scheduled).toHaveLength(1);

    await scheduled[0];
    const refreshed = await getLeagueCountSnapshot({
      deps: { fetchTotal: warm.fetchTotal, now: () => T1 + 1_000 },
    });
    expect(refreshed.source).toBe("memory");
    expect(refreshed.snapshot?.sports).toBe(9);
  });

  it("deduplicates concurrent cold-start refreshes (single flight)", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: PaginationCountQuery[] = [];
    const fetchTotal = async (
      query: PaginationCountQuery
    ): Promise<PaginationCountResult> => {
      calls.push(query);
      await gate;
      return ok(3);
    };

    const deps = { fetchTotal, now: () => T0 };
    const firstRead = getLeagueCountSnapshot({ deps });
    const secondRead = getLeagueCountSnapshot({ deps });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();

    const [first, second] = await Promise.all([firstRead, secondRead]);
    expect(first.snapshot).not.toBeNull();
    expect(first.snapshot).toBe(second.snapshot);
    expect(calls).toHaveLength(EXPECTED_TASK_COUNT);
  });

  it("returns null (route 503) only when a cold start cannot reach Gamma", async () => {
    const { fetchTotal } = makeFetchTotal(() => fail());
    const result = await getLeagueCountSnapshot({
      deps: { fetchTotal, now: () => T0 },
    });
    expect(result).toEqual({ snapshot: null, source: "refresh", ageMs: null });
  });

  it("shares one snapshot across isolates via the fixed-key edge cache", async () => {
    const store = new Map<string, Response>();
    vi.stubGlobal("caches", {
      default: {
        match: async (url: string) => store.get(String(url))?.clone(),
        put: async (url: string, response: Response) => {
          store.set(String(url), response);
        },
      },
    });

    const cold = makeFetchTotal(() => ok(5));
    await getLeagueCountSnapshot({
      deps: { fetchTotal: cold.fetchTotal, now: () => T0 },
    });
    expect(store.size).toBe(1);

    // A different isolate: no memory snapshot, edge copy still fresh.
    resetLeagueCountSnapshotForTests();
    const other = makeFetchTotal(() => fail());
    const result = await getLeagueCountSnapshot({
      deps: { fetchTotal: other.fetchTotal, now: () => T0 + 1_000 },
    });
    expect(result.source).toBe("edge-cache");
    expect(result.snapshot?.sports).toBe(5);
    expect(other.calls).toHaveLength(0);
  });
});
