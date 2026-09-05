import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WalletProvider } from "./wallet-context";

const wagmiState = vi.hoisted(() => ({
  address: undefined as string | undefined,
  isConnected: false,
  isConnecting: false,
  walletClient: null as unknown,
  isWalletClientLoading: false,
}));

const walletModalMock = vi.hoisted(() => ({
  closeWalletModal: vi.fn(async () => undefined),
  openWalletModal: vi.fn(async () => undefined),
}));

const posthogMock = vi.hoisted(() => ({
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  get_distinct_id: vi.fn(() => "anonymous-id"),
}));

vi.mock("wagmi", () => ({
  useConnection: () => ({
    address: wagmiState.address,
    isConnected: wagmiState.isConnected,
    isConnecting: wagmiState.isConnecting,
  }),
  useWalletClient: () => ({
    data: wagmiState.walletClient,
    isLoading: wagmiState.isWalletClientLoading,
  }),
}));

vi.mock("@/lib/rpc", () => ({
  getRpcUrl: () => "http://127.0.0.1:8545",
}));

vi.mock("@/lib/wallet-modal", () => walletModalMock);

vi.mock("posthog-js", () => ({
  default: posthogMock,
}));

describe("WalletProvider", () => {
  beforeEach(() => {
    wagmiState.address = undefined;
    wagmiState.isConnected = false;
    wagmiState.isConnecting = false;
    wagmiState.walletClient = null;
    wagmiState.isWalletClientLoading = false;
    vi.clearAllMocks();
    posthogMock.get_distinct_id.mockReturnValue("anonymous-id");
  });

  it("resets the previous identity when switching or disconnecting wallets", () => {
    wagmiState.address = "0x0000000000000000000000000000000000000001";
    wagmiState.isConnected = true;
    const { rerender } = render(
      <WalletProvider>
        <div />
      </WalletProvider>
    );
    wagmiState.address = "0x0000000000000000000000000000000000000002";
    rerender(
      <WalletProvider>
        <div />
      </WalletProvider>
    );
    expect(posthogMock.reset).toHaveBeenCalledTimes(1);
    expect(posthogMock.identify).toHaveBeenLastCalledWith(wagmiState.address, {
      wallet_address: wagmiState.address,
    });
    wagmiState.isConnected = false;
    wagmiState.address = undefined;
    rerender(
      <WalletProvider>
        <div />
      </WalletProvider>
    );
    expect(posthogMock.reset).toHaveBeenCalledTimes(2);
    expect(posthogMock.unregister).toHaveBeenCalledWith("wallet_address");
  });

  it("resets a different wallet persisted before this component mounted", () => {
    posthogMock.get_distinct_id.mockReturnValue(
      "0x0000000000000000000000000000000000000002"
    );
    wagmiState.address = "0x0000000000000000000000000000000000000001";
    wagmiState.isConnected = true;
    render(
      <WalletProvider>
        <div />
      </WalletProvider>
    );
    expect(posthogMock.reset).toHaveBeenCalledOnce();
    expect(posthogMock.identify).toHaveBeenCalledWith(wagmiState.address, {
      wallet_address: wagmiState.address,
    });
  });

  it("closes the wallet modal after wagmi reports a connected account", async () => {
    const { rerender } = render(
      <WalletProvider>
        <div />
      </WalletProvider>
    );

    expect(walletModalMock.closeWalletModal).not.toHaveBeenCalled();

    wagmiState.address = "0x0000000000000000000000000000000000000001";
    wagmiState.isConnected = true;
    rerender(
      <WalletProvider>
        <div />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(walletModalMock.closeWalletModal).toHaveBeenCalledTimes(1);
    });
    expect(posthogMock.identify).toHaveBeenCalledWith(
      "0x0000000000000000000000000000000000000001",
      {
        wallet_address: "0x0000000000000000000000000000000000000001",
      }
    );
    expect(posthogMock.capture).toHaveBeenCalledWith("wallet_connected", {
      product: "web",
      wallet_address: "0x0000000000000000000000000000000000000001",
    });
  });

  it("identifies a wallet restored with the initial session", async () => {
    wagmiState.address = "0x0000000000000000000000000000000000000001";
    wagmiState.isConnected = true;

    render(
      <WalletProvider>
        <div />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(posthogMock.identify).toHaveBeenCalledWith(
        "0x0000000000000000000000000000000000000001",
        {
          wallet_address: "0x0000000000000000000000000000000000000001",
        }
      );
    });
    expect(posthogMock.capture).not.toHaveBeenCalledWith(
      "wallet_connected",
      expect.anything()
    );
    expect(posthogMock.capture).toHaveBeenCalledWith(
      "wallet_session_ready",
      expect.objectContaining({
        product: "web",
        wallet_address: wagmiState.address,
        connection_mode: "restored_or_switched",
      })
    );
  });
});
