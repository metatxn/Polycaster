// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type {
  PanelOpenArgs,
  TradingRuntime,
} from "../../src/content/trading-runtime-types";
import {
  activateCardTradingIntentForTest,
  configureCardTradingRuntimePort,
  hideLoadedTradingPanel,
  resetCardTradingRuntimePort,
} from "../../src/content/ui/cards";
import {
  collapseStreamWidgets,
  configureStreamTradingRuntimePort,
  createStreamBetHost,
  disposeStreamControllers,
  setStreamInlineDepositActive,
} from "../../src/content/ui/notifications";
import {
  buildStreamBetting,
  configureStreamTradingPort,
  disposeStreamBetting,
  resetStreamTradingPort,
} from "../../src/content/ui/stream-bet-ui";
import type { Market } from "../../src/types/market";

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const market = { id: "market-1", title: "Market" } as Market;

function panelArgs(): Omit<PanelOpenArgs, "anchorElement"> {
  return {
    market,
    outcomeName: "Yes",
    outcomeIndex: 0,
    price: 0.5,
    isMultiOutcome: false,
  };
}

function mountedTrigger(): { card: HTMLElement; trigger: HTMLButtonElement } {
  const card = document.createElement("div");
  card.className = "knoww-market-card";
  const trigger = document.createElement("button");
  card.appendChild(trigger);
  document.body.appendChild(card);
  return { card, trigger };
}

afterEach(() => {
  resetCardTradingRuntimePort();
  resetStreamTradingPort();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

test("concurrent card activation shares one intent and restores exact trigger state", async () => {
  const pending = deferred<Pick<TradingRuntime, "openTradingPanel">>();
  const openTradingPanel = vi.fn();
  const load = vi.fn(() => pending.promise);
  configureCardTradingRuntimePort({
    load,
    getLoaded: () => null,
    showError: vi.fn(),
  });
  const { trigger } = mountedTrigger();
  trigger.setAttribute("style", "color: red;");
  trigger.setAttribute("aria-busy", "false");
  trigger.setAttribute("aria-disabled", "false");

  const first = activateCardTradingIntentForTest(trigger, panelArgs());
  const second = activateCardTradingIntentForTest(trigger, panelArgs());
  assert.equal(load.mock.calls.length, 1);
  assert.equal(trigger.disabled, true);
  assert.equal(trigger.getAttribute("aria-busy"), "true");

  pending.resolve({ openTradingPanel });
  await Promise.all([first, second]);

  assert.equal(openTradingPanel.mock.calls.length, 1);
  assert.equal(trigger.disabled, false);
  assert.equal(trigger.getAttribute("style"), "color: red;");
  assert.equal(trigger.getAttribute("aria-busy"), "false");
  assert.equal(trigger.getAttribute("aria-disabled"), "false");
});

test("failed and detached card intents restore safely and remain retryable", async () => {
  const openTradingPanel = vi.fn();
  const showError = vi.fn();
  const load = vi
    .fn<() => Promise<Pick<TradingRuntime, "openTradingPanel">>>()
    .mockRejectedValueOnce(new Error("chunk failed"))
    .mockResolvedValueOnce({ openTradingPanel });
  configureCardTradingRuntimePort({ load, getLoaded: () => null, showError });
  const { card, trigger } = mountedTrigger();

  await activateCardTradingIntentForTest(trigger, panelArgs());
  assert.equal(showError.mock.calls.length, 1);
  assert.equal(trigger.hasAttribute("aria-busy"), false);

  await activateCardTradingIntentForTest(trigger, panelArgs());
  assert.equal(load.mock.calls.length, 2);
  assert.equal(openTradingPanel.mock.calls.length, 1);

  const pending = deferred<Pick<TradingRuntime, "openTradingPanel">>();
  load.mockImplementationOnce(() => pending.promise);
  const detached = activateCardTradingIntentForTest(trigger, panelArgs());
  card.remove();
  pending.resolve({ openTradingPanel });
  await detached;
  assert.equal(openTradingPanel.mock.calls.length, 1);
  assert.equal(showError.mock.calls.length, 1);
});

test("hiding a card panel consults only an already loaded runtime", () => {
  const load = vi.fn();
  const hideTradingPanel = vi.fn();
  configureCardTradingRuntimePort({
    load,
    getLoaded: () => null,
    showError: vi.fn(),
  });
  hideLoadedTradingPanel();
  assert.equal(load.mock.calls.length, 0);

  configureCardTradingRuntimePort({
    load,
    getLoaded: () => ({ hideTradingPanel }),
    showError: vi.fn(),
  });
  hideLoadedTradingPanel();
  assert.equal(hideTradingPanel.mock.calls.length, 1);
  assert.equal(load.mock.calls.length, 0);
});

test("stream host defers loading, hydrates with per-instance callbacks, and disposes once", async () => {
  const dispose = vi.fn();
  const hydrateStreamBet = vi.fn(() => ({ dispose }));
  const load = vi.fn().mockResolvedValue({ hydrateStreamBet });
  configureStreamTradingRuntimePort({ load });

  const unmounted = createStreamBetHost(market);
  await Promise.resolve();
  assert.equal(load.mock.calls.length, 0);
  unmounted.remove();

  const host = createStreamBetHost(market);
  document.body.appendChild(host);
  await vi.waitFor(() => assert.equal(hydrateStreamBet.mock.calls.length, 1));
  const hydrateArgs = hydrateStreamBet.mock.calls[0][1];
  assert.equal(typeof hydrateArgs.ui.setInlineDepositActive, "function");
  assert.equal(typeof hydrateArgs.ui.showToast, "function");

  disposeStreamControllers(document.body);
  disposeStreamControllers(document.body);
  assert.equal(dispose.mock.calls.length, 1);
});

test("stream teardown before a lazy import resolves prevents hydration", async () => {
  const pending = deferred<Pick<TradingRuntime, "hydrateStreamBet">>();
  const hydrateStreamBet = vi.fn(() => ({ dispose: vi.fn() }));
  configureStreamTradingRuntimePort({ load: () => pending.promise });
  const host = createStreamBetHost(market);
  document.body.appendChild(host);
  await Promise.resolve();

  disposeStreamControllers(document.body);
  host.remove();
  pending.resolve({ hydrateStreamBet });
  await pending.promise;
  await Promise.resolve();
  assert.equal(hydrateStreamBet.mock.calls.length, 0);
});

test("stream loader failures render a working retry", async () => {
  const hydrateStreamBet = vi.fn(() => ({ dispose: vi.fn() }));
  const load = vi
    .fn<() => Promise<Pick<TradingRuntime, "hydrateStreamBet">>>()
    .mockRejectedValueOnce(new Error("chunk failed"))
    .mockResolvedValueOnce({ hydrateStreamBet });
  configureStreamTradingRuntimePort({ load });
  const host = createStreamBetHost(market);
  document.body.appendChild(host);

  await vi.waitFor(() => {
    assert.ok(host.querySelector("button"));
  });
  host.querySelector<HTMLButtonElement>("button")?.click();
  await vi.waitFor(() => assert.equal(hydrateStreamBet.mock.calls.length, 1));
  assert.equal(load.mock.calls.length, 2);
});

test("a stale stream onClose cannot clear another host's active deposit owner", () => {
  const first = document.createElement("div");
  const second = document.createElement("div");
  setStreamInlineDepositActive(first, true);
  setStreamInlineDepositActive(second, true);
  setStreamInlineDepositActive(first, false);
  assert.equal(setStreamInlineDepositActive(second, false), true);
  assert.equal(setStreamInlineDepositActive(second, false), false);
});

test("collapsing stream widgets dispatches retained collapse events", () => {
  const root = document.createElement("div");
  const first = document.createElement("div");
  const second = document.createElement("div");
  first.className = "knoww-stream-bet";
  second.className = "knoww-stream-bet";
  root.append(first, second);
  const firstCollapse = vi.fn();
  const secondCollapse = vi.fn();
  first.addEventListener("knoww-stream-collapsed", firstCollapse);
  second.addEventListener("knoww-stream-collapsed", secondCollapse);

  collapseStreamWidgets(root);
  assert.equal(firstCollapse.mock.calls.length, 1);
  assert.equal(secondCollapse.mock.calls.length, 1);
});

test("collapsing a widget closes its owned inline deposit and clears its callback", () => {
  const activeStates: boolean[] = [];
  let onClose: (() => void) | undefined;
  const closeInlineDeposit = vi.fn(() => onClose?.());
  Object.assign(window, {
    KNOWW_CONFIG: {
      getStreamTradingSettings: () => ({
        defaultAmount: 20,
        oneClickEnabled: true,
        confirmBeforeTrade: true,
      }),
    },
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  configureStreamTradingPort({
    getContext: () => ({
      address: "0xabc",
      minOrderSize: 5,
      balance: 0,
      hasCredentials: true,
      state: "ready",
      usdcAllowance: 100,
      usdcAllowanceNegRisk: 100,
    }),
    refreshBalance: async () => {},
    resolveOrderTokens: async () => ({ negRisk: false }),
    placeBuy: async () => {},
    placeSell: async () => {},
    getOutcomeBalances: async () => ({ yesBalance: "0", noBalance: "0" }),
    mountInlineDeposit: (args) => {
      onClose = args.onClose;
    },
    closeInlineDeposit,
    ensureReady: async () => {},
    isDeploymentRequired: () => false,
    isNegRisk: () => false,
    approveUsdc: async () => {},
    openSetupSidePanel: () => {},
    onStateChange: () => () => {},
  });

  const widget = buildStreamBetting(market, {
    setInlineDepositActive: (active) => activeStates.push(active),
    showToast: () => {},
  });
  document.body.appendChild(widget);
  widget
    .querySelector<HTMLButtonElement>(".knoww-stream-trade.deposit")
    ?.click();
  widget.dispatchEvent(new CustomEvent("knoww-stream-collapsed"));

  assert.equal(closeInlineDeposit.mock.calls.length, 1);
  assert.deepEqual(activeStates, [true, false]);
  disposeStreamBetting(widget);
});
