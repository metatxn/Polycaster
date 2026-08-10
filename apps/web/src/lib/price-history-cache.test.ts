import { fetchClobPriceHistory } from "@knoww/shared-types/clob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@knoww/logger", () => ({
  createLogger: () => ({
    warn: vi.fn(),
  }),
}));

vi.mock("@knoww/shared-types/clob", () => ({
  fetchClobPriceHistory: vi.fn(),
}));

import { fetchCachedClobPriceHistory } from "./price-history-cache";

const cacheMatch = vi.fn();
const cachePut = vi.fn();

beforeEach(() => {
  cacheMatch.mockReset().mockResolvedValue(undefined);
  cachePut.mockReset().mockResolvedValue(undefined);
  vi.mocked(fetchClobPriceHistory).mockReset();
  vi.stubGlobal("caches", {
    open: vi.fn().mockResolvedValue({
      match: cacheMatch,
      put: cachePut,
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchCachedClobPriceHistory", () => {
  it("does not read the regional cache for an already-aborted caller", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Request aborted", "AbortError"));

    await expect(
      fetchCachedClobPriceHistory(
        "10000000005",
        { startTs: 500, fidelity: 1 },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(cacheMatch).not.toHaveBeenCalled();
    expect(fetchClobPriceHistory).not.toHaveBeenCalled();
  });

  it("does not return a cache hit after its caller aborts", async () => {
    const controller = new AbortController();
    cacheMatch.mockImplementationOnce(async () => {
      controller.abort(new DOMException("Request aborted", "AbortError"));
      return new Response(JSON.stringify({ history: [{ t: 600, p: 0.57 }] }));
    });

    await expect(
      fetchCachedClobPriceHistory(
        "10000000006",
        { startTs: 600, fidelity: 1 },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchClobPriceHistory).not.toHaveBeenCalled();
  });

  it("uses the regional cache instead of the Next data cache", async () => {
    vi.mocked(fetchClobPriceHistory).mockResolvedValue({
      history: [{ t: 100, p: 0.42 }],
    });

    const result = await fetchCachedClobPriceHistory("10000000001", {
      startTs: 100,
      fidelity: 60,
    });
    const [, , options] = vi.mocked(fetchClobPriceHistory).mock.calls[0];

    expect(result).toEqual({ history: [{ t: 100, p: 0.42 }] });
    expect(options?.requestInit).toEqual(
      expect.objectContaining({ cache: "no-store" })
    );
    expect(options?.requestInit?.next).toBeUndefined();
    expect(cachePut).toHaveBeenCalledTimes(1);
  });

  it("returns a regional cache hit without calling the upstream API", async () => {
    cacheMatch.mockResolvedValue(
      new Response(JSON.stringify({ history: [{ t: 200, p: 0.61 }] }))
    );

    const result = await fetchCachedClobPriceHistory("10000000002", {
      startTs: 200,
      fidelity: 30,
    });

    expect(result).toEqual({ history: [{ t: 200, p: 0.61 }] });
    expect(fetchClobPriceHistory).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it("coalesces concurrent cache misses for the same history key", async () => {
    let resolveUpstream: ((value: { history: never[] }) => void) | undefined;
    vi.mocked(fetchClobPriceHistory).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpstream = resolve;
        })
    );

    const first = fetchCachedClobPriceHistory("10000000003", {
      startTs: 300,
      fidelity: 5,
    });
    const second = fetchCachedClobPriceHistory("10000000003", {
      startTs: 300,
      fidelity: 5,
    });

    await vi.waitFor(() => {
      expect(fetchClobPriceHistory).toHaveBeenCalledTimes(1);
    });
    resolveUpstream?.({ history: [] });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { history: [] },
      { history: [] },
    ]);
    expect(cachePut).toHaveBeenCalledTimes(1);
  });

  it("returns fresh data when the regional cache write fails", async () => {
    cachePut.mockRejectedValue(new Error("cache unavailable"));
    vi.mocked(fetchClobPriceHistory).mockResolvedValue({
      history: [{ t: 400, p: 0.5 }],
    });

    await expect(
      fetchCachedClobPriceHistory("10000000004", {
        startTs: 400,
        fidelity: 1,
      })
    ).resolves.toEqual({ history: [{ t: 400, p: 0.5 }] });
  });
});
