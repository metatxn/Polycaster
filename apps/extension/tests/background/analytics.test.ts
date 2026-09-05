import { beforeEach, describe, expect, it, vi } from "vitest";

describe("explicit unsupported-site requests", () => {
  const storage = new Map<string, unknown>();
  let storedSettings: Record<string, unknown> | undefined;

  beforeEach(() => {
    storage.clear();
    storedSettings = undefined;
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal("__DEV_MODE__", false);
    let uuid = 0;
    vi.stubGlobal("crypto", {
      randomUUID: () =>
        `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    });
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get(key: string, callback: (value: Record<string, unknown>) => void) {
            callback({ [key]: storage.get(key) });
          },
          set(value: Record<string, unknown>, callback: () => void) {
            for (const [key, entry] of Object.entries(value)) {
              storage.set(key, entry);
            }
            callback();
          },
        },
        sync: {
          get(
            _defaults: Record<string, unknown>,
            callback: (value: Record<string, unknown>) => void
          ) {
            callback(storedSettings ? { knowwSettings: storedSettings } : {});
          },
        },
      },
      runtime: { lastError: undefined },
    });
  });

  it("posts only the normalized hostname even when usage analytics is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { submitSiteSupportRequest } = await import(
      "../../src/background/analytics"
    );

    await expect(submitSiteSupportRequest("example.com")).resolves.toBe(true);
    await expect(submitSiteSupportRequest("example.com")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://knoww.app/api/analytics/batch");
    expect(JSON.parse(String(init.body))).toMatchObject({
      events: [
        {
          event: "unsupported_site_requested",
          distinctId: "00000000-0000-4000-8000-000000000001",
          properties: { hostname: "example.com" },
        },
      ],
    });
    expect(String(init.body)).not.toContain("url");
  });

  it("rejects invalid hostnames before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { submitSiteSupportRequest } = await import(
      "../../src/background/analytics"
    );

    await expect(submitSiteSupportRequest("localhost")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("joins anonymous events to the connected wallet and rotates identity after logout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const { queueAnalyticsEvent } = await import(
      "../../src/background/analytics"
    );
    const wallet = "0x0000000000000000000000000000000000000001";
    await queueAnalyticsEvent({ event: "extension_installed" });
    await queueAnalyticsEvent({
      event: "wallet_connected",
      properties: { wallet_address: wallet },
    });
    await queueAnalyticsEvent({ event: "market_card_clicked" });
    await queueAnalyticsEvent({ event: "wallet_disconnected" });
    await queueAnalyticsEvent({ event: "market_card_clicked" });
    const events = storage.get("knoww_analytics_queue_v1") as Array<{
      event: string;
      distinctId: string;
      properties: Record<string, unknown>;
    }>;
    expect(events[1]).toMatchObject({
      event: "$identify",
      distinctId: wallet,
      properties: { $anon_distinct_id: events[0].distinctId },
    });
    expect(events[3]).toMatchObject({
      event: "market_card_clicked",
      distinctId: wallet,
      properties: {
        wallet_address: wallet,
        product: "extension",
        analytics_version: 2,
      },
    });
    expect(events[5].distinctId).not.toBe(wallet);
    expect(events[5].distinctId).not.toBe(events[0].distinctId);
    expect(events[5].properties.wallet_address).toBeUndefined();
  });

  it("does not merge two wallets when switching accounts", async () => {
    const { queueAnalyticsEvent } = await import(
      "../../src/background/analytics"
    );
    const first = "0x0000000000000000000000000000000000000001";
    const second = "0x0000000000000000000000000000000000000002";
    await queueAnalyticsEvent({
      event: "wallet_connected",
      properties: { wallet_address: first },
    });
    await queueAnalyticsEvent({
      event: "wallet_switched",
      properties: { wallet_address: second },
    });
    const queue = storage.get("knoww_analytics_queue_v1") as Array<{
      event: string;
      distinctId: string;
      properties: Record<string, unknown>;
    }>;
    const identifies = queue.filter((event) => event.event === "$identify");
    expect(identifies).toHaveLength(2);
    expect(identifies[1].properties.$anon_distinct_id).not.toBe(first);
    expect(identifies[1].properties.$anon_distinct_id).not.toBe(
      identifies[0].properties.$anon_distinct_id
    );
    expect(queue.at(-1)?.distinctId).toBe(second);
  });

  it("uses the on-by-default analytics setting while preserving an explicit opt-out", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { queueAnalyticsEvent } = await import(
      "../../src/background/analytics"
    );

    await queueAnalyticsEvent({ event: "default_enabled" });
    expect(storage.get("knoww_analytics_queue_v1")).toEqual([
      expect.objectContaining({ event: "default_enabled" }),
    ]);

    storage.delete("knoww_analytics_queue_v1");
    storedSettings = { usageAnalyticsEnabled: false };
    await queueAnalyticsEvent({ event: "explicitly_disabled" });
    expect(storage.has("knoww_analytics_queue_v1")).toBe(false);
  });
});
