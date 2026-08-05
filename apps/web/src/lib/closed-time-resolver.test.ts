import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveClosedTimes } from "./closed-time-resolver";

type FetchImpl = typeof fetch;

function jsonResponse(body: unknown): Response {
  return Response.json(body);
}

/** Extracts `ids` / `slugs` query params from a fetch mock call. */
function requestParams(input: RequestInfo | URL): {
  ids: string[];
  slugs: string[] | null;
} {
  const url = new URL(input.toString(), "https://knoww.app");
  const ids = url.searchParams.get("ids")?.split(",") ?? [];
  const slugs = url.searchParams.get("slugs")?.split(",") ?? null;
  return { ids, slugs };
}

/**
 * Drains queued microtasks until `predicate` holds, or the budget runs out.
 *
 * The resolver's `fetch` → `res.json()` → `Promise.all` chain is several promise
 * hops deep, and the exact depth is an implementation detail of undici's
 * Response body reader — 8 hops on Node 24, 12 on Node 23. Poll for the
 * condition rather than draining a fixed number of ticks, so these tests do not
 * silently break on a Node upgrade.
 */
async function flushUntil(predicate: () => boolean, maxTicks = 100) {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
}

/** Drains every queued microtask — for asserting that nothing further happens. */
async function flushMicrotasks() {
  await flushUntil(() => false);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resolveClosedTimes", () => {
  it("chunks ids at the chunk size with index-aligned slugs", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `0xid${i}`);
    const slugs = new Map(ids.map((id) => [id, `slug-${id}`]));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ success: true, closedTimes: {} })
    );

    resolveClosedTimes(ids, slugs, () => {}, {
      fetchImpl: fetchMock as unknown as FetchImpl,
    });
    await flushUntil(() => fetchMock.mock.calls.length === 3);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map(
      ([input]) => requestParams(input).ids.length
    );
    expect(sizes).toEqual([50, 50, 20]);

    // Slugs stay index-aligned with their chunk's ids.
    for (const [input] of fetchMock.mock.calls) {
      const { ids: chunkIds, slugs: chunkSlugs } = requestParams(input);
      expect(chunkSlugs).toEqual(chunkIds.map((id) => `slug-${id}`));
    }
  });

  it("merges resolved values across chunks into a single callback batch", async () => {
    const ids = ["0xa", "0xb", "0xc"];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const { ids: chunkIds } = requestParams(input);
      const closedTimes = Object.fromEntries(
        chunkIds.map((id) => [id, `${id}-time`])
      );
      return jsonResponse({ success: true, closedTimes });
    });
    const onResolved = vi.fn();

    resolveClosedTimes(ids, new Map(), onResolved, {
      chunkSize: 2,
      fetchImpl: fetchMock as unknown as FetchImpl,
    });
    await flushUntil(() => onResolved.mock.calls.length > 0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith({
      "0xa": "0xa-time",
      "0xb": "0xb-time",
      "0xc": "0xc-time",
    });
  });

  it("retries a whole chunk on transport failure with linear backoff", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(
        jsonResponse({ success: true, closedTimes: { "0xa": "t" } })
      );
    const onResolved = vi.fn();

    resolveClosedTimes(["0xa"], new Map(), onResolved, {
      retryBaseDelayMs: 15_000,
      fetchImpl: fetchMock as unknown as FetchImpl,
    });
    await flushUntil(() => vi.getTimerCount() > 0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onResolved).not.toHaveBeenCalled();

    // First retry fires at base delay × attempt 1 = 15s, not before.
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushUntil(() => onResolved.mock.calls.length > 0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onResolved).toHaveBeenCalledWith({ "0xa": "t" });
  });

  it("retries whole chunks on non-ok HTTP responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(
        jsonResponse({ success: true, closedTimes: { "0xa": "t" } })
      );
    const onResolved = vi.fn();

    resolveClosedTimes(["0xa"], new Map(), onResolved, {
      fetchImpl: fetchMock as unknown as FetchImpl,
    });
    await flushUntil(() => vi.getTimerCount() > 0);
    await vi.advanceTimersByTimeAsync(15_000);
    await flushUntil(() => onResolved.mock.calls.length > 0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onResolved).toHaveBeenCalledWith({ "0xa": "t" });
  });

  it("retries only unresolved ids when a chunk is partial, preserving resolved values", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          closedTimes: { "0xa": "a-time" },
          partial: true,
        })
      )
      .mockResolvedValue(
        jsonResponse({ success: true, closedTimes: { "0xb": "b-time" } })
      );
    const onResolved = vi.fn();

    resolveClosedTimes(["0xa", "0xb"], new Map(), onResolved, {
      fetchImpl: fetchMock as unknown as FetchImpl,
    });
    await flushUntil(() => onResolved.mock.calls.length > 0);

    // First pass delivered what it could.
    expect(onResolved).toHaveBeenNthCalledWith(1, { "0xa": "a-time" });

    await vi.advanceTimersByTimeAsync(15_000);
    await flushUntil(() => onResolved.mock.calls.length > 1);

    // Retry asked only for the unresolved id.
    const retryIds = requestParams(
      fetchMock.mock.calls[1][0] as RequestInfo
    ).ids;
    expect(retryIds).toEqual(["0xb"]);
    expect(onResolved).toHaveBeenNthCalledWith(2, { "0xb": "b-time" });
  });

  it("does not retry when the response is complete", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, closedTimes: { "0xa": "t" } })
    );

    resolveClosedTimes(["0xa"], new Map(), () => {}, {
      fetchImpl: fetchMock as unknown as FetchImpl,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(120_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a genuinely missing closedTime as final — empty non-partial body never retries", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, closedTimes: {} })
    );
    const onResolved = vi.fn();

    resolveClosedTimes(["0xa"], new Map(), onResolved, {
      fetchImpl: fetchMock as unknown as FetchImpl,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(120_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("stops after the attempt cap even while chunks keep failing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("still down"));

    resolveClosedTimes(["0xa"], new Map(), () => {}, {
      retryBaseDelayMs: 15_000,
      maxAttempts: 3,
      fetchImpl: fetchMock as unknown as FetchImpl,
    });
    await flushUntil(() => vi.getTimerCount() > 0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Attempt 2 at 15s × 1, attempt 3 at a further 15s × 2.
    await vi.advanceTimersByTimeAsync(15_000);
    await flushUntil(() => vi.getTimerCount() > 0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    await flushUntil(() => fetchMock.mock.calls.length === 3);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // No fourth attempt, ever.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("cancel suppresses the callback and clears pending retry timers", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const onResolved = vi.fn();

    const cancel = resolveClosedTimes(["0xa"], new Map(), onResolved, {
      fetchImpl: fetchMock as unknown as FetchImpl,
    });

    cancel();
    resolveFetch(jsonResponse({ success: true, closedTimes: { "0xa": "t" } }));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(120_000);
    await flushMicrotasks();

    expect(onResolved).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancel after a scheduled retry prevents the retry from firing", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(jsonResponse({ success: true, closedTimes: {} }));

    const cancel = resolveClosedTimes(["0xa"], new Map(), () => {}, {
      fetchImpl: fetchMock as unknown as FetchImpl,
    });
    // Cancel only once the retry timer actually exists — that is what this
    // test claims to exercise.
    await flushUntil(() => vi.getTimerCount() > 0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    cancel();
    await vi.advanceTimersByTimeAsync(120_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
