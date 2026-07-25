// @vitest-environment jsdom

import { describe, expect, test, vi } from "vitest";
import type { FundingUiHandle } from "../../src/sidepanel/funding-ui";
import type { TradingWalletMode } from "../../src/sidepanel/shared";

const OWNER = `0x${"a".repeat(40)}`;

interface Harness {
  handle: FundingUiHandle;
  container: HTMLElement;
  resolveMode(mode: TradingWalletMode): void;
  rejectMode(error: Error): void;
  renderPortfolio: ReturnType<typeof vi.fn>;
  probeCalls(): number;
}

/** Wires the funding UI over a bare portfolio container with a manually
 * settled wallet-mode probe, so the async window between the open click and
 * START is directly observable. */
async function mount(): Promise<Harness> {
  vi.stubGlobal("__DEV_MODE__", false);
  const { createFundingUi } = await import("../../src/sidepanel/funding-ui");
  const root = document.createElement("div");
  root.innerHTML = `<div data-sidepanel-portfolio></div>`;
  document.body.replaceChildren(root);
  const container = root.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  ) as HTMLElement;

  let settle: {
    resolve(mode: TradingWalletMode): void;
    reject(error: Error): void;
  } | null = null;
  const renderPortfolio = vi.fn(() => {
    container.innerHTML = `<div data-portfolio-body></div>`;
  });
  const resolvePreferredWalletMode = vi.fn(
    () =>
      new Promise<TradingWalletMode>((resolve, reject) => {
        settle = { resolve, reject };
      })
  );

  const handle = createFundingUi({
    root,
    getPortfolioData: () => ({
      address: OWNER,
      ownerAddress: OWNER,
      cashBalance: 12.34,
    }),
    reloadPortfolio: async () => {},
    renderPortfolio,
    resolvePreferredWalletMode,
    reauthSession: async () => ({ ok: true }),
  });

  return {
    handle,
    container,
    resolveMode: (mode) => settle?.resolve(mode),
    rejectMode: (error) => settle?.reject(error),
    renderPortfolio,
    probeCalls: () => resolvePreferredWalletMode.mock.calls.length,
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("funding UI open path", () => {
  test("renders the deposit method screen once the wallet-mode probe resolves", async () => {
    const { handle, container, resolveMode } = await mount();
    handle.open("deposit");
    expect(container.querySelector("[data-fund-back]")).not.toBeNull();

    resolveMode("safe");
    await flush();

    expect(container.querySelector("[data-deposit-method]")).not.toBeNull();
    handle.dispose();
  });

  test("a failed wallet-mode probe surfaces a retryable screen instead of a permanent loader", async () => {
    const { handle, container, rejectMode } = await mount();
    handle.open("deposit");
    rejectMode(new Error("offscreen unreachable"));
    await flush();

    // Escape routes: back to the portfolio, or retry the open.
    expect(container.querySelector("[data-fund-back]")).not.toBeNull();
    expect(
      container.querySelector('[data-portfolio-fund="deposit"]')
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Loading…");
    handle.dispose();
  });

  test("the probe window counts as open so a portfolio refresh can't wipe it", async () => {
    const { handle } = await mount();
    expect(handle.isOpen()).toBe(false);
    handle.open("deposit");
    expect(handle.isOpen()).toBe(true);
    handle.dispose();
  });

  test("reopening during a pending probe reuses it instead of spawning another", async () => {
    const { handle, container, resolveMode, probeCalls } = await mount();
    handle.open("deposit");
    handle.open("deposit"); // e.g. Retry while the first probe is still pending
    expect(probeCalls()).toBe(1);

    resolveMode("safe");
    await flush();

    expect(container.querySelector("[data-deposit-method]")).not.toBeNull();
    handle.dispose();
  });

  test("a probe resolving after the screen was externally replaced releases the view", async () => {
    const { handle, container, resolveMode } = await mount();
    handle.open("deposit");
    // Simulate a foreign render wiping the probe screen (e.g. a code path
    // that bypasses the loadPortfolio guard).
    container.innerHTML = `<div data-portfolio-body></div>`;

    resolveMode("safe");
    await flush();

    expect(handle.isOpen()).toBe(false);
    expect(container.querySelector("[data-deposit-method]")).toBeNull();
    expect(container.querySelector("[data-portfolio-body]")).not.toBeNull();
    handle.dispose();
  });

  test("closing during the probe discards the late START", async () => {
    const { handle, container, resolveMode, renderPortfolio } = await mount();
    handle.open("deposit");
    handle.close();
    expect(renderPortfolio).toHaveBeenCalledTimes(1);

    resolveMode("safe");
    await flush();

    expect(container.querySelector("[data-deposit-method]")).toBeNull();
    expect(container.querySelector("[data-portfolio-body]")).not.toBeNull();
    handle.dispose();
  });
});
