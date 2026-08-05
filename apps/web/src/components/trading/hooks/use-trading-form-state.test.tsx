import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
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
  estimateBuyFee: vi.fn().mockResolvedValue(null),
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

const CONDITION_ID =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

type TestOrderBook = {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
};

const DEFAULT_ORDER_BOOK: TestOrderBook = {
  bids: [],
  asks: [{ price: "0.86", size: "100" }],
};

// `null` means "no book" — an explicit `undefined` would just re-trigger the
// default parameter.
function renderTradingFormState(
  orderBook: TestOrderBook | null = DEFAULT_ORDER_BOOK,
  conditionId?: string,
  options?: { tickSize?: number }
) {
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
        orderBook: orderBook ?? undefined,
        conditionId,
        tickSize: options?.tickSize,
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
    clobClientState.estimateBuyFee.mockResolvedValue(null);
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

  it("does not report insufficient liquidity before an amount is entered", () => {
    const { result } = renderTradingFormState();

    // Fresh MARKET BUY ticket: the amount field starts empty, so there is
    // nothing to walk the book with — that is not a liquidity problem.
    expect(result.current.marketBuyAmount).toBe(0);
    expect(result.current.hasInsufficientLiquidity).toBe(false);
    expect(result.current.isOrderBookUnavailable).toBe(false);
    expect(result.current.isMarketOrderSizeEmpty).toBe(true);
  });

  it("reports insufficient liquidity when the book is short and partial fills are off", async () => {
    const { result } = renderTradingFormState();

    // FOK is all-or-nothing: a book that cannot cover the full ticket kills
    // the order server-side, so the form has to block it here.
    await act(async () => {
      result.current.setAllowPartialFill(false);
    });
    // The book holds 100 shares at 86¢ ≈ $86 of depth.
    await act(async () => {
      result.current.setMarketBuyAmount(5000);
    });

    expect(result.current.hasInsufficientLiquidity).toBe(true);
    expect(result.current.canPlaceMarketOrder).toBe(false);
    expect(result.current.partialFill).toBeNull();
  });

  it("lets a short book through as a partial fill when the user allows it", async () => {
    const { result } = renderTradingFormState();

    // Same $86 book, same $5000 ticket — but FAK fills what is there and
    // cancels the rest, so this is a placeable order sized down to $86.
    await act(async () => {
      result.current.setMarketBuyAmount(5000);
    });

    expect(result.current.allowPartialFill).toBe(true);
    expect(result.current.hasInsufficientLiquidity).toBe(false);
    expect(result.current.canPlaceMarketOrder).toBe(true);
    expect(result.current.partialFill).toEqual({
      filledShares: 100,
      filledUsd: 86,
      requestedUsd: 5000,
      requestedShares: null,
    });
    // The order still has to carry a price bound. `optionalPriceBound` drops
    // any non-positive price, so a 0 here would sign unbounded slippage.
    expect(result.current.calculations.price).toBe(0.87);
    expect(result.current.calculations.total).toBe(86);
    expect(result.current.calculations.size).toBe(100);
  });

  // The price-bound clamps have to come from the market's tick, not a
  // hardcoded cent grid. Both cases below sit inside the last cent, where the
  // old `Math.min(0.99, ...)` / `Math.max(0.01, ...)` clamps produced bounds
  // the 0.001-tick book could never fill against.
  it("clamps a market BUY bound to one tick under $1 on a 0.001-tick market", async () => {
    const { result } = renderTradingFormState(
      { bids: [], asks: [{ price: "0.995", size: "100" }] },
      undefined,
      { tickSize: 0.001 }
    );

    await act(async () => {
      result.current.setMarketBuyAmount(5);
    });

    // Worst ask 0.995 × 1.005 buffer = 0.999975, which rounds up to $1.00 —
    // clamped to 1 − tick = 0.999. The old cent-grid clamp answered 0.99,
    // under the 99.5¢ ask the walk just filled against.
    expect(result.current.calculations.price).toBe(0.999);
  });

  it("keeps a market SELL bound under a sub-cent best bid on a 0.001-tick market", async () => {
    const { result } = renderTradingFormState(
      { bids: [{ price: "0.005", size: "100" }], asks: [] },
      undefined,
      { tickSize: 0.001 }
    );

    await act(async () => {
      result.current.setSide("SELL");
    });

    // Worst bid 0.005 × 0.995 buffer = 0.004975, rounded down the tick grid
    // to 0.004. The old clamp floored this at 0.01 — a SELL bound above the
    // whole book, which FAK fills against as nothing.
    expect(result.current.calculations.price).toBe(0.004);
  });

  // The CLOB rejects a marketable BUY whose signed `makerAmount` is under $1.
  it("rejects a marketable buy below the CLOB minimum", async () => {
    const { result } = renderTradingFormState();

    await act(async () => {
      result.current.setMarketBuyAmount(0.99);
    });

    expect(result.current.isBelowMarketableBuyMinNotional).toBe(true);
  });

  // Signed without `maxSpend`, so `makerAmount` equals the typed amount and the
  // minimum needs no fee headroom — exactly $1.00 clears. A markup here would
  // be wrong at any single value anyway: the protocol fee scales as
  // `rate / price`, so no static constant covers every market.
  it("accepts a marketable buy at exactly $1", async () => {
    const { result } = renderTradingFormState();

    await act(async () => {
      result.current.setMarketBuyAmount(1);
    });

    expect(result.current.isBelowMarketableBuyMinNotional).toBe(false);
    expect(result.current.minBuyAmount).toBe(1);
  });

  // The fee is charged on top of the typed amount, so the ticket has to show it
  // for the real debit to be legible.
  it("surfaces the market's taker fee for the ticket", async () => {
    // 6-decimal pUSD base units: 12_500 raw = $0.0125.
    clobClientState.estimateBuyFee.mockResolvedValue(BigInt(12_500));
    const { result } = renderTradingFormState(DEFAULT_ORDER_BOOK, CONDITION_ID);

    await act(async () => {
      result.current.setMarketBuyAmount(5);
    });
    await waitFor(() => {
      expect(result.current.estimatedFeeUsd).not.toBeNull();
    });

    expect(result.current.estimatedFeeUsd).toBeCloseTo(0.0125, 6);
    expect(clobClientState.estimateBuyFee).toHaveBeenCalledWith(
      expect.objectContaining({
        conditionId: CONDITION_ID,
        notional: 5,
        isMarketableBuy: true,
      })
    );
  });

  // A fee we could not read is not a zero fee — the ticket renders nothing
  // rather than a confident "$0.00".
  it("reports no fee estimate when the market fee cannot be read", async () => {
    clobClientState.estimateBuyFee.mockResolvedValue(null);
    const { result } = renderTradingFormState(DEFAULT_ORDER_BOOK, CONDITION_ID);

    await act(async () => {
      result.current.setMarketBuyAmount(5);
    });
    await waitFor(() => {
      expect(clobClientState.estimateBuyFee).toHaveBeenCalled();
    });

    expect(result.current.estimatedFeeUsd).toBeNull();
  });

  it("flags a missing order book separately from thin liquidity", async () => {
    const { result } = renderTradingFormState(null);

    await act(async () => {
      result.current.setMarketBuyAmount(5);
    });

    expect(result.current.isOrderBookUnavailable).toBe(true);
    expect(result.current.hasInsufficientLiquidity).toBe(false);
  });
});
