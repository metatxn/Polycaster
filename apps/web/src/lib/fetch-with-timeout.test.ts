import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRequestDeadline,
  fetchWithTimeout,
  isAbortLikeError,
  waitForAbort,
} from "./fetch-with-timeout";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout", () => {
  it("recognizes DOM timeout errors across runtime realms", () => {
    expect(
      isAbortLikeError(new DOMException("Timed out", "TimeoutError"))
    ).toBe(true);
  });

  it("aborts an upstream fetch when its timeout expires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Timed out", "AbortError")),
              { once: true }
            );
          })
      )
    );

    const request = fetchWithTimeout("https://example.com", {}, 100);
    const rejection = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
  });

  it("propagates a parent request abort to the upstream fetch", async () => {
    const parent = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Cancelled", "AbortError")),
              { once: true }
            );
          })
      )
    );

    const request = fetchWithTimeout(
      "https://example.com",
      { signal: parent.signal },
      10_000
    );
    parent.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps the deadline active while the response body is incomplete", async () => {
    vi.useFakeTimers();
    const upstream: { signal?: AbortSignal } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) upstream.signal = init.signal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"partial":'));
            upstream.signal?.addEventListener(
              "abort",
              () => controller.error(upstream.signal?.reason),
              { once: true }
            );
          },
        });
        return Promise.resolve(new Response(body));
      })
    );

    const response = await fetchWithTimeout("https://example.com", {}, 100);
    let bodyError: unknown;
    void response.text().catch((error) => {
      bodyError = error;
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(upstream.signal?.aborted).toBe(true);
    expect(bodyError).toMatchObject({ name: "TimeoutError" });
  });

  it("releases the deadline after the response body is consumed", async () => {
    vi.useFakeTimers();
    const upstream: { signal?: AbortSignal } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) upstream.signal = init.signal;
        return Promise.resolve(new Response("complete"));
      })
    );

    const response = await fetchWithTimeout("https://example.com", {}, 100);
    await expect(response.text()).resolves.toBe("complete");
    await vi.advanceTimersByTimeAsync(100);

    expect(upstream.signal?.aborted).toBe(false);
  });
});

describe("createRequestDeadline", () => {
  it("aborts at the aggregate deadline and releases its timer", async () => {
    vi.useFakeTimers();
    const deadline = createRequestDeadline(250);

    await vi.advanceTimersByTimeAsync(250);

    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
  });

  it("releases its timeout when the parent request aborts", () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const deadline = createRequestDeadline(250, parent.signal);

    parent.abort(new DOMException("Cancelled", "AbortError"));

    expect(deadline.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitForAbort", () => {
  it("stops waiting when the parent request is aborted", async () => {
    const parent = new AbortController();
    const neverSettles = new Promise<string>(() => undefined);
    const pending = waitForAbort(neverSettles, parent.signal);

    parent.abort(new DOMException("Request timed out", "TimeoutError"));

    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
