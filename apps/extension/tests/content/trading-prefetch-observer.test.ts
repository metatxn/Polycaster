// @vitest-environment jsdom

import assert from "node:assert/strict";
import { beforeAll, test, vi } from "vitest";

vi.mock("@knoww/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../src/content/platform-loader", () => ({
  loadPlatformAdapter: () => new Promise<boolean>(() => {}),
}));
vi.mock("../../src/content/trading-loader", () => ({
  prefetchTradingRuntime: vi.fn(),
}));
vi.mock("../../src/content/x-pnl-badges", () => ({
  startXTraderPnlBadges: vi.fn(),
}));

let observeFirstMountedTradingCard: typeof import("../../src/content/main").observeFirstMountedTradingCard;

beforeAll(async () => {
  Object.assign(window, {
    KNOWW_UTILS: { log: vi.fn(), safeSendMessage: vi.fn() },
    KNOWW_CONFIG: { loadUserSettings: () => new Promise<void>(() => {}) },
    KNOWW_STYLES: {},
    KNOWW_API: {},
    KNOWW_INJECTION: {},
    KNOWW_UI: {},
  });
  ({ observeFirstMountedTradingCard } = await import("../../src/content/main"));
});

function appendTradingCard(): HTMLElement {
  const card = document.createElement("div");
  card.className = "knoww-market-card";
  card.setAttribute("data-nth-injector-card", "true");
  document.body.appendChild(card);
  return card;
}

test("pagehide before the card mutation permanently prevents prefetch", async () => {
  const idle = vi.fn();
  const prefetch = vi.fn();
  observeFirstMountedTradingCard(idle, prefetch);
  window.dispatchEvent(new Event("pagehide"));
  appendTradingCard();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(idle.mock.calls.length, 0);
  assert.equal(prefetch.mock.calls.length, 0);
  document.body.replaceChildren();
});

test("pagehide after idle scheduling prevents the queued callback from prefetching", async () => {
  let idleCallback: (() => void) | null = null;
  const idle = vi.fn((callback: () => void) => {
    idleCallback = callback;
  });
  const prefetch = vi.fn();
  observeFirstMountedTradingCard(idle, prefetch);
  appendTradingCard();
  await vi.waitFor(() => assert.equal(idle.mock.calls.length, 1));
  window.dispatchEvent(new Event("pagehide"));
  idleCallback?.();
  assert.equal(prefetch.mock.calls.length, 0);
  document.body.replaceChildren();
});
