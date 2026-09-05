import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  has_opted_out_capturing: vi.fn(() => false),
}));

vi.mock("posthog-js", () => ({
  default: posthog,
}));

describe("PostHog browser instrumentation", () => {
  beforeEach(() => {
    vi.resetModules();
    posthog.init.mockReset();
    posthog.has_opted_out_capturing.mockReturnValue(false);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "test-project-token");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("tags preview traffic and preserves the handoff captured with the accepted order", async () => {
    await import("../../instrumentation-client");
    const beforeSend = posthog.init.mock.calls[0][1].before_send;
    const event = beforeSend({
      event: "order_succeeded",
      properties: {
        distinct_id: "wallet",
        handoff_id: "original-handoff",
        entry_source: "knoww_extension",
      },
    });
    expect(event.properties).toEqual(
      expect.objectContaining({
        environment: "development",
        handoff_id: "original-handoff",
        entry_source: "knoww_extension",
      })
    );
    posthog.has_opted_out_capturing.mockReturnValue(true);
    expect(beforeSend(event).properties.handoff_id).toBeUndefined();
    expect(event.properties.entry_source).toBeUndefined();
  });

  it("marks the production host without relying on NODE_ENV alone", async () => {
    vi.stubGlobal("window", {
      location: { hostname: "knoww.app", href: "https://knoww.app/" },
      sessionStorage: {
        getItem: () => null,
        removeItem: vi.fn(),
        setItem: vi.fn(),
      },
    });
    await import("../../instrumentation-client");
    const beforeSend = posthog.init.mock.calls[0][1].before_send;
    expect(
      beforeSend({ event: "wallet_session_ready", properties: {} }).properties
        .environment
    ).toBe("production");
  });

  it("initializes the browser SDK against Knoww's managed proxy", async () => {
    await import("../../instrumentation-client");

    expect(posthog.init).toHaveBeenCalledWith(
      "test-project-token",
      expect.objectContaining({
        api_host: "https://a.knoww.app",
        ui_host: "https://us.posthog.com",
      })
    );
  });

  it("uses the proxy even with the previous US host configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com");
    await import("../../instrumentation-client");
    expect(posthog.init).toHaveBeenCalledWith(
      "test-project-token",
      expect.objectContaining({ api_host: "https://a.knoww.app" })
    );
  });

  it("does not initialize without a project token", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");

    await import("../../instrumentation-client");

    expect(posthog.init).not.toHaveBeenCalled();
  });
});
