// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Decimal } from "decimal.js";
import { describe, expect, test, vi } from "vitest";

declare const process: { cwd(): string };

const readSource = (path: string): string =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("sidepanel decomposition", () => {
  test("shared helpers preserve escaping, Decimal money, and view callback", async () => {
    const shared = await import("../../src/sidepanel/shared");
    expect(shared.escapeHtml('<img src=x onerror="x">')).toBe(
      "&lt;img src=x onerror=&quot;x&quot;&gt;"
    );
    expect(shared.formatDecimalMoney(new Decimal("1.005"))).toBe("$1.01");
    expect(shared.normalizePortfolioWalletMode("safe")).toBe("safe");
    expect(shared.normalizePortfolioWalletMode("bad")).toBe("deposit");

    const root = document.createElement("div");
    root.innerHTML = `
      <div id="knoww-notification-stack"></div>
      <button data-sidepanel-view="markets"></button>
      <button data-sidepanel-view="portfolio"></button>
      <button id="knoww-search-toggle"></button>
      <div data-sidepanel-markets></div>
      <div data-sidepanel-portfolio hidden></div>`;
    const selected = vi.fn();
    shared.setSidepanelView(root, "portfolio", selected);
    expect(
      root.querySelector<HTMLElement>("[data-sidepanel-markets]")?.hidden
    ).toBe(true);
    expect(
      root.querySelector<HTMLElement>("[data-sidepanel-portfolio]")?.hidden
    ).toBe(false);
    expect(selected).toHaveBeenCalledTimes(1);
  });

  test("messaging is inert until installed and removes requested view before routing", async () => {
    const source = readSource("src/sidepanel/messaging.ts");
    expect(source.match(/onMessage\.addListener/g)).toHaveLength(1);
    assert.doesNotMatch(source, /installSidepanelMessageListener\([^\n{]*\);/);
    const messaging = await import("../../src/sidepanel/messaging");
    const callbackOrder: string[] = [];
    let listener:
      | ((message: { type?: unknown; view?: unknown }) => boolean)
      | null = null;
    const runtime = {
      lastError: undefined,
      onMessage: {
        addListener(callback: typeof listener) {
          listener = callback;
        },
        removeListener(callback: typeof listener) {
          expect(callback).toBe(listener);
          listener = null;
        },
      },
    };
    const storage = {
      remove(_key: string, callback: () => void) {
        callbackOrder.push("remove");
        callback();
      },
    };
    const handlers = {
      onCredentialsUpdated: vi.fn(),
      onSessionDisconnected: vi.fn(),
      onShowView: () => callbackOrder.push("show"),
      onWalletConnected: vi.fn(),
    };
    const dispose = messaging.installSidepanelMessageListener(handlers, {
      runtime: runtime as never,
      sessionStorage: storage as never,
    });
    expect(
      listener?.({
        type: "KNOWW_SHOW_EXTENSION_SIDEPANEL_VIEW",
        view: "portfolio",
      })
    ).toBe(false);
    expect(callbackOrder).toEqual(["remove", "show"]);
    expect(listener?.({ type: "trading:session-disconnected" })).toBe(false);
    expect(listener?.({ type: "trading:wallet-connected" })).toBe(false);
    expect(listener?.({ type: "trading:credentials-updated" })).toBe(false);
    expect(handlers.onSessionDisconnected).toHaveBeenCalledTimes(1);
    expect(handlers.onWalletConnected).toHaveBeenCalledTimes(1);
    expect(handlers.onCredentialsUpdated).toHaveBeenCalledTimes(1);
    dispose();
    expect(listener).toBeNull();
  });

  test("runtime messaging preserves lastError, null-response, and synchronous throw semantics", async () => {
    const { sendRuntimeMessage } = await import(
      "../../src/sidepanel/messaging"
    );
    const noResponse = await sendRuntimeMessage({}, {
      lastError: undefined,
      sendMessage(_message, callback) {
        callback(undefined);
      },
    } as never);
    expect(noResponse).toEqual({ ok: true });

    const lastError = await sendRuntimeMessage({}, {
      lastError: { message: "worker stopped" },
      sendMessage(_message, callback) {
        callback(undefined);
      },
    } as never);
    expect(lastError).toEqual({ ok: false, error: "worker stopped" });

    await expect(
      sendRuntimeMessage({}, {
        lastError: undefined,
        sendMessage() {
          throw new Error("sync failure");
        },
      } as never)
    ).rejects.toThrow("sync failure");
  });

  test("stored wallet mode falls back to deposit when Chrome reports an error", async () => {
    const messaging = await import("../../src/sidepanel/messaging");
    const mode = await messaging.readStoredWalletMode(
      "0xABC",
      {
        get(_key, callback) {
          callback({
            [messaging.getWalletModeStorageKey("0xABC")]: "safe",
          });
        },
        set: vi.fn(),
      } as never,
      { lastError: { message: "storage unavailable" } } as never
    );
    expect(mode).toBe("deposit");
  });

  test("markets render escaped snapshot sections in active-trending-seen order", async () => {
    const markets = await import("../../src/sidepanel/markets");
    const html = markets.renderSnapshotSections({
      active: [
        {
          id: "a",
          title: "<Active>",
          source: "x",
          imageUrl: "",
          category: "",
          volume: "",
          priceCents: "50",
          priceSideLabel: "Yes",
          status: "active",
        },
      ],
      trending: [],
      seen: [],
    });
    expect(html).toContain("&lt;Active&gt;");
    expect(html.indexOf("Active now")).toBeLessThan(
      html.indexOf("Seen earlier")
    );
    expect(markets.SEARCH_DEBOUNCE_MS).toBe(300);
    expect(markets.SNAPSHOT_REFRESH_INTERVAL_MS).toBe(5_000);
  });

  test("markets reject stale searches, own one interval, and switch surface before closing", async () => {
    vi.useFakeTimers();
    const markets = await import("../../src/sidepanel/markets");
    const root = document.createElement("div");
    root.innerHTML = `<div id="knoww-notification-stack">${markets.renderMarketsHeaderControls()}${markets.renderMarketsSurface()}${markets.renderMarketsFooter()}</div>`;
    document.body.appendChild(root);
    const pending = new Map<
      string,
      (value: { ok: boolean; data: { data: unknown[] } }) => void
    >();
    const order: string[] = [];
    const handle = markets.installMarkets(root, {
      async send(message) {
        order.push(String(message.type));
        if (message.type === "KNOWW_SEARCH_NOTIFICATION_MARKETS") {
          return new Promise((resolve) => {
            pending.set(String(message.query), resolve as never);
          });
        }
        return { ok: true, data: { data: {} } };
      },
      closeWindow() {
        order.push("close");
      },
      open: vi.fn(),
    });
    root.addEventListener("click", (event) => handle.handleClick(event));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);

    const minimize = root.querySelector<HTMLButtonElement>(
      "#knoww-stack-minimize"
    );
    minimize?.click();
    expect(minimize?.title).toBe("Expand");
    expect(minimize?.getAttribute("aria-label")).toBe("Expand");
    minimize?.click();
    expect(minimize?.title).toBe("Minimize");
    expect(minimize?.getAttribute("aria-label")).toBe("Minimize");

    const input = root.querySelector<HTMLInputElement>("#knoww-search-input");
    expect(input).not.toBeNull();
    if (!input) throw new Error("missing search input");
    input.value = "ab";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(300);
    input.value = "abc";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(300);
    pending.get("abc")?.({
      ok: true,
      data: {
        data: [
          {
            id: "new",
            title: "Newest",
            source: "x",
            imageUrl: "",
            category: "",
            volume: "",
            priceCents: "",
            priceSideLabel: "",
            status: "trending",
          },
        ],
      },
    });
    await Promise.resolve();
    pending.get("ab")?.({
      ok: true,
      data: {
        data: [
          {
            id: "old",
            title: "Stale",
            source: "x",
            imageUrl: "",
            category: "",
            volume: "",
            priceCents: "",
            priceSideLabel: "",
            status: "trending",
          },
        ],
      },
    });
    await Promise.resolve();
    expect(root.textContent).toContain("Newest");
    expect(root.textContent).not.toContain("Stale");

    order.length = 0;
    root.querySelector<HTMLButtonElement>(".knoww-stack-popout")?.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([
      "KNOWW_SET_NOTIFICATION_PANEL_SURFACE",
      "KNOWW_SET_NOTIFICATION_STACK_VISIBILITY",
      "close",
    ]);
    handle.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  test("entry owns one listener and delegates shared, messaging, and markets modules", () => {
    const entry = readSource("src/sidepanel.ts");
    for (const module of ["shared", "messaging", "markets"]) {
      assert.match(entry, new RegExp(`from ["']\\./sidepanel/${module}["']`));
      const child = readSource(`src/sidepanel/${module}.ts`);
      assert.doesNotMatch(child, /from ["']\.\.\/sidepanel["']/);
    }
    assert.doesNotMatch(entry, /chrome\.runtime\.onMessage\.addListener/);
    assert.match(entry, /installSidepanelMessageListener/);
  });

  test("Task 16 entry is a thin composer with single-owner business modules", () => {
    const entry = readSource("src/sidepanel.ts");
    const setup = readSource("src/sidepanel/setup.ts");
    const portfolio = readSource("src/sidepanel/portfolio.ts");
    const funding = readSource("src/sidepanel/funding-ui.ts");
    expect(entry.split("\n").length).toBeLessThan(1_000);
    for (const [name, source] of [
      ["setup", setup],
      ["portfolio", portfolio],
      ["funding-ui", funding],
    ] as const) {
      assert.match(entry, new RegExp(`from ["']\\./sidepanel/${name}["']`));
      assert.doesNotMatch(source, /from ["']\.\.\/sidepanel["']/);
      assert.doesNotMatch(source, /export\s+let\s/);
    }
    for (const anchor of [
      "createFundingController",
      "createSidepanelFundingGateway",
      "requestWithdrawRequote",
    ]) {
      assert.match(funding, new RegExp(anchor));
      assert.doesNotMatch(entry, new RegExp(anchor));
      assert.doesNotMatch(portfolio, new RegExp(anchor));
      assert.doesNotMatch(setup, new RegExp(anchor));
    }
    for (const anchor of [
      "portfolioSetupConsecutiveDegradedReads",
      "connectPortfolioWalletConnect",
      "enablePortfolioTrading",
    ]) {
      assert.match(setup, new RegExp(anchor));
      assert.doesNotMatch(entry, new RegExp(anchor));
      assert.doesNotMatch(portfolio, new RegExp(anchor));
      assert.doesNotMatch(funding, new RegExp(anchor));
    }
    for (const anchor of [
      "portfolioLoadGeneration",
      "fetchPortfolioData",
      "renderCompactPositions",
    ]) {
      assert.match(portfolio, new RegExp(anchor));
      assert.doesNotMatch(entry, new RegExp(anchor));
      assert.doesNotMatch(setup, new RegExp(anchor));
      assert.doesNotMatch(funding, new RegExp(anchor));
    }
    assert.match(portfolio, /PORTFOLIO_STYLES/);
    assert.match(funding, /FUNDING_UI_STYLES/);
    assert.match(setup, /SETUP_STYLES/);
    for (const factory of [
      "createPortfolioSetup",
      "createFundingUi",
      "createPortfolioSidepanel",
      "installMarkets",
      "installSidepanelMessageListener",
    ]) {
      assert.match(entry, new RegExp(factory));
    }
    for (const siblingFactory of [
      "createPortfolioSetup",
      "createFundingUi",
      "installMarkets",
      "installSidepanelMessageListener",
    ]) {
      assert.doesNotMatch(portfolio, new RegExp(siblingFactory));
    }
    assert.doesNotMatch(portfolio, /root\.addEventListener\(/);
    assert.match(entry, /const onRootClick/);
    assert.match(entry, /const onRootChange/);
    assert.match(entry, /const onRootInput/);
  });
});
