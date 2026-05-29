import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const walletAddress = "0x0000000000000000000000000000000000000001";
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

const viemWalletClientMock = vi.hoisted(() => ({
  getViemWalletClient: vi.fn(),
}));

const unifiedSdkMock = vi.hoisted(() => ({
  createUnifiedPolymarketSecureClient: vi.fn(),
  createUnifiedPolymarketViemSigner: vi.fn((signer: unknown) => ({
    signer,
  })),
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

vi.mock("@/lib/viem-wallet-client", () => viemWalletClientMock);

vi.mock("@knoww/shared-types/polymarket-unified", () => unifiedSdkMock);

import { useClobCredentials } from "./use-clob-credentials";

describe("useClobCredentials", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    wagmiState.address = walletAddress;
    wagmiState.isConnected = true;
    wagmiState.walletClient = { request: vi.fn() };

    viemWalletClientMock.getViemWalletClient.mockResolvedValue({
      signTypedData: vi.fn().mockResolvedValue("0xsigned"),
    });
    unifiedSdkMock.createUnifiedPolymarketSecureClient.mockResolvedValue({
      appCredentials: credentials,
      client: {},
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        success: false,
        error: "route unavailable",
      }),
    }) as unknown as typeof fetch;
  });

  it("derives credentials with the unified SDK fallback and stores them", async () => {
    const { result } = renderHook(() => useClobCredentials());

    let derived:
      | Awaited<ReturnType<typeof result.current.deriveCredentials>>
      | undefined;
    await act(async () => {
      derived = await result.current.deriveCredentials();
    });

    expect(derived).toEqual(credentials);
    expect(
      unifiedSdkMock.createUnifiedPolymarketSecureClient
    ).toHaveBeenCalledWith({
      signer: expect.objectContaining({
        signer: expect.objectContaining({
          signTypedData: expect.any(Function),
        }),
      }),
    });
    expect(result.current.credentials).toEqual(credentials);
    expect(result.current.hasCredentials).toBe(true);
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem(sessionStorage.key(0) ?? "")).toBe(
      JSON.stringify(credentials)
    );
  });

  it("loads stored credentials and can clear them", async () => {
    const storageKey = `polymarket_api_creds_https://clob.polymarket.com_${walletAddress}`;
    sessionStorage.setItem(storageKey, JSON.stringify(credentials));

    const { result } = renderHook(() => useClobCredentials());

    await waitFor(() => {
      expect(result.current.credentials).toEqual(credentials);
    });

    act(() => {
      result.current.clearCredentials();
    });

    expect(result.current.credentials).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
});
