import { beforeEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

const legacyMarketMocks = vi.hoisted(() => ({
  getLegacyMarketEventSlug: vi.fn(),
}));

vi.mock("next/navigation", () => navigationMocks);
vi.mock("@/lib/legacy-market", () => legacyMarketMocks);

import MarketDetailPage from "./page";

describe("legacy market detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("permanently redirects to the exact canonical event", async () => {
    legacyMarketMocks.getLegacyMarketEventSlug.mockResolvedValue(
      "canonical-event"
    );

    await expect(
      MarketDetailPage({
        params: Promise.resolve({ slug: "legacy-market" }),
      })
    ).rejects.toThrow("NEXT_REDIRECT:/events/detail/canonical-event");

    expect(legacyMarketMocks.getLegacyMarketEventSlug).toHaveBeenCalledWith(
      "legacy-market"
    );
    expect(navigationMocks.permanentRedirect).toHaveBeenCalledWith(
      "/events/detail/canonical-event"
    );
  });

  it("returns a real not-found result when no canonical event exists", async () => {
    legacyMarketMocks.getLegacyMarketEventSlug.mockResolvedValue(null);

    await expect(
      MarketDetailPage({
        params: Promise.resolve({ slug: "missing-market" }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(navigationMocks.notFound).toHaveBeenCalledOnce();
    expect(navigationMocks.permanentRedirect).not.toHaveBeenCalled();
  });
});
