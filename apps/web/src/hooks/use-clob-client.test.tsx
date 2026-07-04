import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const credentials = {
  apiKey: "api-key",
  apiSecret: "api-secret",
  apiPassphrase: "api-passphrase",
};

const fullyApprovedStatus = () => ({
  pusdCtf: true,
  pusdCtfExchange: true,
  pusdNegRiskExchange: true,
  pusdNegRiskAdapter: true,
  pusdCtfCollateralAdapter: true,
  pusdNegRiskCtfCollateralAdapter: true,
  usdcOnramp: true,
  ctfExchangeApproval: true,
  ctfNegRiskExchangeApproval: true,
  ctfNegRiskAdapterApproval: true,
  ctfCollateralAdapterApproval: true,
  ctfNegRiskCollateralAdapterApproval: true,
  allApproved: true,
  clobTradingApproved: true,
  autoWrapApproved: true,
  ctfOperationsApproved: true,
  negRiskConversionApproved: true,
});

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

const relayerClientState = vi.hoisted(() => ({
  approveUsdcForTrading: vi.fn(),
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
  createOrder: vi.fn(),
  createMarketOrder: vi.fn(),
  postOrder: vi.fn(),
  updateBalanceAllowance: vi.fn(),
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

const approvalsMock = vi.hoisted(() => {
  const readErc20Allowance = vi.fn();
  const readPusdExchangeAllowance = vi.fn();
  return {
    readErc20Allowance,
    readPusdExchangeAllowance,
    readErc1155Approval: vi.fn(),
    readTradingApprovalStatus: vi.fn(),
    // Mirrors the real min(exchange, adapter-if-negrisk) rule on top of the
    // two mock levers above, so tests keep configuring those directly.
    readClobOrderPusdAllowance: vi.fn(
      async (
        client: unknown,
        owner: unknown,
        negRisk?: boolean,
        options?: unknown
      ) => {
        const exchange = await readPusdExchangeAllowance(
          client,
          owner,
          negRisk,
          options
        );
        if (!negRisk) return exchange;
        const adapter = await readErc20Allowance(
          client,
          owner,
          undefined,
          options
        );
        return exchange < adapter ? exchange : adapter;
      }
    ),
  };
});

const appApprovalsMock = vi.hoisted(() => ({
  checkAllApprovals: vi.fn(),
}));

const viemMock = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  http: vi.fn(() => ({ transport: true })),
  readContract: vi.fn(),
}));

vi.mock("@knoww/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: viemMock.createPublicClient,
    http: viemMock.http,
  };
});

vi.mock("wagmi", () => ({
  useConnection: () => ({
    address: wagmiState.address,
    isConnected: wagmiState.isConnected,
  }),
  useWalletClient: () => ({
    data: wagmiState.walletClient,
  }),
}));

vi.mock("@knoww/shared-types/approvals", async () => {
  const actual = await vi.importActual<
    typeof import("@knoww/shared-types/approvals")
  >("@knoww/shared-types/approvals");
  return {
    ...actual,
    readErc20Allowance: approvalsMock.readErc20Allowance,
    readPusdExchangeAllowance: approvalsMock.readPusdExchangeAllowance,
    readErc1155Approval: approvalsMock.readErc1155Approval,
    readTradingApprovalStatus: approvalsMock.readTradingApprovalStatus,
    readClobOrderPusdAllowance: approvalsMock.readClobOrderPusdAllowance,
  };
});

vi.mock("@/lib/approvals", () => appApprovalsMock);

vi.mock("./use-clob-credentials", () => ({
  useClobCredentials: () => clobCredentialsState,
}));

vi.mock("./use-proxy-wallet", () => ({
  useProxyWallet: () => proxyWalletState,
}));

vi.mock("./use-relayer-client", () => ({
  useRelayerClient: () => relayerClientState,
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
    relayerClientState.approveUsdcForTrading.mockResolvedValue({
      success: true,
      transactionHash: "0xapproval",
    });

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
    legacyClient.createOrder.mockResolvedValue({ order: true });
    legacyClient.createMarketOrder.mockResolvedValue({ order: true });
    legacyClient.postOrder.mockResolvedValue({ success: true, status: "ok" });
    legacyClient.updateBalanceAllowance.mockResolvedValue({});
    appApprovalsMock.checkAllApprovals.mockResolvedValue(fullyApprovedStatus());
    approvalsMock.readPusdExchangeAllowance.mockResolvedValue(
      BigInt(2_000_000)
    );
    approvalsMock.readErc20Allowance.mockResolvedValue(BigInt(2_000_000));
    approvalsMock.readErc1155Approval.mockResolvedValue(true);
    approvalsMock.readTradingApprovalStatus.mockResolvedValue({});
    viemMock.readContract.mockReset();
    viemMock.createPublicClient.mockReturnValue({
      readContract: viemMock.readContract,
    });
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

  it("passes scoped approval requests through to the relayer client", async () => {
    const approvalScope = {
      side: "BUY" as const,
      negRisk: true,
    };
    const { result } = renderHook(() => useClobClient());

    let response: unknown;
    await act(async () => {
      response = await result.current.updateAllowance("4", approvalScope);
    });

    expect(relayerClientState.approveUsdcForTrading).toHaveBeenCalledWith("4", {
      approvalScope,
    });
    expect(response).toEqual({
      success: true,
      hashes: ["0xapproval"],
      message:
        "Approved app trading pUSD, USDC.e Onramp, and outcome-token operators",
    });
  });

  it("throws a clear insufficient-collateral error before posting when no USDC.e can cover a BUY shortfall", async () => {
    viemMock.readContract
      .mockResolvedValueOnce(BigInt(0)) // pUSD balance
      .mockResolvedValueOnce(BigInt(0)); // USDC.e balance
    const { result } = renderHook(() => useClobClient());

    await expect(
      act(async () => {
        await result.current.createOrder({
          tokenId: "token-1",
          conditionId: "condition-1",
          price: 0.5,
          size: 2,
          side: "BUY",
          orderType: "GTC",
        });
      })
    ).rejects.toThrow(/Insufficient collateral/);

    expect(legacyClient.postOrder).not.toHaveBeenCalled();
  });

  it("tops up a finite neg-risk adapter allowance below the buy notional", async () => {
    approvalsMock.readPusdExchangeAllowance.mockResolvedValue(
      BigInt(2_000_000)
    );
    approvalsMock.readErc20Allowance.mockResolvedValue(BigInt(500_000));
    viemMock.readContract
      .mockResolvedValueOnce(BigInt(2_000_000)) // pUSD balance
      .mockResolvedValueOnce(BigInt(0)); // USDC.e balance
    const { result } = renderHook(() => useClobClient());

    await act(async () => {
      await result.current.createOrder({
        tokenId: "token-1",
        conditionId: "condition-1",
        price: 0.5,
        size: 2,
        side: "BUY",
        orderType: "GTC",
        negRisk: true,
      });
    });

    expect(relayerClientState.approveUsdcForTrading).toHaveBeenCalledWith(
      "100"
    );
    expect(legacyClient.postOrder).toHaveBeenCalled();
  });

  it("repairs a missing neg-risk adapter operator approval before posting a neg-risk SELL", async () => {
    // Exchange operator approved, adapter operator missing — the state the
    // old single-operator read waved through, leaving the CLOB to reject the
    // posted order with its generic balance/allowance error.
    appApprovalsMock.checkAllApprovals.mockResolvedValue({
      ...fullyApprovedStatus(),
      ctfNegRiskAdapterApproval: false,
      clobTradingApproved: false,
      allApproved: false,
      negRiskConversionApproved: false,
    });
    viemMock.readContract.mockResolvedValueOnce([BigInt(5_000_000)]); // CTF balanceOfBatch

    const { result } = renderHook(() => useClobClient());

    await act(async () => {
      await result.current.createOrder({
        tokenId: "123",
        conditionId: "condition-1",
        price: 0.5,
        size: 2,
        side: "SELL",
        orderType: "GTC",
        negRisk: true,
      });
    });

    expect(relayerClientState.approveUsdcForTrading).toHaveBeenCalledWith(
      undefined,
      { approvalScope: { side: "SELL", negRisk: true } }
    );
    expect(legacyClient.postOrder).toHaveBeenCalled();
  });

  it("posts a neg-risk SELL without approval repair when both operators are approved", async () => {
    viemMock.readContract.mockResolvedValueOnce([BigInt(5_000_000)]); // CTF balanceOfBatch

    const { result } = renderHook(() => useClobClient());

    await act(async () => {
      await result.current.createOrder({
        tokenId: "123",
        conditionId: "condition-1",
        price: 0.5,
        size: 2,
        side: "SELL",
        orderType: "GTC",
        negRisk: true,
      });
    });

    expect(relayerClientState.approveUsdcForTrading).not.toHaveBeenCalled();
    expect(legacyClient.postOrder).toHaveBeenCalled();
  });

  it("repairs a missing exchange operator approval before posting a standard SELL", async () => {
    appApprovalsMock.checkAllApprovals.mockResolvedValue({
      ...fullyApprovedStatus(),
      ctfExchangeApproval: false,
      clobTradingApproved: false,
      allApproved: false,
    });
    viemMock.readContract.mockResolvedValueOnce([BigInt(5_000_000)]); // CTF balanceOfBatch

    const { result } = renderHook(() => useClobClient());

    await act(async () => {
      await result.current.createOrder({
        tokenId: "123",
        conditionId: "condition-1",
        price: 0.5,
        size: 2,
        side: "SELL",
        orderType: "GTC",
        negRisk: false,
      });
    });

    expect(relayerClientState.approveUsdcForTrading).toHaveBeenCalledWith(
      undefined,
      { approvalScope: { side: "SELL", negRisk: false } }
    );
    expect(legacyClient.postOrder).toHaveBeenCalled();
  });
});
