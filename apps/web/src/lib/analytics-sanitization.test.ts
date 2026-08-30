import { describe, expect, it } from "vitest";
import { sanitizeAnalyticsProperties } from "./analytics-sanitization";

describe("sanitizeAnalyticsProperties", () => {
  it("removes sensitive keys regardless of casing or separator style", () => {
    expect(
      sanitizeAnalyticsProperties({
        host: "example.com",
        pageText: "private text",
        page_url: "https://example.com/private?token=secret",
        pagePath: "/private",
        marketUrl: "https://example.com/market/private",
        access_token: "secret",
        searchQuery: "private query",
        wallet_address: "0xprivate",
        feature: "site-support",
      })
    ).toEqual({
      host: "example.com",
      feature: "site-support",
    });
  });
});
