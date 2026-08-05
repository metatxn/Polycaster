/**
 * Client-side resolver for `/api/markets/closed-time`.
 *
 * The API caps each request at 50 condition ids — chunk (ids + their
 * aligned slugs together) so accounts with many lost positions still
 * resolve every row instead of silently losing everything past 50.
 * A chunk whose lookup failed upstream (`partial: true` or a transport
 * error) is retried with backoff; resolved values are delivered
 * incrementally via `onResolved` so a retry never wipes what earlier
 * chunks already answered.
 */

const DEFAULT_CHUNK_SIZE = 50;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 15_000;

interface ClosedTimePayload {
  closedTimes?: Record<string, string>;
  partial?: boolean;
  truncated?: boolean;
}

export interface ResolveClosedTimesOptions {
  chunkSize?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Resolves closedTime timestamps for the given condition ids, invoking
 * `onResolved` with each batch of newly resolved `{conditionId: isoTime}`
 * entries (possibly multiple times as retries fill in gaps).
 *
 * Returns a cancel function: after it runs, `onResolved` is never invoked
 * again and any pending retry timer is cleared.
 */
export function resolveClosedTimes(
  conditionIds: readonly string[],
  eventSlugsByConditionId: ReadonlyMap<string, string>,
  onResolved: (resolved: Record<string, string>) => void,
  options: ResolveClosedTimesOptions = {}
): () => void {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryBaseDelayMs =
    options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const fetchClosedTimes = (ids: readonly string[], attempt: number) => {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize));
    }

    Promise.all(
      chunks.map(async (chunkIds) => {
        const params = new URLSearchParams({ ids: chunkIds.join(",") });
        const chunkSlugs = chunkIds.map(
          (id) => eventSlugsByConditionId.get(id) ?? ""
        );
        if (chunkSlugs.some(Boolean)) {
          params.set("slugs", chunkSlugs.join(","));
        }
        const payload = await fetchImpl(
          `/api/markets/closed-time?${params.toString()}`
        )
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);
        return { chunkIds, payload: payload as ClosedTimePayload | null };
      })
    ).then((results) => {
      if (cancelled) return;

      const resolved: Record<string, string> = {};
      const retryIds: string[] = [];
      for (const { chunkIds, payload } of results) {
        if (!payload?.closedTimes) {
          // Transport / HTTP failure — retry the whole chunk.
          retryIds.push(...chunkIds);
          continue;
        }
        Object.assign(resolved, payload.closedTimes);
        if (payload.partial || payload.truncated) {
          // Upstream outage may have hidden some ids — retry only the
          // ones this chunk left unresolved.
          retryIds.push(...chunkIds.filter((id) => !payload.closedTimes?.[id]));
        }
      }

      if (Object.keys(resolved).length > 0) {
        onResolved(resolved);
      }

      if (retryIds.length > 0 && attempt < maxAttempts) {
        retryTimer = setTimeout(
          () => fetchClosedTimes(retryIds, attempt + 1),
          retryBaseDelayMs * attempt
        );
      }
    });
  };

  fetchClosedTimes(conditionIds, 1);

  return () => {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
  };
}
