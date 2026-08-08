import { afterEach, describe, expect, it, vi } from "vitest";
import { getLegacyMarketEventSlug } from "./legacy-market";

describe("getLegacyMarketEventSlug", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a closed legacy market to its canonical parent event", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "527079",
        slug: "will-gta-6-cost-100",
        closed: true,
        events: [
          {
            id: "20461",
            slug: "will-gta-6-cost-100",
          },
        ],
      }),
    } satisfies Partial<Response>);
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLegacyMarketEventSlug("will-gta-6-cost-100")).resolves.toBe(
      "will-gta-6-cost-100"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gamma-api.polymarket.com/markets/slug/will-gta-6-cost-100",
      expect.objectContaining({ next: { revalidate: 3600 } })
    );
  });

  it("returns null when the legacy market genuinely does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } satisfies Partial<Response>)
    );

    await expect(
      getLegacyMarketEventSlug("missing-market")
    ).resolves.toBeNull();
  });

  it("returns null when Gamma cannot provide a canonical parent event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: "orphan-market",
          slug: "orphan-market",
          events: [],
        }),
      } satisfies Partial<Response>)
    );

    await expect(getLegacyMarketEventSlug("orphan-market")).resolves.toBeNull();
  });

  it("throws on a transient Gamma failure so crawlers can retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      } satisfies Partial<Response>)
    );

    await expect(
      getLegacyMarketEventSlug("temporarily-unavailable-market")
    ).rejects.toThrow(/503/);
  });
});
