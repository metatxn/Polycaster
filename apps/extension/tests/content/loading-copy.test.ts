import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const loadingCopyFiles = [
  "src/content/trading/credentials.ts",
  "src/content/trading/panel/deposit-view.ts",
  "src/content/trading/panel/order-view.ts",
  "src/content/trading/panel/positions-view.ts",
  "src/content/trading/panel/setup-view.ts",
  "src/content/trading/trading-panel.ts",
  "src/content/ui/notifications.ts",
  "src/content/ui/stream-bet-ui.ts",
  "src/options.tsx",
  "src/sidepanel.ts",
  "src/sidepanel/funding-ui.ts",
  "src/sidepanel/markets.ts",
  "src/sidepanel/portfolio.ts",
  "src/sidepanel/setup.ts",
] as const;

function quotedMessages(source: string): string[] {
  return source
    .split("\n")
    .flatMap((line) =>
      Array.from(line.matchAll(/(["'])(.*?)\1/g), (match) => match[2])
    );
}

describe("extension loading copy", () => {
  test("uses the account language in both trading setup views", () => {
    const tradingPanel = readSource("src/content/trading/trading-panel.ts");
    const sidepanelSetup = readSource("src/sidepanel/setup.ts");

    expect(tradingPanel).toContain('"Creating your account..."');
    expect(sidepanelSetup).toContain("Creating your account...");
    expect(tradingPanel).not.toContain("Deploying your trading wallet");
    expect(sidepanelSetup).not.toContain("Creating trading wallet");
  });

  test("uses short personal copy for discovery and trading waits", () => {
    const notifications = readSource("src/content/ui/notifications.ts");
    const orderView = readSource("src/content/trading/panel/order-view.ts");

    expect(notifications).toContain("Checking this page for markets...");
    expect(notifications).toContain("Getting trading ready for you...");
    expect(notifications).toContain("Looking for relevant matches for you...");
    expect(orderView).toContain("Checking live prices for you...");
    expect(orderView).toContain("Checking your order...");
    expect(orderView).toContain("Sending your order to the market...");
    expect(orderView).not.toContain("Settling...");
  });

  test("labels portfolio actions while they are in progress", () => {
    const portfolio = readSource("src/sidepanel/portfolio.ts");
    const sidepanel = readSource("src/sidepanel.ts");

    expect(sidepanel).toContain("Opening your portfolio...");
    expect(portfolio).toContain("Selling your position...");
    expect(portfolio).toContain("Cancelling your order...");
    expect(portfolio).toContain("Bringing your portfolio up to date...");
    expect(portfolio).not.toContain('label.textContent = "…"');
  });

  test("labels quote and deposit-address waits", () => {
    const depositView = readSource("src/content/trading/panel/deposit-view.ts");

    expect(depositView).toContain("Getting your quote...");
    expect(depositView).toContain("Creating your deposit address...");
    expect(depositView).toContain("Preparing your deposit details for you...");
  });

  test("keeps progress copy calm and action-oriented", () => {
    const messages = loadingCopyFiles.flatMap((path) =>
      quotedMessages(readSource(path))
    );

    expect(messages.filter((message) => /\bstill\b/i.test(message))).toEqual(
      []
    );
    expect(
      messages.filter((message) => /\btaking longer\b/i.test(message))
    ).toEqual([]);
    expect(messages.filter((message) => /\bwaiting\b/i.test(message))).toEqual(
      []
    );
  });
});
