import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const walletClient = { request: vi.fn() };
const ownerAddress = "0x0000000000000000000000000000000000000001";
const proxyAddress = "0x0000000000000000000000000000000000000002";
const conditionId =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

const publicClientState = vi.hoisted(() => ({
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

const relayerState = vi.hoisted(() => ({
  executeViaDepositWallet: vi.fn(),
  executeViaRelayer: vi.fn(),
}));

const walletModeState = vi.hoisted(() => ({
  isEoaMode: false,
  mode: "deposit",
}));

vi.mock("@knoww/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("wagmi", () => ({
  useConnection: () => ({
    address: ownerAddress,
    isConnected: true,
  }),
  useWalletClient: () => ({
    data: walletClient,
  }),
}));

vi.mock("viem", async (importActual) => {
  const actual = await importActual<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => publicClientState),
    http: vi.fn(),
  };
});

vi.mock("@/lib/chains", () => ({
  polygon: { id: 137, name: "Polygon" },
}));

vi.mock("@/lib/rpc", () => ({
  getPublicClient: vi.fn(() => publicClientState),
  getRpcUrl: vi.fn(() => "https://polygon.example"),
}));

vi.mock("@/lib/relayer-client", () => relayerState);

vi.mock("./use-trading-wallet-mode", () => ({
  useTradingWalletMode: () => walletModeState,
}));

import { useCtfOperations } from "./use-ctf-operations";

describe("useCtfOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletModeState.isEoaMode = false;
    walletModeState.mode = "deposit";
    publicClientState.readContract.mockResolvedValue(false);
    relayerState.executeViaDepositWallet.mockResolvedValue({
      transactionHash: "0xredeem",
    });
  });

  it("batches required adapter approval with redeem in one deposit-wallet submission", async () => {
    const { result } = renderHook(() => useCtfOperations());

    let response: unknown;
    await act(async () => {
      response = await result.current.redeemPositions(
        conditionId,
        proxyAddress,
        true
      );
    });

    expect(response).toEqual({ success: true, txHash: "0xredeem" });
    expect(relayerState.executeViaDepositWallet).toHaveBeenCalledTimes(1);
    expect(relayerState.executeViaDepositWallet).toHaveBeenCalledWith(
      walletClient,
      ownerAddress,
      expect.arrayContaining([
        expect.objectContaining({ to: expect.any(String) }),
        expect.objectContaining({ to: expect.any(String) }),
      ])
    );
    expect(
      relayerState.executeViaDepositWallet.mock.calls[0]?.[2]
    ).toHaveLength(2);
  });
});
