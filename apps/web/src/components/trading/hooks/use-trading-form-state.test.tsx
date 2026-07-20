import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTradingFormState } from "./use-trading-form-state";

const clobClientState = vi.hoisted(() => ({
  createOrder: vi.fn(),
  isLoading: false,
  operationStep: "idle",
  error: null,
  hasCredentials: true,
  canTrade: true,
  updateAllowance: vi.fn(),
  getUsdcAllowance: vi.fn(),
}));

const proxyWalletState = vi.hoisted(() => ({
  proxyAddress: "0x0000000000000000000000000000000000000002",
  isDeployed: true,
  usdcBalance: 10,
  refresh: vi.fn(),
}));

const wagmiState = vi.hoisted(() => ({
  isConnected: true,
}));

vi.mock("wagmi", () => ({
  useConnection: () => ({
    isConnected: wagmiState.isConnected,
  }),
}));

vi.mock("@/hooks/use-clob-client", () => ({
  OrderType: {
    FAK: "FAK",
    FOK: "FOK",
    GTC: "GTC",
    GTD: "GTD",
  },
  Side: {
    BUY: "BUY",
    SELL: "SELL",
  },
  useClobClient: () => clobClientState,
}));

vi.mock("@/hooks/use-proxy-wallet", () => ({
  useProxyWallet: () => proxyWalletState,
}));

vi.mock("@/hooks/use-user-positions", () => ({
  useUserPositions: () => ({ data: { positions: [] } }),
}));

vi.mock("@/lib/approvals", () => ({
  checkAllApprovals: vi.fn().mockResolvedValue({
    pusdCtf: false,
    pusdCtfExchange: false,
    pusdNegRiskExchange: true,
    pusdCtfCollateralAdapter: false,
    pusdNegRiskCtfCollateralAdapter: false,
    usdcOnramp: false,
    ctfExchangeApproval: false,
    ctfNegRiskExchangeApproval: false,
    ctfCollateralAdapterApproval: false,
    ctfNegRiskCollateralAdapterApproval: false,
    allApproved: false,
    clobTradingApproved: false,
    autoWrapApproved: false,
    ctfOperationsApproved: false,
    negRiskConversionApproved: false,
  }),
}));

function renderTradingFormState() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return renderHook(
    () =>
      useTradingFormState({
        outcomes: [
          {
            name: "Portugal",
            price: 0.86,
            probability: 0.86,
            tokenId: "12345678901234567890",
          },
        ],
        selectedOutcomeIndex: 0,
        negRisk: true,
        userBalance: 10,
        orderBook: {
          bids: [],
          asks: [{ price: "0.86", size: "100" }],
        },
      }),
    { wrapper }
  );
}

describe("useTradingFormState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wagmiState.isConnected = true;
    proxyWalletState.proxyAddress =
      "0x0000000000000000000000000000000000000002";
    proxyWalletState.isDeployed = true;
    proxyWalletState.usdcBalance = 10;
    clobClientState.updateAllowance.mockResolvedValue({ success: true });
    clobClientState.getUsdcAllowance.mockResolvedValue({
      allowance: 0,
      allowanceRaw: "0",
      decimals: 6,
    });
  });

  it("approves the current ticket amount and order scope instead of the default amount", async () => {
    const { result } = renderTradingFormState();

    await act(async () => {
      result.current.setMarketBuyAmount(3.74);
    });
    await act(async () => {
      await result.current.handleSetAllowance();
    });

    expect(clobClientState.updateAllowance).toHaveBeenCalledWith("4", {
      side: "BUY",
      negRisk: true,
    });
  });
});
