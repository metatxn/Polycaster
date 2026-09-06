// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendRuntimeMessage } from "../../src/sidepanel/messaging";
import { createPortfolioSetup } from "../../src/sidepanel/setup";

vi.mock("../../src/sidepanel/messaging", async (original) => ({
  ...(await original<object>()),
  sendRuntimeMessage: vi.fn(),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

function mount() {
  const root = document.createElement("div");
  root.innerHTML =
    "<div data-sidepanel-portfolio><button data-connect-portfolio-walletconnect>Mobile wallet</button></div>";
  const controller = createPortfolioSetup({
    root,
    getPortfolioData: () => null,
    reloadPortfolio: async () => {},
    renderPortfolio: () => {},
    invalidatePortfolio: () => {},
    resetFunding: () => {},
    openFunding: () => {},
  });
  root.addEventListener("click", (event) => controller.handleClick(event));
  return { root, controller };
}

describe("WalletConnect retry UI", () => {
  it("accepts an immediate reconnect after Back and cancels on teardown", async () => {
    vi.useFakeTimers();
    vi.mocked(sendRuntimeMessage).mockImplementation((msg) =>
      msg.type === "KNOWW_CONNECT_PORTFOLIO_WALLET"
        ? new Promise(() => {})
        : Promise.resolve({ ok: true })
    );
    const { root, controller } = mount();
    root.querySelector<HTMLButtonElement>("button")?.click();
    expect(controller.isBusy()).toBe(true);
    root
      .querySelector<HTMLButtonElement>("[data-walletconnect-cancel]")
      ?.click();
    expect(controller.isBusy()).toBe(false);
    root
      .querySelector<HTMLButtonElement>(
        "[data-connect-portfolio-walletconnect]"
      )
      ?.click();
    expect(controller.isBusy()).toBe(true);
    expect(
      vi
        .mocked(sendRuntimeMessage)
        .mock.calls.filter(
          ([msg]) => msg.type === "KNOWW_CONNECT_PORTFOLIO_WALLET"
        )
    ).toHaveLength(2);
    controller.reset();
    expect(
      vi
        .mocked(sendRuntimeMessage)
        .mock.calls.filter(
          ([msg]) => msg.type === "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT"
        )
    ).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10000);
    expect(controller.isBusy()).toBe(false);
  });
  it("shows Retry after a failed start and starts another attempt", async () => {
    vi.useFakeTimers();
    vi.mocked(sendRuntimeMessage).mockResolvedValue({ ok: false });
    const { root, controller } = mount();
    root.querySelector<HTMLButtonElement>("button")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.textContent).toContain("Could not start");
    expect(controller.isBusy()).toBe(false);
    const retry = root.querySelector<HTMLButtonElement>(
      "[data-walletconnect-retry]"
    );
    expect(retry).not.toBeNull();
    retry?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      vi
        .mocked(sendRuntimeMessage)
        .mock.calls.filter(
          ([msg]) => msg.type === "KNOWW_CONNECT_PORTFOLIO_WALLET"
        )
    ).toHaveLength(2);
  });
  it("replaces a stalled start with an error and ignores its late response", async () => {
    vi.useFakeTimers();
    let resolveStart!: (value: { ok: boolean }) => void;
    vi.mocked(sendRuntimeMessage).mockImplementation((msg) =>
      msg.type === "KNOWW_CONNECT_PORTFOLIO_WALLET"
        ? new Promise((resolve) => {
            resolveStart = resolve;
          })
        : Promise.resolve({ ok: true })
    );
    const { root, controller } = mount();
    root.querySelector<HTMLButtonElement>("button")?.click();
    await vi.advanceTimersByTimeAsync(10000);
    expect(root.textContent).toContain("timed out");
    expect(controller.isBusy()).toBe(false);
    expect(root.querySelector("[data-walletconnect-retry]")).not.toBeNull();
    resolveStart({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.textContent).toContain("timed out");
  });
});
