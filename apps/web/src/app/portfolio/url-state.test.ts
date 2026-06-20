import { describe, expect, it } from "vitest";
import { buildPortfolioTabUrl, parsePortfolioTab } from "./url-state";

describe("portfolio URL tab state", () => {
  it("parses the active tab from search params", () => {
    expect(parsePortfolioTab("?tab=history")).toBe("history");
    expect(parsePortfolioTab(new URLSearchParams("tab=orders"))).toBe("orders");
    expect(parsePortfolioTab("?tab=positions")).toBe("positions");
  });

  it("defaults invalid or missing tab params to positions", () => {
    expect(parsePortfolioTab("")).toBe("positions");
    expect(parsePortfolioTab("?tab=activity")).toBe("positions");
    expect(parsePortfolioTab("?tab=")).toBe("positions");
  });

  it("writes non-default tabs while preserving other query params", () => {
    expect(buildPortfolioTabUrl("/portfolio", "?fund=deposit", "history")).toBe(
      "/portfolio?fund=deposit&tab=history"
    );
    expect(buildPortfolioTabUrl("/portfolio", "?fund=deposit", "orders")).toBe(
      "/portfolio?fund=deposit&tab=orders"
    );
  });

  it("removes the tab param for the default positions tab", () => {
    expect(
      buildPortfolioTabUrl(
        "/portfolio",
        "?fund=deposit&tab=history",
        "positions"
      )
    ).toBe("/portfolio?fund=deposit");
    expect(
      buildPortfolioTabUrl("/portfolio", "?tab=history", "positions")
    ).toBe("/portfolio");
  });
});
