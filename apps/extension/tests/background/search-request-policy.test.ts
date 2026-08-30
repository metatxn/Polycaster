import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createSearchRequestScheduler,
  isCapacityManagedExtensionRequest,
  isSearchCacheEntryUsable,
  runSearchWithRetry,
  SearchQueueCapacityError,
  SearchQueueDeadlineError,
  shouldCacheSearchResult,
} from "../../src/search-request-policy";

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("search scheduler bounds pending work and keeps the newest requests", async () => {
  const scheduler = createSearchRequestScheduler({
    maximumPending: 2,
    maximumQueueWaitMs: 1_000,
    minimumStartIntervalMs: 0,
  });
  const blocker = createDeferred<string>();
  const order: string[] = [];

  const running = scheduler.enqueue(async () => {
    order.push("running");
    return blocker.promise;
  });
  const dropped = scheduler.enqueue(async () => {
    order.push("dropped");
    return "dropped";
  });
  const droppedRejection = assert.rejects(dropped, SearchQueueCapacityError);
  const retained = scheduler.enqueue(async () => {
    order.push("retained");
    return "retained";
  });
  const newest = scheduler.enqueue(async () => {
    order.push("newest");
    return "newest";
  });

  assert.deepEqual(scheduler.snapshot(), { pending: 2, running: true });
  await droppedRejection;
  blocker.resolve("running");

  assert.equal(await running, "running");
  assert.equal(await retained, "retained");
  assert.equal(await newest, "newest");
  assert.deepEqual(order, ["running", "retained", "newest"]);
});

test("search scheduler expires queued work before it starts", async () => {
  let now = 0;
  const scheduler = createSearchRequestScheduler({
    maximumPending: 2,
    maximumQueueWaitMs: 100,
    minimumStartIntervalMs: 0,
    now: () => now,
  });
  const blocker = createDeferred<void>();
  let staleStarted = false;

  const running = scheduler.enqueue(async () => blocker.promise);
  const stale = scheduler.enqueue(async () => {
    staleStarted = true;
  });
  const staleRejection = assert.rejects(stale, SearchQueueDeadlineError);

  now = 101;
  blocker.resolve();
  await running;
  await staleRejection;
  assert.equal(staleStarted, false);
});

test("search retry policy honors retry delay within one deadline", async () => {
  let now = 0;
  const waits: number[] = [];
  const timeouts: number[] = [];
  let attempts = 0;

  const result = await runSearchWithRetry(
    async ({ timeoutMs }) => {
      attempts++;
      timeouts.push(timeoutMs);
      return attempts === 1
        ? { ok: false, status: 503, retryAfterMs: 400 }
        : { ok: true, status: 200, data: ["market"] };
    },
    {
      maximumAttempts: 2,
      maximumElapsedMs: 1_000,
      now: () => now,
      wait: async (delayMs) => {
        waits.push(delayMs);
        now += delayMs;
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [400]);
  assert.deepEqual(timeouts, [1_000, 600]);
});

test("search retry policy retries an explicit network failure", async () => {
  let attempts = 0;

  const result = await runSearchWithRetry(
    async () => {
      attempts++;
      return attempts === 1
        ? { ok: false, retryable: true }
        : { ok: true, status: 200 };
    },
    {
      baseDelayMs: 0,
      maximumAttempts: 2,
      maximumElapsedMs: 1_000,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
});

test("stale cache policy rejects entries beyond the maximum stale age", () => {
  const now = 10_000;
  const entry = { cachedAt: 9_500, expiresAt: 9_900 };

  assert.equal(
    isSearchCacheEntryUsable(entry, {
      maximumStaleAgeMs: 600,
      now,
      requireFresh: false,
    }),
    true
  );
  assert.equal(
    isSearchCacheEntryUsable(entry, {
      maximumStaleAgeMs: 499,
      now,
      requireFresh: false,
    }),
    false
  );
  assert.equal(
    isSearchCacheEntryUsable(entry, {
      maximumStaleAgeMs: 600,
      now,
      requireFresh: true,
    }),
    false
  );
});

test("search result cache accepts authoritative responses but rejects failures and degradation", () => {
  assert.equal(
    shouldCacheSearchResult({ failed: false, degraded: false }),
    true
  );
  assert.equal(
    shouldCacheSearchResult({ failed: false, degraded: true }),
    false
  );
  assert.equal(
    shouldCacheSearchResult({ failed: true, degraded: false }),
    false
  );
});

test("capacity policy includes search and direct market detail requests", () => {
  const isKnowwApiUrl = (url) => new URL(url).origin === "https://knoww.app";
  const managedPaths = [
    "/api/search?q=tesla&source=extension",
    "/api/events/tesla-earnings?fresh=1&source=extension",
    "/api/markets/slug/tesla-above-500?source=extension",
  ];

  for (const path of managedPaths) {
    assert.equal(
      isCapacityManagedExtensionRequest(
        { method: "GET", url: `https://knoww.app${path}` },
        isKnowwApiUrl
      ),
      true
    );
  }
  assert.equal(
    isCapacityManagedExtensionRequest(
      {
        method: "GET",
        url: "https://knoww.app/api/events/tesla-earnings?fresh=1",
      },
      isKnowwApiUrl
    ),
    false
  );
  assert.equal(
    isCapacityManagedExtensionRequest(
      {
        method: "GET",
        url: "https://example.com/api/search?source=extension",
      },
      isKnowwApiUrl
    ),
    false
  );
});
