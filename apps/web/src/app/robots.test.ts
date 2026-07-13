import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots", () => {
  it("allows public render resources while keeping the rest of the API blocked", () => {
    const config = robots();
    const rules = Array.isArray(config.rules) ? config.rules[0] : config.rules;

    expect(rules?.disallow).toContain("/api/");
    expect(rules?.disallow).not.toContain("/portfolio");
    expect(rules?.disallow).not.toContain("/profile/");
    expect(rules?.allow).toEqual(
      expect.arrayContaining([
        "/",
        "/api/image",
        "/api/events/",
        "/api/comments",
        "/api/markets/price-history/",
        "/api/markets/price-history/batch",
      ])
    );
  });
});
