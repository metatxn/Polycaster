import { act, renderHook, waitFor } from "@testing-library/react";
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
}));

const clobCredentialsState = vi.hoisted(() => ({
  credentials: {
    apiKey: "api-key",
    apiSecret: "api-secret",
    apiPassphrase: "api-passphrase",
  },
  hasCredentials: true,
  clearCredentials: vi.fn(),
}));

const viemWalletClientMock = vi.hoisted(() => ({
  getViemWalletClient: vi.fn(),
}));

const notificationClient = vi.hoisted(() => ({
  fetchNotifications: vi.fn(),
  dropNotifications: vi.fn(),
}));

const unifiedSdkMock = vi.hoisted(() => ({
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

vi.mock("@/hooks/use-clob-credentials", () => ({
  useClobCredentials: () => clobCredentialsState,
}));

vi.mock("@/hooks/use-proxy-wallet", () => ({
  useProxyWallet: () => proxyWalletState,
}));

vi.mock("@/lib/viem-wallet-client", () => viemWalletClientMock);

vi.mock("@knoww/shared-types/polymarket-unified", () => unifiedSdkMock);

import { useNotifications } from "./use-notifications";

describe("useNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wagmiState.isConnected = true;
    proxyWalletState.proxyAddress =
      "0x0000000000000000000000000000000000000002";
    proxyWalletState.isDeployed = false;
    clobCredentialsState.credentials = credentials;
    clobCredentialsState.hasCredentials = true;
    clobCredentialsState.clearCredentials.mockReset();

    viemWalletClientMock.getViemWalletClient.mockResolvedValue({
      requestAddresses: vi.fn().mockResolvedValue([]),
    });
    unifiedSdkMock.createUnifiedPolymarketSecureClient.mockResolvedValue({
      client: notificationClient,
      appCredentials: credentials,
    });
    notificationClient.fetchNotifications.mockResolvedValue([
      {
        id: 10,
        owner: "api-key",
        payload: { order_id: "older" },
        timestamp: 100,
        type: 2,
      },
      {
        id: 11,
        owner: "api-key",
        payload: { order_id: "newer" },
        timestamp: 200,
        type: 2,
      },
    ]);
    notificationClient.dropNotifications.mockResolvedValue(undefined);
  });

  it("fetches notifications through the unified secure client and sorts newest first", async () => {
    const { result } = renderHook(() => useNotifications());

    await act(async () => {
      await result.current.fetchNotifications();
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
    expect(result.current.notifications.map((item) => item.id)).toEqual([
      11, 10,
    ]);
    expect(result.current.unreadCount).toBe(2);
  });

  it("drops notification ids as strings and removes them after success", async () => {
    const { result } = renderHook(() => useNotifications());

    await act(async () => {
      await result.current.fetchNotifications();
    });

    await act(async () => {
      await result.current.dismissNotifications([10]);
    });

    await waitFor(() => {
      expect(result.current.notifications.map((item) => item.id)).toEqual([11]);
    });
    expect(notificationClient.dropNotifications).toHaveBeenCalledWith({
      ids: ["10"],
    });
  });
});
