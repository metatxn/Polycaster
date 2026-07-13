import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("the ESM compiler and WAR expose the lazy trading runtime", () => {
  const webpack = source("webpack.config.cjs");
  const manifest = JSON.parse(source("manifest.json")) as {
    web_accessible_resources?: Array<{ resources?: string[] }>;
  };

  assert.match(
    webpack,
    /["']content-trading["']\s*:\s*["']\.\/src\/content\/trading\/trading-entry\.ts["']/
  );
  assert.ok(
    manifest.web_accessible_resources?.some((entry) =>
      entry.resources?.includes("content-trading.js")
    )
  );
});

test("core UI installs only the lazy ports and never creates or adopts trading eagerly", () => {
  const index = source("src/content/ui/index.ts");
  assert.match(index, /from "\.\.\/trading-loader"/);
  assert.match(index, /configureCardTradingRuntimePort/);
  assert.match(index, /configureStreamTradingRuntimePort/);
  assert.doesNotMatch(index, /createTradingRuntime/);
  assert.doesNotMatch(index, /adoptLoadedTradingRuntime/);
  assert.doesNotMatch(index, /\.\.\/trading\/trading-entry/);
  assert.doesNotMatch(index, /\.\/trading-glue/);
});

test("trading glue is owned by the trading bundle and takes stream callbacks per instance", () => {
  assert.equal(
    existsSync(join(process.cwd(), "src/content/ui/trading-glue.ts")),
    false
  );
  const entry = source("src/content/trading/trading-entry.ts");
  const glue = source("src/content/trading/trading-glue.ts");
  const types = source("src/content/trading-runtime-types.ts");
  const streamUi = source("src/content/ui/stream-bet-ui.ts");

  assert.match(entry, /from "\.\/trading-glue"/);
  assert.match(types, /ui:\s*\{/);
  assert.match(types, /setInlineDepositActive\(active: boolean\)/);
  assert.match(types, /showToast\(message: string\)/);
  assert.doesNotMatch(streamUi, /configureStreamUiCallbacks/);
  assert.doesNotMatch(streamUi, /let streamUiCallbacks/);
  assert.match(glue, /buildStreamBetting\(args\.market, args\.ui\)/);
});

test("cards guard async lazy intents and hide without importing", () => {
  const cards = source("src/content/ui/cards.ts");
  assert.match(cards, /configureCardTradingRuntimePort/);
  assert.match(cards, /await\s+port\.load\(\)/);
  assert.match(cards, /aria-busy/);
  assert.match(cards, /trigger\.isConnected/);
  assert.match(cards, /closest<HTMLElement>\("\.knoww-market-card"\)/);
  assert.match(cards, /getLoaded\(\)\?\.hideTradingPanel\(\)/);
});

test("stream hosts own lazy hydration, retry, and teardown before DOM clears", () => {
  const notifications = source("src/content/ui/notifications.ts");
  assert.match(notifications, /configureStreamTradingRuntimePort/);
  assert.match(notifications, /knoww-stream-bet-host/);
  assert.match(notifications, /runtime\.hydrateStreamBet\(host/);
  assert.match(notifications, /Retry loading trading/);
  assert.match(notifications, /disposeStreamControllers/);
  assert.match(
    notifications,
    /disposeStreamControllers\(itemsContainer\);\s*itemsContainer\.innerHTML = "";/
  );
  assert.doesNotMatch(notifications, /buildStreamBetting/);
  const streamUi = source("src/content/ui/stream-bet-ui.ts");
  const deposit = source("src/content/trading/panel/deposit-view.ts");
  assert.match(streamUi, /closeInlineDeposit\(depositHost\)/);
  assert.match(deposit, /host && panelState\.inlineDepositHost !== host/);
});

test("feed startup observes the first mounted injected card and prefetches once", () => {
  const main = source("src/content/main.ts");
  assert.match(main, /prefetchTradingRuntime/);
  assert.match(main, /new MutationObserver/);
  assert.match(
    main,
    /\.knoww-market-card\[data-nth-injector-card=["']true["']\]/
  );
  assert.match(main, /observer\.disconnect\(\)/);
  assert.match(main, /pagehide/);
  assert.ok(
    main.indexOf("observeFirstMountedTradingCard") < main.indexOf("watchFeed(")
  );
});
