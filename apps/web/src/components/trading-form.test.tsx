import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import posthog from "posthog-js";
import { useState } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TradingForm } from "./trading-form";

const useTradingFormStateMock = vi.hoisted(() => vi.fn());

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    ...props
  }: {
    alt?: string;
    src?: string;
    [key: string]: unknown;
  }) => (
    // biome-ignore lint/performance/noImgElement: Test mock for Next Image.
    <img alt={alt} src={src} {...props} />
  ),
}));

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/context/onboarding-context", () => ({
  useOnboarding: () => ({ setShowOnboarding: vi.fn() }),
}));

vi.mock("@/lib/wallet-modal", () => ({
  openWalletModal: vi.fn(),
  preloadWalletModal: vi.fn(),
}));

vi.mock("@/components/deposit-modal", () => ({
  DepositModal: () => null,
}));

vi.mock("./trading/split-shares-modal", () => ({
  SplitSharesModal: () => null,
}));

vi.mock("./trading/merge-shares-modal", () => ({
  MergeSharesModal: () => null,
}));

vi.mock("./trading/hooks/use-trading-form-state", () => ({
  useTradingFormState: useTradingFormStateMock,
}));

function makeTradingFormState(overrides = {}) {
  return {
    side: "BUY",
    setSide: vi.fn(),
    orderType: "MARKET",
    setOrderType: vi.fn(),
    limitPrice: 0.6,
    setLimitPrice: vi.fn(),
    shares: 10,
    setShares: vi.fn(),
    marketBuyAmount: 5,
    setMarketBuyAmount: vi.fn(),
    minBuyAmount: 1,
    estimatedFeeUsd: null,
    isFeeEstimateFetching: false,
    allowPartialFill: true,
    setAllowPartialFill: vi.fn(),
    expirationType: "GTC",
    setExpirationType: vi.fn(),
    expirationTime: 3600,
    setExpirationTime: vi.fn(),
    tickSize: 0.01,
    isLoading: false,
    operationStep: null,
    error: null,
    calculations: {
      price: 0.6,
      total: 6,
      size: 10,
      potentialWin: 10,
      potentialLoss: 6,
      returnPercent: "66.7",
    },
    slippageResult: null,
    effectiveBalance: undefined,
    hasInsufficientBalance: false,
    hasInsufficientAllowance: false,
    hasNoAllowance: false,
    hasMissingTradingApprovals: false,
    isCheckingTradingApprovals: false,
    isBelowMarketableBuyMinNotional: false,
    minShares: 1,
    maxSellShares: 0,
    hasCredentials: false,
    isConnected: false,
    canTrade: true,
    handleSetAllowance: vi.fn(),
    handleSubmit: vi.fn(),
    hasValidTokenId: true,
    canPlaceMarketOrder: true,
    partialFill: null,
    hasInsufficientLiquidity: false,
    isOrderBookUnavailable: false,
    isMarketOrderSizeEmpty: false,
    ...overrides,
  };
}

/** A plain two-outcome market, for tests that only care about the mocked state. */
function renderDefaultForm() {
  return render(
    <TradingForm
      marketTitle="France"
      tokenId="france-token"
      outcomes={[
        { name: "YES", tokenId: "france-token", price: 0.6, probability: 60 },
        {
          name: "NO",
          tokenId: "not-france-token",
          price: 0.4,
          probability: 40,
        },
      ]}
      selectedOutcomeIndex={0}
      onOutcomeChange={() => {}}
      bestBid={0.59}
      bestAsk={0.6}
      disableSticky
    />
  );
}

describe("TradingForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTradingFormStateMock.mockReturnValue(makeTradingFormState());
  });

  it("uses outcome names as price-selector labels", () => {
    render(
      <TradingForm
        marketTitle="India vs Afghanistan"
        tokenId="india-token"
        outcomes={[
          {
            name: "IND4",
            tokenId: "india-token",
            price: 0.6,
            probability: 60,
          },
          {
            name: "AFG2",
            tokenId: "afghanistan-token",
            price: 0.42,
            probability: 42,
          },
        ]}
        selectedOutcomeIndex={0}
        onOutcomeChange={() => {}}
        bestBid={0.59}
        bestAsk={0.6}
        disableSticky
      />
    );

    expect(screen.getByText("IND4")).toBeInTheDocument();
    expect(screen.getByText("AFG2")).toBeInTheDocument();
    expect(screen.queryByText("YES")).not.toBeInTheDocument();
    expect(screen.queryByText("NO")).not.toBeInTheDocument();
  });

  it("leads a MARKET BUY with the big Return-if number (no Cost/Profit)", () => {
    useTradingFormStateMock.mockReturnValue(
      makeTradingFormState({
        marketBuyAmount: 1.06,
        calculations: {
          price: 0.176,
          total: 1.056,
          size: 6,
          potentialWin: 4.92,
          potentialLoss: 1.056,
          returnPercent: "465.9",
        },
        hasCredentials: true,
        isConnected: true,
      })
    );

    render(
      <TradingForm
        marketTitle="France"
        tokenId="france-token"
        outcomes={[
          {
            name: "YES",
            tokenId: "france-token",
            price: 0.176,
            probability: 18,
          },
          {
            name: "NO",
            tokenId: "not-france-token",
            price: 0.825,
            probability: 82,
          },
        ]}
        selectedOutcomeIndex={0}
        onOutcomeChange={() => {}}
        bestBid={0.175}
        bestAsk={0.176}
        disableSticky
      />
    );

    // Hero shows the gross return ($4.92 + $1.056 = $5.98) and the % gain.
    expect(screen.getByText("Return if YES").parentElement).toHaveTextContent(
      "$5.98"
    );
    expect(screen.getByText("465.9%")).toBeInTheDocument();
    // Cost and Profit are intentionally dropped for market orders.
    expect(screen.queryByText("Cost")).not.toBeInTheDocument();
    expect(screen.queryByText("Profit")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /buy 6 shares for \$1\.06/i })
    ).toBeInTheDocument();
    // No fee estimate in this state, so no fee row — see the pair of fee tests.
    expect(screen.queryByText(/est\. fee/i)).not.toBeInTheDocument();
  });

  // Orders sign without `maxSpend`, so the fee is charged on top of what you
  // typed. The fee row plus the total are what make the real debit visible.
  it("shows the estimated fee and the resulting total for a BUY", () => {
    useTradingFormStateMock.mockReturnValue(
      makeTradingFormState({
        hasCredentials: true,
        isConnected: true,
        estimatedFeeUsd: 0.0125,
      })
    );

    renderDefaultForm();

    expect(screen.getByText("Est. fee").parentElement).toHaveTextContent(
      "$0.01"
    );
    // `calculations.total` is 6, so the debit is 6 + 0.0125.
    expect(screen.getByText("Est. total").parentElement).toHaveTextContent(
      "$6.01"
    );
  });

  // A fee we could not read is not a zero fee.
  it("omits the fee row when the estimate is unavailable", () => {
    useTradingFormStateMock.mockReturnValue(
      makeTradingFormState({
        hasCredentials: true,
        isConnected: true,
        estimatedFeeUsd: null,
      })
    );

    renderDefaultForm();

    expect(screen.queryByText(/est\. fee/i)).not.toBeInTheDocument();
  });

  it("uses a USD amount input for MARKET BUY (no shares stepper)", () => {
    useTradingFormStateMock.mockReturnValue(
      makeTradingFormState({
        side: "BUY",
        orderType: "MARKET",
        marketBuyAmount: 5,
        calculations: {
          price: 0.5,
          total: 5,
          size: 10,
          potentialWin: 5,
          potentialLoss: 5,
          returnPercent: "100",
        },
      })
    );

    render(
      <TradingForm
        marketTitle="Portugal"
        tokenId="portugal-token"
        outcomes={[
          {
            name: "Portugal",
            tokenId: "portugal-token",
            price: 0.08,
            probability: 8,
          },
          {
            name: "Field",
            tokenId: "field-token",
            price: 0.92,
            probability: 92,
          },
        ]}
        selectedOutcomeIndex={0}
        onOutcomeChange={() => {}}
        bestBid={0.079}
        bestAsk={0.08}
        disableSticky
      />
    );

    expect(screen.getByLabelText("Order amount in dollars")).toHaveValue("5");
    expect(screen.queryByLabelText("Share quantity")).not.toBeInTheDocument();
    expect(screen.getByText(/≈\s*10 shares/)).toBeInTheDocument();
  });

  it("preserves the decimal point while typing a MARKET BUY amount", () => {
    useTradingFormStateMock.mockImplementation(() => {
      const [marketBuyAmount, setMarketBuyAmount] = useState(0);

      return makeTradingFormState({
        side: "BUY",
        orderType: "MARKET",
        marketBuyAmount,
        setMarketBuyAmount,
        calculations: {
          price: 0.5,
          total: marketBuyAmount,
          size: marketBuyAmount / 0.5,
          potentialWin: marketBuyAmount,
          potentialLoss: marketBuyAmount,
          returnPercent: "100",
        },
      });
    });

    render(
      <TradingForm
        marketTitle="Portugal"
        tokenId="portugal-token"
        outcomes={[
          {
            name: "Portugal",
            tokenId: "portugal-token",
            price: 0.08,
            probability: 8,
          },
          {
            name: "Field",
            tokenId: "field-token",
            price: 0.92,
            probability: 92,
          },
        ]}
        selectedOutcomeIndex={0}
        onOutcomeChange={() => {}}
        bestBid={0.079}
        bestAsk={0.08}
        disableSticky
      />
    );

    const amountInput = screen.getByLabelText(
      "Order amount in dollars"
    ) as HTMLInputElement;

    fireEvent.change(amountInput, { target: { value: "1." } });
    fireEvent.change(amountInput, {
      target: { value: `${amountInput.value}06` },
    });

    expect(amountInput).toHaveValue("1.06");
  });

  it("uses the derived filled share count in MARKET BUY submit reporting", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(true);
    useTradingFormStateMock.mockReturnValue(
      makeTradingFormState({
        side: "BUY",
        orderType: "MARKET",
        shares: 10,
        marketBuyAmount: 1.06,
        calculations: {
          price: 0.176,
          total: 1.06,
          size: 6,
          potentialWin: 4.94,
          potentialLoss: 1.06,
          returnPercent: "466.0",
        },
        hasCredentials: true,
        isConnected: true,
        handleSubmit,
      })
    );

    render(
      <TradingForm
        marketTitle="France"
        tokenId="france-token"
        outcomes={[
          {
            name: "YES",
            tokenId: "france-token",
            price: 0.176,
            probability: 18,
          },
          {
            name: "NO",
            tokenId: "not-france-token",
            price: 0.825,
            probability: 82,
          },
        ]}
        selectedOutcomeIndex={0}
        onOutcomeChange={() => {}}
        bestBid={0.175}
        bestAsk={0.176}
        disableSticky
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /buy 6 shares for \$1\.06/i })
    );

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(posthog.capture).toHaveBeenCalledWith(
      "trade_button_clicked",
      expect.objectContaining({
        product: "web",
        surface: "trading_form",
        side: "BUY",
        order_type: "MARKET",
        order_value: 1.06,
      })
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "order_submitted",
      expect.objectContaining({
        shares: 6,
        total_cost: 1.06,
      })
    );
    expect(posthog.capture).not.toHaveBeenCalledWith(
      "order_succeeded",
      expect.objectContaining({
        product: "web",
        side: "BUY",
        order_type: "MARKET",
        shares: 6,
        order_value: 1.06,
        total_cost: 1.06,
      })
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Order submitted",
      expect.objectContaining({
        description: "Check your portfolio for confirmed fills.",
      })
    );
  });

  it("tracks a failed order attempt without recording a success", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(false);
    useTradingFormStateMock.mockReturnValue(
      makeTradingFormState({
        hasCredentials: true,
        isConnected: true,
        handleSubmit,
      })
    );

    renderDefaultForm();

    fireEvent.click(
      screen.getByRole("button", { name: /buy 10 shares for \$6/i })
    );

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(posthog.capture).toHaveBeenCalledWith(
      "trade_button_clicked",
      expect.objectContaining({
        product: "web",
        surface: "trading_form",
        side: "BUY",
        order_type: "MARKET",
        order_value: 6,
      })
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "trade_form_submission_failed",
      expect.objectContaining({
        product: "web",
        surface: "trading_form",
        failure_stage: "submission",
      })
    );
    expect(posthog.capture).not.toHaveBeenCalledWith(
      "order_succeeded",
      expect.anything()
    );
  });

  it("keeps the shares stepper for MARKET SELL", () => {
    useTradingFormStateMock.mockReturnValue(
      makeTradingFormState({
        side: "SELL",
        orderType: "MARKET",
        shares: 25,
        maxSellShares: 40,
      })
    );

    render(
      <TradingForm
        marketTitle="Portugal"
        tokenId="portugal-token"
        outcomes={[
          {
            name: "Portugal",
            tokenId: "portugal-token",
            price: 0.08,
            probability: 8,
          },
          {
            name: "Field",
            tokenId: "field-token",
            price: 0.92,
            probability: 92,
          },
        ]}
        selectedOutcomeIndex={0}
        onOutcomeChange={() => {}}
        bestBid={0.079}
        bestAsk={0.08}
        disableSticky
      />
    );

    expect(screen.getByLabelText("Share quantity")).toHaveValue("25");
    expect(
      screen.queryByLabelText("Order amount in dollars")
    ).not.toBeInTheDocument();
  });

  it("tracks successful sell orders as both order and sell successes", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(true);
    useTradingFormStateMock.mockReturnValue(
      makeTradingFormState({
        side: "SELL",
        orderType: "MARKET",
        shares: 25,
        maxSellShares: 40,
        hasCredentials: true,
        isConnected: true,
        handleSubmit,
      })
    );

    render(
      <TradingForm
        marketTitle="Portugal"
        tokenId="portugal-token"
        outcomes={[
          {
            name: "Portugal",
            tokenId: "portugal-token",
            price: 0.08,
            probability: 8,
          },
          {
            name: "Field",
            tokenId: "field-token",
            price: 0.92,
            probability: 92,
          },
        ]}
        selectedOutcomeIndex={0}
        onOutcomeChange={() => {}}
        bestBid={0.079}
        bestAsk={0.08}
        disableSticky
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /sell 10 shares for \$6/i })
    );

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(posthog.capture).not.toHaveBeenCalledWith(
      "order_succeeded",
      expect.objectContaining({
        product: "web",
        side: "SELL",
        order_type: "MARKET",
      })
    );
    expect(posthog.capture).not.toHaveBeenCalledWith(
      "sell_succeeded",
      expect.objectContaining({
        product: "web",
        side: "SELL",
        order_type: "MARKET",
      })
    );
  });

  it("uses the full fractional position size when MARKET SELL Max is clicked", () => {
    const setShares = vi.fn();
    useTradingFormStateMock.mockReturnValue(
      makeTradingFormState({
        side: "SELL",
        orderType: "MARKET",
        shares: 1,
        setShares,
        maxSellShares: 1.5873,
      })
    );

    render(
      <TradingForm
        marketTitle="Switzerland"
        tokenId="switzerland-token"
        outcomes={[
          {
            name: "Switzerland",
            tokenId: "switzerland-token",
            price: 0.63,
            probability: 63,
          },
          {
            name: "Field",
            tokenId: "field-token",
            price: 0.38,
            probability: 38,
          },
        ]}
        selectedOutcomeIndex={0}
        onOutcomeChange={() => {}}
        bestBid={0.62}
        bestAsk={0.63}
        disableSticky
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "MAX" }));

    expect(setShares).toHaveBeenCalledWith(1.5873);
  });

  it("renders simultaneous warning banners without duplicate React keys", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    useTradingFormStateMock.mockReturnValue(
      makeTradingFormState({
        isConnected: true,
        hasCredentials: true,
        error: new Error("Approval failed"),
        hasMissingTradingApprovals: true,
      })
    );

    try {
      render(
        <TradingForm
          marketTitle="Portugal"
          tokenId="portugal-token"
          outcomes={[
            {
              name: "Portugal",
              tokenId: "portugal-token",
              price: 0.08,
              probability: 8,
            },
            {
              name: "Field",
              tokenId: "field-token",
              price: 0.92,
              probability: 92,
            },
          ]}
          selectedOutcomeIndex={0}
          onOutcomeChange={() => {}}
          bestBid={0.079}
          bestAsk={0.08}
          disableSticky
        />
      );

      expect(
        consoleError.mock.calls.some((args) =>
          args.some(
            (arg) =>
              typeof arg === "string" &&
              arg.includes("Encountered two children with the same key")
          )
        )
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  describe("MARKET order submit label", () => {
    const outcomes = [
      { name: "GUY", tokenId: "guy-token", price: 0.63, probability: 63 },
      { name: "LAH", tokenId: "lah-token", price: 0.39, probability: 39 },
    ];

    function renderForm() {
      render(
        <TradingForm
          marketTitle="Guyana vs Lahore"
          tokenId="lah-token"
          outcomes={outcomes}
          selectedOutcomeIndex={1}
          onOutcomeChange={() => {}}
          bestBid={0.38}
          bestAsk={0.39}
          disableSticky
        />
      );
    }

    it("does not blame liquidity when no amount has been entered", () => {
      useTradingFormStateMock.mockReturnValue(
        makeTradingFormState({
          isConnected: true,
          hasCredentials: true,
          marketBuyAmount: 0,
          calculations: {
            price: 0,
            total: 0,
            size: 0,
            potentialWin: 0,
            potentialLoss: 0,
            returnPercent: "0.0",
          },
          slippageResult: null,
          isBelowMarketableBuyMinNotional: true,
          canPlaceMarketOrder: false,
          hasInsufficientLiquidity: false,
          isOrderBookUnavailable: false,
          isMarketOrderSizeEmpty: true,
        })
      );

      renderForm();

      expect(screen.queryByText(/insufficient liquidity/i)).toBeNull();
      expect(
        screen.getByRole("button", { name: /enter amount/i })
      ).toBeDisabled();
    });

    it("says the book is unavailable when it has not loaded", () => {
      useTradingFormStateMock.mockReturnValue(
        makeTradingFormState({
          isConnected: true,
          hasCredentials: true,
          marketBuyAmount: 5,
          slippageResult: null,
          canPlaceMarketOrder: false,
          hasInsufficientLiquidity: false,
          isOrderBookUnavailable: true,
        })
      );

      renderForm();

      expect(screen.queryByText(/insufficient liquidity/i)).toBeNull();
      expect(
        screen.getByRole("button", { name: /order book unavailable/i })
      ).toBeDisabled();
    });

    it("reports insufficient liquidity only when the book was walked short", () => {
      useTradingFormStateMock.mockReturnValue(
        makeTradingFormState({
          isConnected: true,
          hasCredentials: true,
          marketBuyAmount: 5000,
          slippageResult: {
            canFill: false,
            avgFillPrice: 0.42,
            bestPrice: 0.39,
            worstPrice: 0.5,
            slippage: 0.11,
            slippagePercent: 28.2,
            totalNotional: 100,
            fills: [],
            unfilledSize: 4800,
            filledSize: 200,
          },
          canPlaceMarketOrder: false,
          hasInsufficientLiquidity: true,
          isOrderBookUnavailable: false,
        })
      );

      renderForm();

      expect(
        screen.getByRole("button", { name: /insufficient liquidity/i })
      ).toBeDisabled();
    });

    it("offers the partial fill instead of blocking when FAK is allowed", () => {
      useTradingFormStateMock.mockReturnValue(
        makeTradingFormState({
          isConnected: true,
          hasCredentials: true,
          marketBuyAmount: 5000,
          calculations: {
            price: 0.87,
            total: 86,
            size: 100,
            potentialWin: 14,
            potentialLoss: 86,
            returnPercent: "16.3",
          },
          partialFill: {
            filledShares: 100,
            filledUsd: 86,
            requestedUsd: 5000,
            requestedShares: null,
          },
          canPlaceMarketOrder: true,
          hasInsufficientLiquidity: false,
          isOrderBookUnavailable: false,
        })
      );

      renderForm();

      expect(screen.queryByText(/insufficient liquidity/i)).toBeNull();
      expect(
        screen.getByText(/Fills \$86\.00 of \$5000\.00/)
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /buy 100 shares/i })
      ).toBeEnabled();
    });
  });

  describe("submit readiness gate", () => {
    const outcomes = [
      { name: "GUY", tokenId: "guy-token", price: 0.63, probability: 63 },
      { name: "LAH", tokenId: "lah-token", price: 0.39, probability: 39 },
    ];

    function renderForm() {
      render(
        <TradingForm
          marketTitle="Guyana vs Lahore"
          tokenId="lah-token"
          outcomes={outcomes}
          selectedOutcomeIndex={1}
          onOutcomeChange={() => {}}
          bestBid={0.38}
          bestAsk={0.39}
          disableSticky
        />
      );
    }

    // `handleSubmit` bails out on `!canTrade` before it touches the CLOB, so a
    // button that looks ready while `canTrade` is false is a dead click: no
    // toast, no error banner, nothing. The disabled set has to cover every
    // precondition `handleSubmit` enforces.
    it("does not offer a live Buy action while the wallet is still preparing", () => {
      useTradingFormStateMock.mockReturnValue(
        makeTradingFormState({
          isConnected: true,
          hasCredentials: true,
          canTrade: false,
        })
      );

      renderForm();

      expect(
        screen.queryByRole("button", { name: /buy .* shares/i })
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: /preparing wallet/i })
      ).toBeDisabled();
    });

    it("does not run a dead submit when the wallet is not ready", () => {
      const handleSubmit = vi.fn();
      useTradingFormStateMock.mockReturnValue(
        makeTradingFormState({
          isConnected: true,
          hasCredentials: true,
          canTrade: false,
          handleSubmit,
        })
      );

      renderForm();
      fireEvent.click(
        screen.getByRole("button", { name: /preparing wallet/i })
      );

      expect(handleSubmit).not.toHaveBeenCalled();
    });

    it("offers the live Buy action once the wallet is ready", () => {
      useTradingFormStateMock.mockReturnValue(
        makeTradingFormState({
          isConnected: true,
          hasCredentials: true,
          canTrade: true,
        })
      );

      renderForm();

      expect(screen.queryByText(/preparing wallet/i)).toBeNull();
      expect(
        screen.getByRole("button", { name: /buy .* shares/i })
      ).toBeEnabled();
    });
  });
});
