import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("product success analytics", () => {
  it("tracks successful onboarding outcomes", () => {
    const service = readSource("src/content/trading/trading-service.ts");
    const sidepanel = readSource("src/sidepanel/setup.ts");

    expect(service).toContain(
      'trackTradingAnalytics("trading_account_created"'
    );
    expect(service).toContain(
      'trackTradingAnalytics("trading_token_approval_succeeded"'
    );
    expect(service).toContain(
      "wallet_address: properties.wallet_address ?? walletAddress"
    );
    expect(sidepanel).toContain('event: "trading_account_created"');
    expect(sidepanel).toContain("wallet_address: walletAddress");
  });

  it("tracks successful orders, sells, and cancellations", () => {
    const orderView = readSource("src/content/trading/panel/order-view.ts");
    const portfolio = readSource("src/sidepanel/portfolio.ts");
    const tradingPanel = readSource("src/content/trading/trading-panel.ts");

    expect(orderView).not.toContain('trackPanelAnalytics("order_succeeded"');
    expect(orderView).not.toContain('trackPanelAnalytics("sell_succeeded"');
    expect(readSource("src/background/order-analytics.ts")).toContain(
      "createOrderAnalyticsTracker"
    );
    expect(tradingPanel).toContain("wallet_address: walletAddress");
    expect(portfolio).toContain('event: "order_cancelled"');
  });

  it("tracks order attempts and failures with canonical dashboard fields", () => {
    const orderView = readSource("src/content/trading/panel/order-view.ts");

    expect(readSource("src/content/trading/trading-service.ts")).toContain(
      'trackTradingAnalytics("order_attempted"'
    );
    expect(readSource("src/content/trading/trading-service.ts")).toContain(
      '"order_failed" : "order_submission_unknown"'
    );
    expect(orderView).toContain('surface: "trading_panel"');
    expect(orderView).toContain("market_title:");
    expect(orderView).toContain("outcome_name:");
    expect(orderView).toContain("order_type:");
    expect(orderView).toContain("order_value:");
  });
});
