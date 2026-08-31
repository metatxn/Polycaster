import { describe, expect, it } from "vitest";

import {
  DEFAULT_POSTHOG_BROWSER_HOST,
  getPostHogBrowserHost,
} from "./posthog-browser-config";

describe("getPostHogBrowserHost", () => {
  it("uses the PostHog US ingestion endpoint by default", () => {
    expect(getPostHogBrowserHost(undefined)).toBe(DEFAULT_POSTHOG_BROWSER_HOST);
    expect(getPostHogBrowserHost("   ")).toBe(DEFAULT_POSTHOG_BROWSER_HOST);
    expect(getPostHogBrowserHost("/ingest")).toBe(DEFAULT_POSTHOG_BROWSER_HOST);
  });

  it("normalizes an explicitly configured host", () => {
    expect(getPostHogBrowserHost(" https://eu.i.posthog.com/// ")).toBe(
      "https://eu.i.posthog.com"
    );
  });
});
