import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const walletAddress = "0x0000000000000000000000000000000000000001";
const storageKey = `knoww_trading_wallet_mode_${walletAddress.toLowerCase()}`;

const wagmiState = vi.hoisted(() => ({
  address: "0x0000000000000000000000000000000000000001",
}));

const rpcMock = vi.hoisted(() => ({
  checkIsDeployed: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConnection: () => ({
    address: wagmiState.address,
  }),
}));

vi.mock("@/lib/rpc", () => rpcMock);

import { useTradingWalletMode } from "./use-trading-wallet-mode";

describe("useTradingWalletMode", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    wagmiState.address = walletAddress;
    rpcMock.checkIsDeployed.mockResolvedValue(true);
  });

  it("does not overwrite an explicit stored mode when a legacy Safe is detected", async () => {
    localStorage.setItem(storageKey, "deposit");

    const { result } = renderHook(() => useTradingWalletMode());

    await waitFor(() =>
      expect(result.current.isCheckingLegacySafe).toBe(false)
    );

    expect(result.current.hasLegacySafe).toBe(true);
    expect(result.current.mode).toBe("safe");
    expect(localStorage.getItem(storageKey)).toBe("deposit");
  });

  it("initializes legacy Safe mode when no explicit mode was stored", async () => {
    const { result } = renderHook(() => useTradingWalletMode());

    await waitFor(() =>
      expect(result.current.isCheckingLegacySafe).toBe(false)
    );

    expect(result.current.hasLegacySafe).toBe(true);
    expect(result.current.mode).toBe("safe");
    expect(localStorage.getItem(storageKey)).toBe("safe");
  });

  it("honors a stored safe mode synchronously before the legacy check resolves", () => {
    localStorage.setItem(storageKey, "safe");
    rpcMock.checkIsDeployed.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useTradingWalletMode());

    expect(result.current.mode).toBe("safe");
  });

  it("keeps safe mode when the legacy Safe check fails but safe was stored", async () => {
    localStorage.setItem(storageKey, "safe");
    // checkIsDeployed swallows RPC failures into `false` — a stored "safe"
    // (only ever written after a successful detection) must survive it.
    rpcMock.checkIsDeployed.mockResolvedValue(false);

    const { result } = renderHook(() => useTradingWalletMode());

    await waitFor(() =>
      expect(result.current.isCheckingLegacySafe).toBe(false)
    );

    expect(result.current.mode).toBe("safe");
    expect(result.current.hasLegacySafe).toBe(true);
    expect(localStorage.getItem(storageKey)).toBe("safe");
  });
});
