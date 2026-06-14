import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TradingForm } from "./trading-form";

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
  useTradingFormState: vi.fn(() => ({
    side: "BUY",
    setSide: vi.fn(),
    orderType: "MARKET",
    setOrderType: vi.fn(),
    limitPrice: 0.6,
    setLimitPrice: vi.fn(),
    shares: 10,
    setShares: vi.fn(),
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
  })),
}));

describe("TradingForm", () => {
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
});
