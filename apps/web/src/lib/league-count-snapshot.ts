import {
  fetchGammaPaginationTotal,
  PAGINATION_COUNT_TIMEOUT_MS,
  type PaginationCountQuery,
  type PaginationCountResult,
} from "@/lib/gamma-pagination-count";
import { logger } from "@/lib/logger";
import { ALL_SPORTS_TAG_SLUG, SPORT_GROUPS } from "@/lib/sport-categories";

/**
 * One canonical league-count snapshot for the whole sport taxonomy.
 *
 * Every `/api/events/league-counts` response is served from this single
 * atomically-replaced object instead of counting per requested slug
 * combination. A refresh issues one `limit=1` pagination call per filter
 * (~90 total) — no keyset pages, no per-character scanning.
 *
 * Failure policy: a filter that fails carries its previous value forward
 * and is listed in `staleKeys`; it never becomes a silent zero. If nothing
 * has ever succeeded the read returns `null` and the route responds 503.
 */

/** A snapshot older than this triggers a refresh on the next read. */
export const SNAPSHOT_FRESH_MS = 30_000;
/** Matches the verified `isCurrentSportsEvent` window for league baselines. */
export const SCHEDULE_WINDOW_MS = 8 * 60 * 60 * 1000;
/**
 * Cloudflare Workers run ~6 simultaneous outbound fetches; beyond that the
 * runtime queues the call while its `AbortSignal.timeout` is already
 * ticking, so higher concurrency only converts queue time into spurious
 * timeouts.
 */
const REFRESH_CONCURRENCY = 6;
/**
 * Hard ceiling on one refresh pass. `waitUntil` work can be cancelled ~30s
 * after the response is sent; tasks that would start after the deadline
 * fail fast as timeouts and carry forward via `staleKeys` instead of
 * risking the whole refresh being killed mid-flight.
 */
export const REFRESH_DEADLINE_MS = 20_000;
/** Sentinel used in `staleKeys` for the live-baseline filter. */
export const LIVE_STALE_KEY = "live";

export interface LeagueCountFilter {
  /** Response key — the Gamma tag slug the client asks for. */
  tagSlug: string;
  /** Prefer `series_id` when configured (mirrors Polymarket's own UI). */
  seriesId?: number;
  /** League baselines bound the schedule with `start_time_min = now - 8h`. */
  scheduleWindow?: boolean;
}

export interface LeagueCountSnapshot {
  /** Refresh attempt time — drives the 30s cadence even when values carry. */
  generatedAt: string;
  /**
   * Last refresh in which every filter succeeded; `null` until one has.
   * Values flagged in `staleKeys` are no fresher than this.
   */
  lastSuccessAt: string | null;
  /** Total open sports events; `null` only if never successfully fetched. */
  sports: number | null;
  /** Gamma `live=true` baseline; `null` only if never successfully fetched. */
  live: number | null;
  byTagSlug: Record<string, number>;
  /** Filters whose latest refresh failed (values carried forward). */
  staleKeys: string[];
}

export interface SnapshotReadResult {
  snapshot: LeagueCountSnapshot | null;
  source: "memory" | "edge-cache" | "refresh" | "stale";
  ageMs: number | null;
}

export interface SnapshotDeps {
  fetchTotal?: typeof fetchGammaPaginationTotal;
  now?: () => number;
}

/**
 * Full filter taxonomy. Built once; league definitions win key collisions
 * with group tags (e.g. the `nfl` league schedule filter over the Football
 * group's broad `nfl` tag), preserving the previous route's behavior.
 */
export function buildLeagueCountFilters(): Map<string, LeagueCountFilter> {
  const filters = new Map<string, LeagueCountFilter>([
    [ALL_SPORTS_TAG_SLUG, { tagSlug: ALL_SPORTS_TAG_SLUG }],
  ]);
  for (const group of SPORT_GROUPS) {
    filters.set(group.tagSlug, { tagSlug: group.tagSlug });
  }
  for (const group of SPORT_GROUPS) {
    for (const league of group.leagues) {
      filters.set(league.tagSlug, {
        tagSlug: league.tagSlug,
        seriesId: league.seriesId,
        scheduleWindow: true,
      });
    }
  }
  return filters;
}

const COUNT_FILTERS = buildLeagueCountFilters();

export function isKnownCountTagSlug(slug: string): boolean {
  return COUNT_FILTERS.has(slug);
}

export function knownCountTagSlugCount(): number {
  return COUNT_FILTERS.size;
}

export function toPaginationQuery(
  filter: LeagueCountFilter,
  nowMs: number
): PaginationCountQuery {
  return {
    tagSlug: filter.seriesId === undefined ? filter.tagSlug : undefined,
    seriesId: filter.seriesId,
    startTimeMin: filter.scheduleWindow
      ? new Date(nowMs - SCHEDULE_WINDOW_MS).toISOString()
      : undefined,
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

function describeFailure(
  result: Extract<PaginationCountResult, { ok: false }>
) {
  return result.status !== undefined
    ? `${result.reason}:${result.status}`
    : result.reason;
}

/**
 * Build the next snapshot. Pure with respect to module state: reads only
 * `previous` for carry-forward, so replacement stays atomic.
 */
export async function refreshLeagueCountSnapshot(
  previous: LeagueCountSnapshot | null,
  deps: SnapshotDeps = {}
): Promise<LeagueCountSnapshot | null> {
  const fetchTotal = deps.fetchTotal ?? fetchGammaPaginationTotal;
  const now = deps.now ?? Date.now;
  const startedAt = now();

  const filters = Array.from(COUNT_FILTERS.values());
  const tasks: Array<{
    key: string;
    query: PaginationCountQuery;
  }> = filters.map((filter) => ({
    key: filter.tagSlug,
    query: toPaginationQuery(filter, startedAt),
  }));
  // Live baseline: used only to bootstrap the client's WebSocket-driven
  // badge. Scheduled filters above never send a `live` parameter.
  tasks.push({
    key: LIVE_STALE_KEY,
    query: { tagSlug: ALL_SPORTS_TAG_SLUG, live: true },
  });

  // Filters that missed the previous pass run first. The task list is
  // otherwise fixed taxonomy order, so under repeated deadline pressure the
  // same tail filters would stay stale forever; front-loading last pass's
  // stale keys rotates the cut through the taxonomy instead (a refreshed key
  // drops back to the fresh tail). Stable sort: order is unchanged within
  // each partition, and unchanged entirely when every filter succeeded.
  const staleSet = new Set(previous?.staleKeys ?? []);
  if (staleSet.size > 0) {
    tasks.sort(
      (a, b) => Number(staleSet.has(b.key)) - Number(staleSet.has(a.key))
    );
  }

  const results = await mapWithConcurrency(
    tasks,
    REFRESH_CONCURRENCY,
    (task): Promise<PaginationCountResult> => {
      const remainingMs = REFRESH_DEADLINE_MS - (now() - startedAt);
      if (remainingMs <= 0) {
        return Promise.resolve({ ok: false, reason: "timeout" });
      }
      return fetchTotal(task.query, {
        timeoutMs: Math.min(PAGINATION_COUNT_TIMEOUT_MS, remainingMs),
      });
    }
  );

  const byTagSlug: Record<string, number> = {};
  const staleKeys: string[] = [];
  let live: number | null = null;
  let succeeded = 0;

  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    const result = results[i];

    if (result.ok) {
      succeeded += 1;
      if (task.key === LIVE_STALE_KEY) {
        live = result.total;
      } else {
        byTagSlug[task.key] = result.total;
      }
      continue;
    }

    logger.warn("events.league_counts.filter_failed", {
      key: task.key,
      seriesId: task.query.seriesId,
      live: task.query.live === true,
      reason: describeFailure(result),
    });

    if (task.key === LIVE_STALE_KEY) {
      live = previous?.live ?? null;
      staleKeys.push(LIVE_STALE_KEY);
      continue;
    }
    const carried = previous?.byTagSlug[task.key];
    if (carried !== undefined) {
      byTagSlug[task.key] = carried;
    }
    staleKeys.push(task.key);
  }

  if (succeeded === 0 && previous === null) {
    logger.error("events.league_counts.snapshot_refresh_failed", {
      filters: tasks.length,
      durationMs: now() - startedAt,
    });
    return null;
  }

  const generatedAt = new Date(startedAt).toISOString();
  const snapshot: LeagueCountSnapshot = {
    generatedAt,
    // Carried values must not masquerade as fresh: only a refresh with zero
    // failures advances lastSuccessAt.
    lastSuccessAt:
      staleKeys.length === 0 ? generatedAt : (previous?.lastSuccessAt ?? null),
    sports: byTagSlug[ALL_SPORTS_TAG_SLUG] ?? previous?.sports ?? null,
    live,
    byTagSlug,
    staleKeys,
  };

  logger.info("events.league_counts.snapshot_refreshed", {
    filters: tasks.length,
    failed: staleKeys.length,
    durationMs: now() - startedAt,
    sports: snapshot.sports,
    live: snapshot.live,
  });

  return snapshot;
}

// ---------------------------------------------------------------------------
// Storage: per-isolate memory + fixed-key edge cache, single-flight refresh.
// ---------------------------------------------------------------------------

/**
 * Fixed synthetic key so every isolate in a data center shares one cached
 * snapshot. The Cache API is per-POP by design — each POP independently
 * meets the freshness bound; if globally coordinated counts are ever
 * required, the issue doc reserves a Durable Object for that.
 */
const SNAPSHOT_CACHE_URL =
  "https://knoww.app/__internal/league-count-snapshot/v1";
/** Edge copy survives long enough to bridge a sustained Gamma outage. */
const SNAPSHOT_CACHE_MAX_AGE_S = 3600;

let memorySnapshot: LeagueCountSnapshot | null = null;
let inflightRefresh: Promise<LeagueCountSnapshot | null> | null = null;

export function resetLeagueCountSnapshotForTests(): void {
  memorySnapshot = null;
  inflightRefresh = null;
}

function getEdgeCache(): Cache | null {
  if (typeof caches === "undefined") return null;
  const withDefault = caches as unknown as { default?: Cache };
  return withDefault.default ?? null;
}

function parseSnapshot(value: unknown): LeagueCountSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<LeagueCountSnapshot>;
  if (typeof candidate.generatedAt !== "string") return null;
  if (typeof candidate.byTagSlug !== "object" || candidate.byTagSlug === null) {
    return null;
  }
  return {
    generatedAt: candidate.generatedAt,
    lastSuccessAt:
      typeof candidate.lastSuccessAt === "string"
        ? candidate.lastSuccessAt
        : null,
    sports: typeof candidate.sports === "number" ? candidate.sports : null,
    live: typeof candidate.live === "number" ? candidate.live : null,
    byTagSlug: candidate.byTagSlug as Record<string, number>,
    staleKeys: Array.isArray(candidate.staleKeys)
      ? candidate.staleKeys.filter((key) => typeof key === "string")
      : [],
  };
}

async function readEdgeSnapshot(): Promise<LeagueCountSnapshot | null> {
  const cache = getEdgeCache();
  if (!cache) return null;
  try {
    const response = await cache.match(SNAPSHOT_CACHE_URL);
    if (!response) return null;
    return parseSnapshot(await response.json());
  } catch (error) {
    logger.warn("events.league_counts.edge_cache_read_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function writeEdgeSnapshot(snapshot: LeagueCountSnapshot): Promise<void> {
  const cache = getEdgeCache();
  if (!cache) return;
  try {
    await cache.put(
      SNAPSHOT_CACHE_URL,
      new Response(JSON.stringify(snapshot), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `max-age=${SNAPSHOT_CACHE_MAX_AGE_S}`,
        },
      })
    );
  } catch (error) {
    logger.warn("events.league_counts.edge_cache_write_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function snapshotAgeMs(
  snapshot: LeagueCountSnapshot,
  nowMs: number
): number | null {
  const generated = new Date(snapshot.generatedAt).getTime();
  return Number.isFinite(generated) ? Math.max(0, nowMs - generated) : null;
}

function isFresh(snapshot: LeagueCountSnapshot, nowMs: number): boolean {
  const age = snapshotAgeMs(snapshot, nowMs);
  return age !== null && age <= SNAPSHOT_FRESH_MS;
}

function startSingleFlightRefresh(
  deps: SnapshotDeps
): Promise<LeagueCountSnapshot | null> {
  if (!inflightRefresh) {
    inflightRefresh = (async () => {
      try {
        const next = await refreshLeagueCountSnapshot(memorySnapshot, deps);
        if (next) {
          memorySnapshot = next;
          await writeEdgeSnapshot(next);
        }
        return next;
      } finally {
        inflightRefresh = null;
      }
    })();
  }
  return inflightRefresh;
}

export interface GetSnapshotOptions {
  /**
   * Cloudflare `ctx.waitUntil` when available: lets a stale-but-usable
   * snapshot be served immediately while the refresh completes off the
   * request's critical path. Without it the refresh blocks.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  deps?: SnapshotDeps;
}

export async function getLeagueCountSnapshot(
  options: GetSnapshotOptions = {}
): Promise<SnapshotReadResult> {
  const deps = options.deps ?? {};
  const now = deps.now ?? Date.now;
  const nowMs = now();

  if (memorySnapshot && isFresh(memorySnapshot, nowMs)) {
    return {
      snapshot: memorySnapshot,
      source: "memory",
      ageMs: snapshotAgeMs(memorySnapshot, nowMs),
    };
  }

  // Another isolate may have refreshed more recently.
  const edge = await readEdgeSnapshot();
  if (edge) {
    const memGenerated = memorySnapshot
      ? new Date(memorySnapshot.generatedAt).getTime()
      : Number.NEGATIVE_INFINITY;
    if (new Date(edge.generatedAt).getTime() > memGenerated) {
      memorySnapshot = edge;
    }
  }
  if (memorySnapshot && isFresh(memorySnapshot, nowMs)) {
    return {
      snapshot: memorySnapshot,
      source: "edge-cache",
      ageMs: snapshotAgeMs(memorySnapshot, nowMs),
    };
  }

  const stale = memorySnapshot;
  if (stale && options.waitUntil) {
    options.waitUntil(startSingleFlightRefresh(deps));
    return {
      snapshot: stale,
      source: "stale",
      ageMs: snapshotAgeMs(stale, nowMs),
    };
  }

  const refreshed = await startSingleFlightRefresh(deps);
  if (refreshed) {
    return {
      snapshot: refreshed,
      source: "refresh",
      ageMs: snapshotAgeMs(refreshed, now()),
    };
  }
  if (stale) {
    logger.warn("events.league_counts.serving_stale_snapshot", {
      ageMs: snapshotAgeMs(stale, nowMs),
    });
    return {
      snapshot: stale,
      source: "stale",
      ageMs: snapshotAgeMs(stale, nowMs),
    };
  }
  return { snapshot: null, source: "refresh", ageMs: null };
}
