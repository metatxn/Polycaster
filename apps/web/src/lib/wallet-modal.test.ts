import { beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.fn(async () => undefined);
const close = vi.fn(async () => undefined);
const createAppKit = vi.fn(() => ({ open, close }));

vi.mock("@reown/appkit/react", () => ({ createAppKit }));
vi.mock("@/config", () => ({
  networks: [{ id: 137 }],
  projectId: "test-project-id",
  wagmiAdapter: { wagmiConfig: {} },
}));
vi.mock("@/lib/chains", () => ({ polygon: { id: 137 } }));

import {
  closeWalletModal,
  openWalletModal,
  openWalletModalStrict,
} from "./wallet-modal";

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

// NOTE: wallet-modal keeps a module-level singleton (modalPromise) that
// beforeEach does NOT reset — these tests depend on their order: the
// close-before-open no-op assertion is only meaningful while the module is
// still cold, so it must run first.
describe("wallet-modal", () => {
  beforeEach(() => {
    createAppKit.mockClear();
    open.mockClear();
    close.mockClear();
  });

  it("close before any open does not boot AppKit", async () => {
    await closeWalletModal();
    expect(createAppKit).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("initializes AppKit once across multiple opens", async () => {
    await openWalletModal();
    await openWalletModal();
    expect(createAppKit).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("close after open closes the modal", async () => {
    await openWalletModal();
    await closeWalletModal();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("preload boots AppKit without opening (fresh module)", async () => {
    vi.resetModules();
    const fresh = await import("./wallet-modal");
    fresh.preloadWalletModal();
    await flushAsync();
    expect(createAppKit).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("openWalletModalStrict rejects when the modal open fails", async () => {
    open.mockRejectedValueOnce(new Error("boom"));
    await expect(openWalletModalStrict()).rejects.toThrow("boom");
  });
});
