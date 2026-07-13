// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import type { SetupPortfolioData } from "../../src/sidepanel/setup";

const setupData = (
  ownerAddress: string,
  complete: boolean
): SetupPortfolioData => ({
  address: `${ownerAddress}-proxy`,
  ownerAddress,
  walletMode: "deposit",
  hasTradingWallet: complete,
  hasTradingCredentials: complete,
  hasApproval: complete,
  approvalReadStatus: "complete",
  cashBalance: complete ? 10 : 0,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "chrome");
});

describe("Task 16 review regressions", () => {
  test("persisted completion stays true when the live flow is complete", async () => {
    const writes: Array<Record<string, unknown>> = [];
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: {
            get(
              key: string,
              callback: (result: Record<string, unknown>) => void
            ) {
              callback({
                [key]: key.includes("setup-complete"),
              });
            },
            set(value: Record<string, unknown>, callback: () => void) {
              writes.push(value);
              callback();
            },
          },
        },
      },
    });
    const { createPortfolioSetup } = await import("../../src/sidepanel/setup");
    const setup = createPortfolioSetup({
      root: document.createElement("div"),
      getPortfolioData: () => null,
      reloadPortfolio: async () => {},
      renderPortfolio: vi.fn(),
      invalidatePortfolio: vi.fn(),
      resetFunding: vi.fn(),
      openFunding: vi.fn(),
    });

    await expect(
      setup.reconcileLoadedData(setupData("0xccc", true), () => true)
    ).resolves.toBe(true);
    expect(writes).toEqual([]);
    expect(setup.renderSurface(setupData("0xccc", true)).mode).toBe("complete");
  });

  test("newer same-owner incomplete reconciliation corrects a delayed stale mark", async () => {
    const storage = new Map<string, unknown>();
    let resolveDelayedMark: (() => void) | null = null;
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: {
            get(
              key: string,
              callback: (result: Record<string, unknown>) => void
            ) {
              callback({ [key]: storage.get(key) });
            },
            set(value: Record<string, unknown>, callback: () => void) {
              const [key, next] = Object.entries(value)[0] ?? [];
              if (next === true && !resolveDelayedMark) {
                resolveDelayedMark = () => {
                  storage.set(key, next);
                  callback();
                };
                return;
              }
              storage.set(key, next);
              callback();
            },
          },
        },
      },
    });
    const { createPortfolioSetup } = await import("../../src/sidepanel/setup");
    const setup = createPortfolioSetup({
      root: document.createElement("div"),
      getPortfolioData: () => null,
      reloadPortfolio: async () => {},
      renderPortfolio: vi.fn(),
      invalidatePortfolio: vi.fn(),
      resetFunding: vi.fn(),
      openFunding: vi.fn(),
    });

    const staleMark = setup.reconcileLoadedData(
      setupData("0xddd", true),
      () => true
    );
    await vi.waitFor(() => expect(resolveDelayedMark).not.toBeNull());
    const newerIncomplete = setup.reconcileLoadedData(
      setupData("0xddd", false),
      () => true
    );
    resolveDelayedMark?.();

    await expect(staleMark).resolves.toBe(false);
    await expect(newerIncomplete).resolves.toBe(true);
    expect(storage.get("knoww:setup-complete:0xddd")).toBe(false);
    expect(setup.renderSurface(setupData("0xddd", false)).mode).not.toBe(
      "complete"
    );
  });

  test("stale setup reconciliation cannot mutate or durably overwrite the newer owner", async () => {
    const pendingA: Array<(result: Record<string, unknown>) => void> = [];
    const writes: Array<Record<string, unknown>> = [];
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: {
            get(
              key: string,
              callback: (result: Record<string, unknown>) => void
            ) {
              if (key.toLowerCase().includes("0xaaa")) {
                pendingA.push(callback);
                return;
              }
              callback({ [key]: false });
            },
            set(value: Record<string, unknown>, callback: () => void) {
              writes.push(value);
              callback();
            },
          },
        },
      },
    });

    const { createPortfolioSetup } = await import("../../src/sidepanel/setup");
    const root = document.createElement("div");
    let currentOwner = "0xaaa";
    const setup = createPortfolioSetup({
      root,
      getPortfolioData: () => null,
      reloadPortfolio: async () => {},
      renderPortfolio: vi.fn(),
      invalidatePortfolio: vi.fn(),
      resetFunding: vi.fn(),
      openFunding: vi.fn(),
    });

    const stale = setup.reconcileLoadedData(
      setupData("0xaaa", false),
      () => currentOwner === "0xaaa"
    );
    await vi.waitFor(() => expect(pendingA).toHaveLength(2));

    currentOwner = "0xbbb";
    const newer = setup.reconcileLoadedData(
      setupData("0xbbb", true),
      () => currentOwner === "0xbbb"
    );

    for (const resolve of pendingA) {
      resolve({
        "knoww:setup-dismissed:0xaaa": false,
        "knoww:setup-complete:0xaaa": true,
      });
    }
    await expect(stale).resolves.toBe(false);
    await expect(newer).resolves.toBe(true);

    expect(writes).toEqual([{ "knoww:setup-complete:0xbbb": true }]);
    expect(setup.renderSurface(setupData("0xbbb", true)).mode).toBe("complete");
  });

  test("entry owns one staged root dispatcher set and disposes it before restart", async () => {
    vi.stubGlobal("__DEV_MODE__", false);
    const { installSidepanelRootDispatchers } = await import(
      "../../src/sidepanel"
    );
    const root = document.createElement("div");
    root.innerHTML = `
      <button data-market>Market</button>
      <button class="knoww-stack-settings">Settings</button>
      <button data-sidepanel-view="portfolio">Portfolio</button>
      <button data-portfolio>Portfolio action</button>
      <button data-setup>Setup action</button>
      <button data-funding>Funding action</button>`;
    const add = vi.spyOn(root, "addEventListener");
    const remove = vi.spyOn(root, "removeEventListener");
    const order: string[] = [];
    const handlers = {
      markets: {
        handleClick(event: Event) {
          order.push("markets");
          return Boolean((event.target as Element).closest("[data-market]"));
        },
      },
      funding: {
        handleClick: (event: Event) => {
          order.push("funding");
          return Boolean((event.target as Element).closest("[data-funding]"));
        },
        handleChange: () => {
          order.push("funding-change");
          return false;
        },
        handleInput: () => {
          order.push("funding-input");
          return false;
        },
      },
      setup: {
        handleClick: (event: Event) => {
          order.push("setup");
          return Boolean((event.target as Element).closest("[data-setup]"));
        },
      },
      portfolio: {
        handleClick: (event: Event) => {
          order.push("portfolio");
          return Boolean((event.target as Element).closest("[data-portfolio]"));
        },
        handleChange: () => {
          order.push("portfolio-change");
          return false;
        },
        handleInput: () => {
          order.push("portfolio-input");
          return false;
        },
      },
      onSettings: () => order.push("settings"),
      onView: (view: string) => order.push(`view:${view}`),
    };

    const dispose = installSidepanelRootDispatchers(root, handlers);
    expect(add.mock.calls.map(([type]) => type)).toEqual([
      "click",
      "change",
      "input",
    ]);

    root.querySelector<HTMLElement>("[data-market]")?.click();
    expect(order.splice(0)).toEqual(["markets"]);
    root.querySelector<HTMLElement>(".knoww-stack-settings")?.click();
    expect(order.splice(0)).toEqual(["markets", "portfolio", "settings"]);
    root.querySelector<HTMLElement>("[data-sidepanel-view]")?.click();
    expect(order.splice(0)).toEqual(["markets", "portfolio", "view:portfolio"]);
    root.querySelector<HTMLElement>("[data-portfolio]")?.click();
    expect(order.splice(0)).toEqual(["markets", "portfolio"]);
    root.querySelector<HTMLElement>("[data-setup]")?.click();
    expect(order.splice(0)).toEqual(["markets", "portfolio", "setup"]);
    root.querySelector<HTMLElement>("[data-funding]")?.click();
    expect(order.splice(0)).toEqual([
      "markets",
      "portfolio",
      "setup",
      "funding",
    ]);
    root.dispatchEvent(new Event("change", { bubbles: true }));
    root.dispatchEvent(new Event("input", { bubbles: true }));
    expect(order.splice(0)).toEqual([
      "funding-change",
      "portfolio-change",
      "funding-input",
      "portfolio-input",
    ]);

    dispose();
    expect(remove.mock.calls.map(([type]) => type)).toEqual([
      "click",
      "change",
      "input",
    ]);
    root.querySelector<HTMLElement>("[data-portfolio]")?.click();
    expect(order).toEqual([]);

    const disposeRestart = installSidepanelRootDispatchers(root, handlers);
    root.querySelector<HTMLElement>("[data-funding]")?.click();
    expect(order).toEqual(["markets", "portfolio", "setup", "funding"]);
    disposeRestart();
  });

  test("settings routing and disposal clear a real armed portfolio cancel", async () => {
    vi.stubGlobal("__DEV_MODE__", false);
    const { installSidepanelRootDispatchers } = await import(
      "../../src/sidepanel"
    );
    const { createPortfolioSidepanel } = await import(
      "../../src/sidepanel/portfolio"
    );
    const root = document.createElement("div");
    root.innerHTML = `
      <button data-cancel-order data-order-id="order-1" data-owner-address="0xabc">
        <span data-cancel-label>Cancel</span>
      </button>
      <button class="knoww-stack-settings">Settings</button>`;
    const portfolio = createPortfolioSidepanel(root, {
      funding: {} as never,
      setup: {} as never,
    });
    const settings = vi.fn();
    const disposeDispatchers = installSidepanelRootDispatchers(root, {
      markets: { handleClick: () => false },
      funding: { handleClick: () => false },
      setup: { handleClick: () => false },
      portfolio,
      onSettings: settings,
      onView: vi.fn(),
    });
    const cancel = root.querySelector<HTMLButtonElement>("[data-cancel-order]");
    if (!cancel) throw new Error("Missing cancel button");

    cancel.click();
    expect(cancel.classList.contains("is-armed")).toBe(true);
    root.querySelector<HTMLElement>(".knoww-stack-settings")?.click();
    expect(settings).toHaveBeenCalledTimes(1);
    expect(cancel.classList.contains("is-armed")).toBe(false);

    cancel.click();
    expect(cancel.classList.contains("is-armed")).toBe(true);
    portfolio.dispose();
    expect(cancel.classList.contains("is-armed")).toBe(false);
    expect(cancel.querySelector("[data-cancel-label]")?.textContent).toBe(
      "Cancel"
    );
    disposeDispatchers();
  });
});
