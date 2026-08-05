import { POLYMARKET_API } from "@/constants/polymarket";

/**
 * Count-only queries against Gamma `/events/pagination`.
 *
 * One `limit=1` request returns `pagination.totalResults` for the whole
 * filter, replacing full keyset walks (100-item pages, 5–7 MB each) for
 * every "how many events" need. The endpoint is undocumented, so the
 * response shape is validated at runtime and a schema mismatch is a
 * failure, never a zero.
 *
 * `live` is deliberately typed as `true | undefined`: `live=false` is NOT
 * the complement of `live=true` upstream (verified 2026-07-29/30) and must
 * never be sent.
 */
export interface PaginationCountQuery {
  tagSlug?: string;
  seriesId?: number;
  /** ISO timestamp lower bound on event start time (schedule baselines). */
  startTimeMin?: string;
  live?: true;
}

export type PaginationCountFailureReason =
  | "timeout"
  | "http_error"
  | "schema_invalid"
  | "network_error";

export type PaginationCountResult =
  | { ok: true; total: number }
  | { ok: false; reason: PaginationCountFailureReason; status?: number };

export interface FetchGammaPaginationTotalOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const PAGINATION_COUNT_TIMEOUT_MS = 10_000;

export function buildPaginationCountParams(
  query: PaginationCountQuery
): URLSearchParams {
  const params = new URLSearchParams({
    closed: "false",
    active: "true",
    // limit=1 is the floor: limit=0 makes Gamma fall back to a full
    // default page (~2.2 MB) instead of an empty one.
    limit: "1",
  });
  if (query.seriesId !== undefined) {
    params.set("series_id", String(query.seriesId));
  } else if (query.tagSlug) {
    params.set("tag_slug", query.tagSlug);
  }
  if (query.startTimeMin) {
    params.set("start_time_min", query.startTimeMin);
  }
  if (query.live === true) {
    params.set("live", "true");
  }
  return params;
}

function parseTotalResults(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const pagination = (payload as { pagination?: unknown }).pagination;
  if (typeof pagination !== "object" || pagination === null) return null;
  const raw = (pagination as { totalResults?: unknown }).totalResults;

  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;

  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Fetch the total event count for one filter. Distinguishes a valid zero
 * (`{ ok: true, total: 0 }`) from timeout / HTTP / schema / network
 * failures so callers can carry forward a last-valid value instead of
 * reporting a failure as an empty league.
 */
export async function fetchGammaPaginationTotal(
  query: PaginationCountQuery,
  {
    timeoutMs = PAGINATION_COUNT_TIMEOUT_MS,
    fetchImpl = fetch,
  }: FetchGammaPaginationTotalOptions = {}
): Promise<PaginationCountResult> {
  const params = buildPaginationCountParams(query);

  let response: Response;
  try {
    response = await fetchImpl(
      `${POLYMARKET_API.GAMMA.EVENTS_PAGINATION}?${params.toString()}`,
      {
        headers: { Accept: "application/json" },
        // Freshness is owned by the snapshot layer; a cached count here
        // would silently extend the snapshot's advertised age.
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
  } catch (error) {
    return {
      ok: false,
      reason: isAbortError(error) ? "timeout" : "network_error",
    };
  }

  if (!response.ok) {
    return { ok: false, reason: "http_error", status: response.status };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "schema_invalid" };
  }

  const total = parseTotalResults(payload);
  if (total === null) {
    return { ok: false, reason: "schema_invalid" };
  }
  return { ok: true, total };
}
