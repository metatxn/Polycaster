import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("discovery journey correlation", () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const location = {
    href: "https://x.com/example/status/1?private=value",
    hostname: "x.com",
  };
  let enabled = true;

  beforeEach(() => {
    vi.resetModules();
    send.mockClear();
    enabled = true;
    location.href = "https://x.com/example/status/1?private=value";
    vi.stubGlobal("window", {
      location,
      KNOWW_CONFIG: {
        getUserSettings: () => ({ usageAnalyticsEnabled: enabled }),
      },
      KNOWW_UTILS: { safeSendMessage: send },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shares a page-view ID on one page and rotates it on SPA navigation without sending URLs", async () => {
    const { KNOWW_ANALYTICS } = await import("../../src/content/analytics");
    await KNOWW_ANALYTICS.track("market_card_impression", {
      marketId: "market-1",
    });
    await KNOWW_ANALYTICS.track("market_card_clicked", {
      marketId: "market-1",
    });
    const first = send.mock.calls[0][0].properties;
    expect(first.page_view_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(send.mock.calls[1][0].properties.page_view_id).toBe(
      first.page_view_id
    );
    expect(first).toEqual({
      page_view_id: first.page_view_id,
      host: "x.com",
      platform: "unknown",
      marketId: "market-1",
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain("private=value");
    location.href = "https://x.com/example/status/2";
    await KNOWW_ANALYTICS.track("market_card_impression", {
      marketId: "market-1",
    });
    expect(send.mock.calls[2][0].properties.page_view_id).not.toBe(
      first.page_view_id
    );
  });

  it("does not send journey events after opt-out", async () => {
    enabled = false;
    const { KNOWW_ANALYTICS } = await import("../../src/content/analytics");
    await KNOWW_ANALYTICS.track("market_card_impression");
    expect(send).not.toHaveBeenCalled();
  });

  it("records search submission before the response and binds rendered results to that search", () => {
    const source = readFileSync("src/content/ui/notifications.ts", "utf8");
    const submitted = source.indexOf(
      'track("extension_search_query_submitted"'
    );
    const response = source.indexOf("await searchPolymarketEvents(searchQuery");
    const loaded = source.indexOf('track("extension_search_results_loaded"');
    expect(submitted).toBeGreaterThan(0);
    expect(submitted).toBeLessThan(response);
    expect(response).toBeLessThan(loaded);
    expect(source).toContain("createSearchResultItem(event, searchId)");
    expect(source).toMatch(
      /track\("extension_search_result_clicked",\s*\{\s*search_id: searchId/
    );
  });
});
