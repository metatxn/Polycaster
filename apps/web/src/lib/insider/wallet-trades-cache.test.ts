import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("getWalletTrades", () => {
  it("does not retain full wallet histories between completed calls", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json([
        {
          type: "TRADE",
          conditionId: "condition-1",
          slug: "market-1",
          eventSlug: "event-1",
          side: "BUY",
          outcomeIndex: 0,
          price: 0.4,
          size: 25,
          timestamp: 1_700_000_000,
        },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getWalletTrades } = await import("./wallet-trades-cache");
    await getWalletTrades("0xABC");
    await getWalletTrades("0xABC");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("degrades only the timed-out wallet when its per-call deadline expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Request timed out", "TimeoutError");
      })
    );

    const { getWalletTrades } = await import("./wallet-trades-cache");

    await expect(
      getWalletTrades("0xABC", new AbortController().signal)
    ).resolves.toEqual([]);
  });

  it("still propagates an aggregate request abort", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        throw init?.signal?.reason;
      })
    );

    const { getWalletTrades } = await import("./wallet-trades-cache");

    await expect(
      getWalletTrades("0xABC", controller.signal)
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
