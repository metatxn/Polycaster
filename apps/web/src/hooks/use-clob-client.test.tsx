import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const credentials = {
  apiKey: "api-key",
  apiSecret: "api-secret",
  apiPassphrase: "api-passphrase",
};

const wagmiState = vi.hoisted(() => ({
  address: "0x0000000000000000000000000000000000000001",
  isConnected: true,
  walletClient: { request: vi.fn() },
}));

const proxyWalletState = vi.hoisted(() => ({
  proxyAddress: "0x0000000000000000000000000000000000000002",
  isDeployed: true,
  isEoaMode: false,
  walletMode: "safe",
}));

const clobCredentialsState = vi.hoisted(() => ({
  credentials: {
    apiKey: "api-key",
    apiSecret: "api-secret",
    apiPassphrase: "api-passphrase",
  },
  hasCredentials: true,
  deriveCredentials: vi.fn(),
  clearCredentials: vi.fn(),
}));

const legacyClient = vi.hoisted(() => ({
  getOpenOrders: vi.fn(),
  cancelOrder: vi.fn(),
}));

const unifiedSdkMock = vi.hoisted(() => ({
  adaptUnifiedSecureClientForLegacyClob: vi.fn(),
  createUnifiedPolymarketCredentialsOnlySigner: vi.fn((address: string) => ({
    address,
    getAddress: vi.fn().mockResolvedValue(address),
    signTypedData: vi.fn(),
  })),
  createUnifiedPolymarketSecureClient: vi.fn(),
  createUnifiedPolymarketViemSigner: vi.fn((signer: unknown) => ({
    signer,
  })),
  isPolymarketFreshAuthenticationRequiredError: vi.fn(() => false),
}));

const viemWalletClientMock = vi.hoisted(() => ({
  getViemWalletClient: vi.fn(),
  hasViemWalletProvider: vi.fn(),
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
    address: wagmiState.address,
    isConnected: wagmiState.isConnected,
  }),
  useWalletClient: () => ({
    data: wagmiState.walletClient,
  }),
}));

vi.mock("./use-clob-credentials", () => ({
  useClobCredentials: () => clobCredentialsState,
}));

vi.mock("./use-proxy-wallet", () => ({
  useProxyWallet: () => proxyWalletState,
}));

vi.mock("./use-relayer-client", () => ({
  useRelayerClient: () => ({
    approveUsdcForTrading: vi.fn(),
  }),
}));

vi.mock("@/lib/viem-wallet-client", () => viemWalletClientMock);

vi.mock("@knoww/shared-types/polymarket-unified", () => unifiedSdkMock);

import { useClobClient } from "./use-clob-client";

describe("useClobClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wagmiState.address = "0x0000000000000000000000000000000000000001";
    wagmiState.isConnected = true;
    wagmiState.walletClient = { request: vi.fn() };
    proxyWalletState.proxyAddress =
      "0x0000000000000000000000000000000000000002";
    proxyWalletState.isDeployed = true;
    proxyWalletState.isEoaMode = false;
    proxyWalletState.walletMode = "safe";
    clobCredentialsState.credentials = credentials;
    clobCredentialsState.hasCredentials = true;
    clobCredentialsState.clearCredentials.mockReset();

    viemWalletClientMock.hasViemWalletProvider.mockReturnValue(true);
    viemWalletClientMock.getViemWalletClient.mockResolvedValue({
      requestAddresses: vi.fn().mockResolvedValue([]),
    });
    unifiedSdkMock.createUnifiedPolymarketSecureClient.mockResolvedValue({
      client: { sdkClient: true },
      appCredentials: credentials,
    });
    unifiedSdkMock.adaptUnifiedSecureClientForLegacyClob.mockReturnValue(
      legacyClient
    );
    legacyClient.getOpenOrders.mockResolvedValue([
      { id: "order-1", asset_id: "token-1" },
    ]);
    legacyClient.cancelOrder.mockResolvedValue({ canceled: ["order-1"] });
  });

  it("reads open orders through the unified SDK compatibility adapter", async () => {
    const { result } = renderHook(() => useClobClient());

    let orders: unknown[] = [];
    await act(async () => {
      orders = await result.current.getOpenOrders();
    });

    expect(
      unifiedSdkMock.createUnifiedPolymarketSecureClient
    ).toHaveBeenCalledWith({
      signer: expect.objectContaining({
        address: wagmiState.address,
      }),
      wallet: proxyWalletState.proxyAddress,
      credentials,
      allowFreshAuthentication: false,
    });
    expect(viemWalletClientMock.getViemWalletClient).not.toHaveBeenCalled();
    expect(
      unifiedSdkMock.adaptUnifiedSecureClientForLegacyClob
    ).toHaveBeenCalledWith(
      { sdkClient: true },
      { builderCode: process.env.NEXT_PUBLIC_POLY_BUILDER_CODE }
    );
    expect(orders).toEqual([{ id: "order-1", asset_id: "token-1" }]);
  });

  it("reuses the read-only secure client across passive order reads", async () => {
    const { result } = renderHook(() => useClobClient());

    await act(async () => {
      await result.current.getOpenOrders();
      await result.current.getOpenOrders();
    });

    expect(
      unifiedSdkMock.createUnifiedPolymarketSecureClient
    ).toHaveBeenCalledTimes(1);
    expect(
      unifiedSdkMock.adaptUnifiedSecureClientForLegacyClob
    ).toHaveBeenCalledTimes(1);
    expect(legacyClient.getOpenOrders).toHaveBeenCalledTimes(2);
  });

  it("cancels orders through the unified SDK compatibility adapter", async () => {
    const { result } = renderHook(() => useClobClient());

    let response: unknown;
    await act(async () => {
      response = await result.current.cancelOrder("order-1");
    });

    expect(legacyClient.cancelOrder).toHaveBeenCalledWith({
      orderID: "order-1",
    });
    expect(response).toEqual({
      success: true,
      response: { canceled: ["order-1"] },
    });
  });
});
