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
});

describe("createRequestDeadline", () => {
  it("aborts at the aggregate deadline and releases its timer", async () => {
    vi.useFakeTimers();
    const deadline = createRequestDeadline(250);

    await vi.advanceTimersByTimeAsync(250);

    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
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
