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
    handleSetAllowance: vi.fn(),
    handleSubmit: vi.fn(),
    hasValidTokenId: true,
    canFullyFill: true,
    ...overrides,
  };
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
      "order_submitted",
      expect.objectContaining({
        shares: 6,
        total_cost: 1.06,
      })
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Order filled",
      expect.objectContaining({
        description: "Bought 6 YES at market.",
      })
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
});
