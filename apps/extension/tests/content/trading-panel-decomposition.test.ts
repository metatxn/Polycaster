// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PUSD_DECIMALS } from "@knoww/shared-types/contracts";
import { describe, expect, test, vi } from "vitest";
import type { TradingContext } from "../../src/content/trading/trading-service";
import type { FundingError } from "../../src/funding";

declare const process: { cwd(): string };

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("trading panel decomposition contracts", () => {
  test("panel state exposes one stable object with conservative defaults", async () => {
    const { panelState } = await import(
      "../../src/content/trading/panel/panel-state"
    );

    expect(panelState).toMatchObject({
      activePanel: null,
      panelOpts: null,
      inlineDepositHost: null,
      inlineDepositUnsub: null,
      inlineDepositOnClose: null,
      activeUnsubscribe: null,
      mobileQrRoot: null,
      activeSide: "buy",
      activeView: "order",
      orderMode: "market",
      selectedShares: 10,
      marketBuyAmount: 0,
      limitPrice: 0,
      expirationPreset: "GTC",
      splitMergeAmount: "",
      outcomeBalances: null,
      outcomeBalancesLoaded: false,
      outcomeBalancesFetching: false,
      moreMenuOpen: false,
      orderSettling: false,
      settleTimer: null,
      orderApprovalPreview: null,
      orderApprovalPreviewInFlightKey: null,
      orderApprovalPreviewTimer: null,
      cardSetupStorageAddress: null,
      cardSetupDismissed: false,
      cardSetupComplete: false,
      cardSetupStorageToken: 0,
      depositController: null,
      depositControllerUnsub: null,
      depositPrevStep: null,
      depositDoneReturnTimer: null,
      selectedOutcome: "yes",
      yesPrice: 0,
      noPriceValue: 0,
      sessionRestoreAttempted: false,
      lastRenderedErrorToast: null,
      dismissedErrorToast: null,
      livePanelRefreshTimer: null,
      livePanelRefreshEnabled: false,
      disconnectedUnsub: null,
      walletResolveLoadingSince: null,
      walletResolveTimeoutTimer: null,
      cachedPrices: null,
      pricesFetchedAt: 0,
      overflowOverrides: [],
    });
    expect(panelState.depositInitiatedTxHashes).toBeInstanceOf(Set);
    expect(panelState.depositInitiatedTxHashes.size).toBe(0);

    const source = readSource("src/content/trading/panel/panel-state.ts");
    expect(source.match(/export const\s+\w+/g)).toEqual([
      "export const panelState",
    ]);
  });

  test("formatters preserve numeric and user-facing copy behavior", async () => {
    const format = await import("../../src/content/trading/panel/format");

    expect(Object.keys(format).sort()).toEqual(
      [
        "depositErrorCopy",
        "formatCollateralBreakdown",
        "formatDepositRawAmount",
        "formatMarketBuyAmountInput",
        "formatShareQuantity",
        "formatSplitMergeAmount",
        "formatTokenAmount",
        "formatTradingPanelErrorMessage",
        "getExactPusdBalance",
        "getPusdBalance",
        "getTokenBalance",
        "isSigningBridgeUnreachable",
        "normalizeUsdChipAmount",
        "normalizeUsdInputAmount",
        "rawPusdToNumber",
        "truncAddr",
      ].sort()
    );

    expect(format.formatShareQuantity(10)).toBe("10");
    expect(format.formatShareQuantity(1.234567)).toBe("1.2346");
    expect(format.formatMarketBuyAmountInput(0)).toBe("0");
    expect(format.normalizeUsdInputAmount("12.345")).toBe(12.345);
    expect(format.normalizeUsdInputAmount("-1")).toBe(0);
    expect(format.normalizeUsdChipAmount("12.345")).toBe(12.35);
    expect(format.rawPusdToNumber(String(10 ** PUSD_DECIMALS))).toBe(1);
    expect(format.formatTokenAmount(0.001)).toBe("<0.01");
    expect(format.formatSplitMergeAmount("1.2300")).toBe("1.23");
    expect(format.formatDepositRawAmount(1_230_000n, 6)).toBe("1.23");
    expect(format.truncAddr("0x1234567890abcdef")).toBe("0x1234...cdef");

    const ctx = {
      pusdBalance: 2.5,
      pusdBalanceRaw: "2500000",
      usdcEBalance: 3,
      tokenBalances: [
        { symbol: "pUSD", amount: 2.5 },
        { symbol: "USDC.e", amount: 3 },
      ],
    } as TradingContext;
    expect(format.getTokenBalance(ctx, "pusd")).toBe(2.5);
    expect(format.getPusdBalance(ctx)).toBe(2.5);
    expect(format.getExactPusdBalance(ctx)).toBe("2.5");
    expect(format.formatCollateralBreakdown(ctx)).toBe(
      "pUSD 2.50 + USDC.e 3.00"
    );

    const unreachable: FundingError = {
      code: "EXECUTION_FAILED",
      message: "Could not establish connection. Receiving end does not exist.",
      retryable: true,
    };
    expect(format.depositErrorCopy(unreachable)).toContain(
      "Couldn't reach your wallet"
    );
  });

  test("setup banner clears dismissal before rerendering", async () => {
    vi.stubGlobal("__DEV_MODE__", false);
    const { panelState } = await import(
      "../../src/content/trading/panel/panel-state"
    );
    const { addSetupBanner } = await import(
      "../../src/content/trading/panel/setup-view"
    );
    const parent = document.createElement("div");
    const observations: boolean[] = [];
    panelState.cardSetupDismissed = true;

    addSetupBanner(parent, { address: null } as TradingContext, {
      el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
      },
      buildInlineError() {
        return document.createElement("div");
      },
      setButtonLoading() {},
      rerender() {
        observations.push(panelState.cardSetupDismissed);
      },
    });

    parent.querySelector<HTMLButtonElement>("button")?.click();
    expect(observations).toEqual([false]);
  });

  test("extracted modules cannot depend back on trading-panel", () => {
    const state = readSource("src/content/trading/panel/panel-state.ts");
    const format = readSource("src/content/trading/panel/format.ts");
    const setup = readSource("src/content/trading/panel/setup-view.ts");

    for (const [name, source] of [
      ["panel-state", state],
      ["format", format],
      ["setup-view", setup],
    ] as const) {
      assert.doesNotMatch(
        source,
        /from\s+["'][^"']*trading-panel["']/,
        `${name} must not import trading-panel`
      );
    }
    assert.doesNotMatch(format, /panel-state|panelState/);
    assert.match(setup, /interface SetupViewUiPort/);
  });

  test("phase 3 views own their dependency closures without cycles", () => {
    const shell = readSource("src/content/trading/trading-panel.ts");
    const positions = readSource("src/content/trading/panel/positions-view.ts");
    const deposit = readSource("src/content/trading/panel/deposit-view.ts");
    const order = readSource("src/content/trading/panel/order-view.ts");

    for (const [name, source] of [
      ["positions-view", positions],
      ["deposit-view", deposit],
      ["order-view", order],
    ] as const) {
      assert.doesNotMatch(
        source,
        /from\s+["'][^"']*trading-panel["']/,
        `${name} must not import trading-panel`
      );
    }

    assert.match(positions, /function refreshSplitMergeState/);
    assert.match(positions, /function renderSplitForm/);
    assert.match(positions, /function renderMergeForm/);
    assert.doesNotMatch(shell, /function refreshSplitMergeState/);
    assert.doesNotMatch(shell, /function renderSplitForm/);
    assert.doesNotMatch(shell, /function renderMergeForm/);

    assert.match(deposit, /function renderDepositForm/);
    assert.match(deposit, /function ensureDepositController/);
    assert.match(deposit, /function syncDepositControllerAccount/);
    assert.doesNotMatch(shell, /function renderDepositForm/);
    assert.doesNotMatch(shell, /function ensureDepositController/);
    assert.doesNotMatch(shell, /function syncDepositControllerAccount/);

    assert.match(order, /function renderOrderForm/);
    assert.match(order, /function ensureOrderApprovalPreview/);
    assert.match(order, /function addSubmitButton/);
    assert.doesNotMatch(shell, /function renderOrderForm/);
    assert.doesNotMatch(shell, /function ensureOrderApprovalPreview/);
    assert.doesNotMatch(shell, /function addSubmitButton/);

    assert.doesNotMatch(positions, /from\s+["']\.\/order-view["']/);
    assert.doesNotMatch(positions, /from\s+["']\.\/deposit-view["']/);
    assert.doesNotMatch(deposit, /from\s+["']\.\/(order|positions)-view["']/);
    assert.doesNotMatch(order, /from\s+["']\.\/deposit-view["']/);

    for (const anchor of [
      "DEPOSIT_TOKENS",
      "createTradingPanelFundingGateway",
      "depositInitiatedTxHashes",
    ]) {
      assert.match(deposit, new RegExp(anchor));
      assert.doesNotMatch(shell, new RegExp(anchor));
      assert.doesNotMatch(order, new RegExp(anchor));
      assert.doesNotMatch(positions, new RegExp(anchor));
    }
    for (const anchor of [
      "ORDER_APPROVAL_PREVIEW_DEBOUNCE_MS",
      "calculateBuySlippageForAmount",
      "getPanelOrderType",
    ]) {
      assert.match(order, new RegExp(anchor));
      assert.doesNotMatch(shell, new RegExp(anchor));
      assert.doesNotMatch(deposit, new RegExp(anchor));
      assert.doesNotMatch(positions, new RegExp(anchor));
    }
    for (const anchor of [
      "getCanonicalSplitMergeAmount",
      "position_split_submitted",
      "position_merge_submitted",
    ]) {
      assert.match(positions, new RegExp(anchor));
      assert.doesNotMatch(shell, new RegExp(anchor));
      assert.doesNotMatch(deposit, new RegExp(anchor));
      assert.doesNotMatch(order, new RegExp(anchor));
    }
  });

  test("Task 14 shell is a thin lifecycle router and production proves every panel module", () => {
    const shell = readSource("src/content/trading/trading-panel.ts");
    const deposit = readSource("src/content/trading/panel/deposit-view.ts");
    const assertion = readSource("scripts/assert-production-bundle.mjs");

    expect(shell.split("\n").length).toBeLessThan(1_500);
    for (const module of [
      "deposit-view",
      "format",
      "order-view",
      "panel-state",
      "positions-view",
      "setup-view",
    ]) {
      assert.match(shell, new RegExp(`from ["']\\./panel/${module}["']`));
      assert.match(
        assertion,
        new RegExp(`src/content/trading/panel/${module}\\.ts`)
      );
    }

    assert.doesNotMatch(shell, /^let\s/m);
    for (const anchor of [
      "DEPOSIT_TOKENS",
      "ensureDepositController",
      "ensureOrderApprovalPreview",
      "getCanonicalSplitMergeAmount",
      "renderDepositMethodStep",
      "addSubmitButton",
    ]) {
      assert.doesNotMatch(shell, new RegExp(anchor));
    }

    for (const method of [
      "show",
      "hide",
      "isVisible",
      "mountInlineDeposit",
      "closeInlineDeposit",
    ]) {
      assert.match(shell, new RegExp(`\\n  ${method}\\(`));
    }

    const renderSource = shell.slice(shell.indexOf("function render("));
    const depositIndex = renderSource.indexOf('activeView === "deposit"');
    const orderIndex = renderSource.indexOf('activeView === "order"');
    const splitIndex = renderSource.indexOf('activeView === "split"');
    const mergeIndex = renderSource.indexOf('activeView === "merge"');
    expect(depositIndex).toBeGreaterThan(-1);
    expect(depositIndex).toBeLessThan(orderIndex);
    expect(orderIndex).toBeLessThan(splitIndex);
    expect(splitIndex).toBeLessThan(mergeIndex);

    const rerenderSource = shell.slice(
      shell.indexOf("function rerender("),
      shell.indexOf("function syncCardSetupStorage")
    );
    expect(rerenderSource.indexOf("inlineDepositHost")).toBeLessThan(
      rerenderSource.indexOf("activePanel")
    );

    expect(shell.match(/syncDepositControllerAccount\(ctx\);/g)).toHaveLength(
      1
    );
    expect(deposit.match(/syncDepositControllerAccount\(ctx\);/g)).toHaveLength(
      1
    );
  });

  test("inline deposit replacement ignores stale host callbacks and closes each owner once", async () => {
    const deposit = await import(
      "../../src/content/trading/panel/deposit-view"
    );
    const { panelState } = await import(
      "../../src/content/trading/panel/panel-state"
    );
    const { TradingService } = await import(
      "../../src/content/trading/trading-service"
    );
    const context = {
      address: null,
      balance: 0,
      error: null,
      hasCredentials: false,
      legacySafeAvailable: false,
      state: "disconnected",
      walletMode: "deposit",
    } as TradingContext;
    const listeners: Array<(ctx: TradingContext) => void> = [];
    const unsubscribers: Array<ReturnType<typeof vi.fn>> = [];
    vi.spyOn(TradingService, "getContext").mockReturnValue(context);
    vi.spyOn(TradingService, "onStateChange").mockImplementation((listener) => {
      listeners.push(listener);
      const unsubscribe = vi.fn();
      unsubscribers.push(unsubscribe);
      return unsubscribe;
    });

    const el = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      className?: string,
      text?: string
    ): HTMLElementTagNameMap[K] => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const elHtml = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      className: string,
      html: string
    ): HTMLElementTagNameMap[K] => {
      const node = el(tag, className);
      node.innerHTML = html;
      return node;
    };
    const setupViewUi = {
      el,
      buildInlineError: () => document.createElement("div"),
      setButtonLoading: () => {},
      rerender: () => {},
    };
    deposit.configureDepositView({
      el,
      elHtml,
      rerender: deposit.renderInlineDeposit,
      trackAnalytics: () => {},
      buildInlineError: setupViewUi.buildInlineError,
      setButtonLoading: setupViewUi.setButtonLoading,
      setupViewUi,
      icons: {
        alert: "",
        back: "",
        check: "",
        refresh: "",
        shield: "",
        wallet: "",
      },
    });

    const hostA = document.createElement("div");
    const hostB = document.createElement("div");
    document.body.append(hostA, hostB);
    const closeA = vi.fn();
    const closeB = vi.fn();
    const opts = { outcomeName: "Yes" } as never;

    deposit.mountInlineDeposit({
      host: hostA,
      opts,
      onClose: closeA,
      hidePanel: () => {},
    });
    deposit.mountInlineDeposit({
      host: hostB,
      opts,
      onClose: closeB,
      hidePanel: () => {},
    });

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(unsubscribers[0]).toHaveBeenCalledTimes(1);
    listeners[0](context);
    expect(panelState.inlineDepositHost).toBe(hostB);
    expect(closeB).not.toHaveBeenCalled();

    deposit.closeInlineDeposit(hostB);
    deposit.closeInlineDeposit(hostB);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(unsubscribers[1]).toHaveBeenCalledTimes(1);
    expect(panelState.inlineDepositHost).toBeNull();
  });
});
