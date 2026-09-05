import { describe, expect, it } from "vitest";

import {
  DEFAULT_POSTHOG_BROWSER_HOST,
  getPostHogBrowserHost,
} from "./posthog-browser-config";

describe("getPostHogBrowserHost", () => {
  it("uses Knoww's managed proxy by default", () => {
    expect(DEFAULT_POSTHOG_BROWSER_HOST).toBe("https://a.knoww.app");
    expect(getPostHogBrowserHost(undefined)).toBe(DEFAULT_POSTHOG_BROWSER_HOST);
    expect(getPostHogBrowserHost("   ")).toBe(DEFAULT_POSTHOG_BROWSER_HOST);
    expect(getPostHogBrowserHost("/ingest")).toBe(DEFAULT_POSTHOG_BROWSER_HOST);
  });

  it("routes an existing direct US ingestion setting through the proxy", () => {
    expect(getPostHogBrowserHost(" https://us.i.posthog.com/// ")).toBe(
      "https://a.knoww.app"
    );
  });

  it("accepts the live managed proxy and preserves custom proxy overrides", () => {
    expect(getPostHogBrowserHost("https://a.knoww.app/")).toBe(
      "https://a.knoww.app"
    );
    expect(getPostHogBrowserHost("https://custom.example.com/")).toBe(
      "https://custom.example.com"
    );
  });

  it("normalizes an explicitly configured host", () => {
    expect(getPostHogBrowserHost(" https://eu.i.posthog.com/// ")).toBe(
      "https://eu.i.posthog.com"
    );
  });
});
