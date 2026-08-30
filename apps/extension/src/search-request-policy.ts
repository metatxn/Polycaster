const DEFAULT_RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

type Wait = (delayMs: number) => Promise<void>;

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class SearchQueueCapacityError extends Error {
  readonly queueWaitMs: number;

  constructor(queueWaitMs = 0) {
    super("Pending search work was dropped to keep the queue bounded");
    this.name = "SearchQueueCapacityError";
    this.queueWaitMs = queueWaitMs;
  }
}

export class SearchQueueDeadlineError extends Error {
  readonly queueWaitMs: number;

  constructor(queueWaitMs = 0) {
    super("Pending search work expired before it could start");
    this.name = "SearchQueueDeadlineError";
    this.queueWaitMs = queueWaitMs;
  }
}

interface PendingSearchWork {
  queuedAt: number;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export function createSearchRequestScheduler(
  options: {
    maximumPending?: number;
    maximumQueueWaitMs?: number;
    minimumStartIntervalMs?: number;
    now?: () => number;
    wait?: Wait;
  } = {}
) {
  const maximumPending = options.maximumPending ?? 8;
  const maximumQueueWaitMs = options.maximumQueueWaitMs ?? 5_000;
  const minimumStartIntervalMs = options.minimumStartIntervalMs ?? 300;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? defaultWait;

  if (!Number.isInteger(maximumPending) || maximumPending < 1) {
    throw new RangeError("maximumPending must be a positive integer");
  }
  if (!Number.isFinite(maximumQueueWaitMs) || maximumQueueWaitMs < 0) {
    throw new RangeError("maximumQueueWaitMs must be non-negative");
  }
  if (!Number.isFinite(minimumStartIntervalMs) || minimumStartIntervalMs < 0) {
    throw new RangeError("minimumStartIntervalMs must be non-negative");
  }

  let running = false;
  let lastStartedAt: number | null = null;
  const pending: PendingSearchWork[] = [];

  const startNext = (): void => {
    if (running) return;
    const next = pending.shift();
    if (!next) return;

    running = true;
    void (async () => {
      try {
        let queueWaitMs = now() - next.queuedAt;
        if (queueWaitMs > maximumQueueWaitMs) {
          throw new SearchQueueDeadlineError(queueWaitMs);
        }

        const startDelayMs =
          lastStartedAt === null
            ? 0
            : Math.max(0, minimumStartIntervalMs - (now() - lastStartedAt));
        if (startDelayMs > 0) await wait(startDelayMs);

        queueWaitMs = now() - next.queuedAt;
        if (queueWaitMs > maximumQueueWaitMs) {
          throw new SearchQueueDeadlineError(queueWaitMs);
        }

        lastStartedAt = now();
        next.resolve(await next.run());
      } catch (error) {
        next.reject(error);
      } finally {
        running = false;
        startNext();
      }
    })();
  };

  return {
    enqueue<T>(run: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (pending.length >= maximumPending) {
          const oldest = pending.shift();
          if (oldest) {
            oldest.reject(
              new SearchQueueCapacityError(now() - oldest.queuedAt)
            );
          }
        }

        pending.push({
          queuedAt: now(),
          run,
          resolve: (value) => resolve(value as T),
          reject,
        });
        startNext();
      });
    },

    snapshot(): { pending: number; running: boolean } {
      return { pending: pending.length, running };
    },
  };
}

interface SearchAttemptResult {
  ok: boolean;
  retryAfterMs?: number;
  retryable?: boolean;
  status?: number;
}

export async function runSearchWithRetry<T extends SearchAttemptResult>(
  runAttempt: (context: { attempt: number; timeoutMs: number }) => Promise<T>,
  options: {
    maximumAttempts?: number;
    maximumElapsedMs?: number;
    baseDelayMs?: number;
    now?: () => number;
    wait?: Wait;
    retryableStatuses?: ReadonlySet<number>;
  } = {}
): Promise<T> {
  const maximumAttempts = options.maximumAttempts ?? 2;
  const maximumElapsedMs = options.maximumElapsedMs ?? 5_000;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? defaultWait;
  const retryableStatuses =
    options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;
  const startedAt = now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
    const remainingMs = maximumElapsedMs - (now() - startedAt);
    if (remainingMs <= 0) break;

    try {
      const result = await runAttempt({
        attempt,
        timeoutMs: Math.max(1, remainingMs),
      });
      const retryable =
        result.retryable === true ||
        (typeof result.status === "number" &&
          retryableStatuses.has(result.status));
      if (!retryable || attempt === maximumAttempts) return result;

      const delayMs =
        typeof result.retryAfterMs === "number" &&
        Number.isFinite(result.retryAfterMs)
          ? Math.max(0, result.retryAfterMs)
          : baseDelayMs * 2 ** (attempt - 1);
      if (delayMs >= maximumElapsedMs - (now() - startedAt)) return result;
      if (delayMs > 0) await wait(delayMs);
    } catch (error) {
      lastError = error;
      if (attempt === maximumAttempts) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      if (delayMs >= maximumElapsedMs - (now() - startedAt)) throw error;
      if (delayMs > 0) await wait(delayMs);
    }
  }

  if (lastError) throw lastError;
  throw new Error(
    "Search request deadline exhausted before an attempt started"
  );
}

export function isSearchCacheEntryUsable(
  entry: { cachedAt: number; expiresAt: number },
  options: {
    maximumStaleAgeMs: number;
    now?: number;
    requireFresh: boolean;
  }
): boolean {
  const now = options.now ?? Date.now();
  if (options.requireFresh) return entry.expiresAt > now;
  return now - entry.cachedAt <= options.maximumStaleAgeMs;
}

export function shouldCacheSearchResult(input: {
  failed: boolean;
  degraded: boolean;
}): boolean {
  return !input.failed && !input.degraded;
}

export function isCapacityManagedExtensionRequest(
  request: { method?: string; url: string },
  isKnowwApiUrl: (url: string) => boolean
): boolean {
  if ((request.method || "POST").toUpperCase() !== "GET") return false;
  if (!isKnowwApiUrl(request.url)) return false;

  try {
    const url = new URL(request.url);
    if (url.searchParams.get("source") !== "extension") return false;
    return (
      url.pathname === "/api/search" ||
      /^\/api\/events\/[^/]+$/.test(url.pathname) ||
      /^\/api\/markets\/slug\/[^/]+$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
