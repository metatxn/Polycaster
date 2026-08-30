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
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
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
