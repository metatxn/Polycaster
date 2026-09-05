import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = (enabled = true) => ({
  onChanged: { addListener: vi.fn() },
  sync: {
    get: vi.fn((_keys, callback) =>
      callback({ knowwSettings: { usageAnalyticsEnabled: enabled } })
    ),
  },
});

beforeEach(() => vi.resetModules());

afterEach(() => vi.unstubAllGlobals());
describe("outbound attribution", () => {
  it("marks a Knoww handoff without putting wallet identity in the URL", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal("chrome", { runtime: { sendMessage }, storage: storage() });
    vi.stubGlobal("window", { open });
    vi.stubGlobal("crypto", {
      randomUUID: () => "12345678-1234-4123-8123-123456789abc",
    });
    const { openTrackedDestination } = await import(
      "../../src/outbound-analytics"
    );
    openTrackedDestination(
      "https://knoww.app/events/detail/test?side=BUY",
      "_blank",
      "noopener,noreferrer"
    );
    expect(open).toHaveBeenCalledWith(
      "https://knoww.app/events/detail/test?side=BUY&utm_source=knoww_extension&handoff_id=12345678-1234-4123-8123-123456789abc",
      "_blank",
      "noopener,noreferrer"
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "extension_web_handoff_opened",
        properties: {
          destination_host: "knoww.app",
          navigation_stage: "requested",
          handoff_id: "12345678-1234-4123-8123-123456789abc",
        },
      })
    );
  });
  it("records only Polymarket destinations, not lookalike hosts", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { runtime: { sendMessage }, storage: storage() });
    vi.stubGlobal("window", { open: vi.fn() });
    const { openTrackedDestination } = await import(
      "../../src/outbound-analytics"
    );
    openTrackedDestination("https://polymarket.com/event/test");
    openTrackedDestination("https://polymarket.com.example.org/event/test");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0].event).toBe(
      "polymarket_opened_via_knoww"
    );
  });
  it("does not block navigation when telemetry fails", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    vi.stubGlobal("chrome", {
      storage: storage(),
      runtime: {
        sendMessage: () => {
          throw new Error("offline");
        },
      },
    });
    const { openTrackedDestination } = await import(
      "../../src/outbound-analytics"
    );
    expect(() =>
      openTrackedDestination("https://polymarket.com")
    ).not.toThrow();
    expect(open).toHaveBeenCalledOnce();
  });

  it("leaves URLs undecorated and sends nothing when analytics is disabled", async () => {
    const sendMessage = vi.fn();
    const open = vi.fn();
    const randomUUID = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
      storage: storage(false),
    });
    vi.stubGlobal("window", { open });
    vi.stubGlobal("crypto", { randomUUID });
    const { openTrackedDestination } = await import(
      "../../src/outbound-analytics"
    );
    openTrackedDestination("https://knoww.app/markets", "_blank");
    expect(open).toHaveBeenCalledWith(
      "https://knoww.app/markets",
      "_blank",
      undefined
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it("honors opt-out changes before the next click", async () => {
    const sendMessage = vi.fn();
    const settings = storage();
    vi.stubGlobal("chrome", { runtime: { sendMessage }, storage: settings });
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const { openTrackedDestination } = await import(
      "../../src/outbound-analytics"
    );
    settings.onChanged.addListener.mock.calls[0][0](
      { knowwSettings: { newValue: { usageAnalyticsEnabled: false } } },
      "sync"
    );
    openTrackedDestination("https://knoww.app/markets");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      "https://knoww.app/markets",
      undefined,
      undefined
    );
  });

  it("fails closed before preferences load and does not overwrite a newer opt-out", async () => {
    let loaded: (result: unknown) => void = () => {};
    const settings = {
      onChanged: { addListener: vi.fn() },
      sync: {
        get: vi.fn((_keys, callback) => {
          loaded = callback;
        }),
      },
    };
    const sendMessage = vi.fn();
    const open = vi.fn();
    vi.stubGlobal("chrome", { runtime: { sendMessage }, storage: settings });
    vi.stubGlobal("window", { open });
    const { openTrackedDestination } = await import(
      "../../src/outbound-analytics"
    );
    openTrackedDestination("https://knoww.app/markets");
    expect(sendMessage).not.toHaveBeenCalled();
    settings.onChanged.addListener.mock.calls[0][0](
      { knowwSettings: { newValue: { usageAnalyticsEnabled: false } } },
      "sync"
    );
    loaded({ knowwSettings: { usageAnalyticsEnabled: true } });
    openTrackedDestination("https://knoww.app/markets");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith(
      "https://knoww.app/markets",
      undefined,
      undefined
    );
  });
});
