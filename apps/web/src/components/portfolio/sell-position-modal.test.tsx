import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Position } from "./types";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
}));

const sellHookMock = vi.hoisted(() => ({
  executeSell: vi.fn(),
  shouldFail: false,
}));

const posthogMock = vi.hoisted(() => ({
  capture: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("next/image", () => ({
  default: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("posthog-js", () => ({
  default: posthogMock,
}));

vi.mock("@/hooks/use-sell-position", () => ({
  useSellPosition: ({
    onSellSuccess,
    onSellError,
  }: {
    onSellSuccess?: (result: {
      shares: number;
      estimatedProceeds: number;
      estimatedPrice: number;
    }) => void;
    onSellError?: (error: Error) => void;
  }) => ({
    shares: 2,
    setShares: vi.fn(),
    isLoading: false,
    isSubmitting: false,
    error: null,
    canTrade: true,
    sellEstimate: {
      estimatedPrice: 0.62,
      estimatedProceeds: 1.24,
      slippagePercent: 0,
      canFill: true,
    },
    handleSharesChange: vi.fn(),
    setMaxShares: vi.fn(),
    executeSell: sellHookMock.executeSell.mockImplementation(async () => {
      if (sellHookMock.shouldFail) {
        onSellError?.(new Error("Order rejected"));
        return;
      }
      onSellSuccess?.({
        shares: 2,
        estimatedProceeds: 1.24,
        estimatedPrice: 0.62,
      });
    }),
    resetShares: vi.fn(),
  }),
}));

import { SellPositionModal } from "./sell-position-modal";

const position: Position = {
  id: "position-1",
  outcome: "Yes",
  size: 2,
  avgPrice: 0.4,
  currentPrice: 0.62,
  currentValue: 1.24,
  initialValue: 0.8,
  unrealizedPnl: 0.44,
  unrealizedPnlPercent: 55,
  asset: "token-1",
  conditionId: "condition-1",
  market: {
    title: "Will the SDK migration work?",
    slug: "sdk-migration",
    eventSlug: "sdk-migration-event",
  },
};

describe("SellPositionModal", () => {
  beforeEach(() => {
    toastMock.success.mockClear();
    sellHookMock.executeSell.mockClear();
    sellHookMock.shouldFail = false;
    posthogMock.capture.mockClear();
  });

  it("shows a success toast after a market sell order succeeds", async () => {
    render(
      createElement(SellPositionModal, {
        open: true,
        onOpenChange: vi.fn(),
        position,
      })
    );

    await userEvent.click(
      screen.getByRole("button", { name: /quick sell \(market order\)/i })
    );

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Sell order submitted", {
        description: "Estimated proceeds: $1.24.",
      });
    });
    expect(posthogMock.capture).toHaveBeenCalledWith(
      "trade_button_clicked",
      expect.objectContaining({
        product: "web",
        side: "SELL",
        order_type: "MARKET",
        surface: "portfolio_quick_sell",
        shares: 2,
        order_value: 1.24,
      })
    );
    expect(posthogMock.capture).not.toHaveBeenCalledWith(
      "order_succeeded",
      expect.objectContaining({
        product: "web",
        side: "SELL",
        order_type: "MARKET",
        surface: "portfolio_quick_sell",
        shares: 2,
        order_value: 1.24,
      })
    );
    expect(posthogMock.capture).not.toHaveBeenCalledWith(
      "sell_succeeded",
      expect.objectContaining({
        product: "web",
        side: "SELL",
        order_type: "MARKET",
        surface: "portfolio_quick_sell",
      })
    );
  });

  it("tracks a failed quick-sell attempt without recording a success", async () => {
    sellHookMock.shouldFail = true;

    render(
      createElement(SellPositionModal, {
        open: true,
        onOpenChange: vi.fn(),
        position,
      })
    );

    await userEvent.click(
      screen.getByRole("button", { name: /quick sell \(market order\)/i })
    );

    await waitFor(() => {
      expect(posthogMock.capture).toHaveBeenCalledWith(
        "trade_form_submission_failed",
        expect.objectContaining({
          product: "web",
          surface: "portfolio_quick_sell",
          failure_stage: "submission",
        })
      );
    });
    expect(posthogMock.capture).not.toHaveBeenCalledWith(
      "order_succeeded",
      expect.anything()
    );
  });
});
