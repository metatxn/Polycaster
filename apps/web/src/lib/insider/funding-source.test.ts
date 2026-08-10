import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getWalletFunding", () => {
  it("propagates request timeouts instead of caching an unknown result", async () => {
    vi.stubEnv("ALCHEMY_API_KEY", "test-only-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Request timed out", "TimeoutError");
      })
    );
    const { getWalletFunding } = await import("./funding-source");

    await expect(
      getWalletFunding(
        "0x0000000000000000000000000000000000000001",
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("degrades one batch item on a per-call timeout without caching it", async () => {
    vi.stubEnv("ALCHEMY_API_KEY", "test-only-key");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException("Request timed out", "TimeoutError")
      )
      .mockResolvedValueOnce(
        Response.json({
          result: {
            transfers: [
              {
                from: "0x0000000000000000000000000000000000000002",
                value: 1,
                metadata: { blockTimestamp: "2026-08-10T00:00:00.000Z" },
              },
            ],
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getWalletFundingBatch } = await import("./funding-source");
    const address = "0x0000000000000000000000000000000000000001";

    const first = await getWalletFundingBatch(
      [address],
      1,
      new AbortController().signal
    );
    const second = await getWalletFundingBatch(
      [address],
      1,
      new AbortController().signal
    );

    expect(first.get(address)).toMatchObject({
      firstFunderAddress: null,
      firstFunderCategory: "unknown",
    });
    expect(second.get(address)).toMatchObject({
      firstFunderAddress: "0x0000000000000000000000000000000000000002",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
