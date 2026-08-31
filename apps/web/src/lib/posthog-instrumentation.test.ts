import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: posthog,
}));

describe("PostHog browser instrumentation", () => {
  beforeEach(() => {
    vi.resetModules();
    posthog.init.mockReset();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "test-project-token");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("initializes the browser SDK against direct US ingestion", async () => {
    await import("../../instrumentation-client");

    expect(posthog.init).toHaveBeenCalledWith(
      "test-project-token",
      expect.objectContaining({
        api_host: "https://us.i.posthog.com",
        ui_host: "https://us.posthog.com",
      })
    );
  });

  it("does not initialize without a project token", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");

    await import("../../instrumentation-client");

    expect(posthog.init).not.toHaveBeenCalled();
  });
});
