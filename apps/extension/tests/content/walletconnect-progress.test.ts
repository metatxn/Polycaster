import { describe, expect, it, vi } from "vitest";
import {
  walletConnectProgress,
  withWalletConnectTimeout,
} from "../../src/sidepanel/walletconnect-progress";

describe("WalletConnect progress", () => {
  it("distinguishes initialization, QR creation, scanning, and approval", () => {
    expect(walletConnectProgress("initializing", false)).toContain("Preparing");
    expect(walletConnectProgress("pairing", false)).toContain("Generating QR");
    expect(walletConnectProgress("pairing", true)).toContain("Scan the QR");
    expect(walletConnectProgress("connected", false)).toContain("approval");
  });
  it("bounds a request even when the underlying promise never settles", async () => {
    vi.useFakeTimers();
    try {
      const pending = withWalletConnectTimeout(new Promise(() => {}), 10000);
      const assertion = expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10000);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("clears the timeout after success or failure", async () => {
    vi.useFakeTimers();
    try {
      await expect(
        withWalletConnectTimeout(Promise.resolve("ready"), 10000)
      ).resolves.toBe("ready");
      await expect(
        withWalletConnectTimeout(Promise.reject(new Error("offline")), 10000)
      ).rejects.toThrow("offline");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
