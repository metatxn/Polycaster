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
  default: {
    capture: vi.fn(),
  },
}));

vi.mock("@/hooks/use-sell-position", () => ({
  useSellPosition: ({
    onSellSuccess,
  }: {
    onSellSuccess?: (result: {
      shares: number;
      estimatedProceeds: number;
      estimatedPrice: number;
    }) => void;
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
      expect(toastMock.success).toHaveBeenCalledWith("Sell order filled", {
        description: "Estimated proceeds: $1.24.",
      });
    });
  });
});
