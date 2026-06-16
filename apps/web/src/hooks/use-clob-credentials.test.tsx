import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const walletAddress = "0x0000000000000000000000000000000000000001";
const storageKey = "knoww_clob_api_key_map";
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

function storedEntryFor(address = walletAddress) {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return undefined;
  const parsed = JSON.parse(stored ?? "{}") as {
    entries?: Record<
      string,
      {
        credentials?: typeof credentials;
        createdAt?: number;
        expiresAt?: number;
      }
    >;
  };
  return parsed.entries?.[`https://clob.polymarket.com_${address}`];
}

describe("useClobCredentials", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
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

  it("derives credentials through the API route without SDK fallback", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        credentials,
      }),
    }) as unknown as typeof fetch;

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
    ).not.toHaveBeenCalled();
    expect(result.current.credentials).toEqual(credentials);
    expect(result.current.hasCredentials).toBe(true);
    expect(sessionStorage.length).toBe(0);
    expect(storedEntryFor()?.credentials).toEqual(credentials);
    expect(storedEntryFor()?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("shares one in-flight credential derivation across concurrent callers", async () => {
    let resolveFetch:
      | ((value: {
          ok: boolean;
          json: () => Promise<{
            success: boolean;
            credentials: typeof credentials;
          }>;
        }) => void)
      | undefined;
    const fetchPromise = new Promise<{
      ok: boolean;
      json: () => Promise<{
        success: boolean;
        credentials: typeof credentials;
      }>;
    }>((resolve) => {
      resolveFetch = resolve;
    });
    globalThis.fetch = vi
      .fn()
      .mockReturnValue(fetchPromise) as unknown as typeof fetch;

    const { result } = renderHook(() => useClobCredentials());

    const first = result.current.deriveCredentials();
    const second = result.current.deriveCredentials();

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    expect(viemWalletClientMock.getViemWalletClient).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch?.({
        ok: true,
        json: async () => ({
          success: true,
          credentials,
        }),
      });

      await expect(Promise.all([first, second])).resolves.toEqual([
        credentials,
        credentials,
      ]);
    });
  });

  it("loads stored localStorage credentials and can clear them", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        entries: {
          [`https://clob.polymarket.com_${walletAddress}`]: {
            credentials,
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
          },
        },
      })
    );

    const { result } = renderHook(() => useClobCredentials());

    await waitFor(() => {
      expect(result.current.credentials).toEqual(credentials);
    });

    act(() => {
      result.current.clearCredentials();
    });

    expect(result.current.credentials).toBeNull();
    expect(storedEntryFor()).toBeUndefined();
  });

  it("ignores credentials stored under unrelated localStorage keys", async () => {
    localStorage.setItem(
      "unrelated_clob_api_key_map",
      JSON.stringify({
        version: 1,
        entries: {
          [`https://clob.polymarket.com_${walletAddress}`]: {
            credentials,
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
          },
        },
      })
    );

    const { result } = renderHook(() => useClobCredentials());

    await waitFor(() => {
      expect(result.current.credentials).toBeNull();
    });

    expect(storedEntryFor()).toBeUndefined();
  });

  it("refreshes when another tab updates the localStorage credential map", async () => {
    const { result } = renderHook(() => useClobCredentials());

    await waitFor(() => {
      expect(result.current.credentials).toBeNull();
    });

    const nextValue = JSON.stringify({
      version: 1,
      entries: {
        [`https://clob.polymarket.com_${walletAddress}`]: {
          credentials,
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        },
      },
    });

    act(() => {
      localStorage.setItem(storageKey, nextValue);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: storageKey,
          newValue: nextValue,
        })
      );
    });

    await waitFor(() => {
      expect(result.current.credentials).toEqual(credentials);
    });
  });

  it("removes expired localStorage credentials instead of using them", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        entries: {
          [`https://clob.polymarket.com_${walletAddress}`]: {
            credentials,
            createdAt: Date.now() - 120_000,
            expiresAt: Date.now() - 60_000,
          },
        },
      })
    );
    const { result } = renderHook(() => useClobCredentials());

    await waitFor(() => {
      expect(result.current.credentials).toBeNull();
    });

    expect(storedEntryFor()).toBeUndefined();
  });

  it("removes malformed localStorage credentials instead of using them", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        entries: {
          [`https://clob.polymarket.com_${walletAddress}`]: {
            credentials: { apiKey: "api-key" },
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
          },
        },
      })
    );

    const { result } = renderHook(() => useClobCredentials());

    await waitFor(() => {
      expect(result.current.credentials).toBeNull();
    });

    expect(storedEntryFor()).toBeUndefined();
  });
});
