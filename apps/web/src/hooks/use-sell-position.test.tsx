import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Position } from "@/components/portfolio/types";
import { useOrderBookStore } from "./use-orderbook-store";
import { useSellPosition } from "./use-sell-position";

const clobMocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
}));

const fetchMocks = vi.hoisted(() => ({
  fetchClobOrderBook: vi.fn(),
}));

vi.mock("@knoww/shared-types/clob", () => ({
  fetchClobOrderBook: fetchMocks.fetchClobOrderBook,
}));

vi.mock("@/hooks/use-clob-client", () => ({
  OrderType: {
    FAK: "FAK",
  },
  Side: {
    SELL: "SELL",
  },
  useClobClient: () => ({
    createOrder: clobMocks.createOrder,
    isLoading: false,
    error: null,
    canTrade: true,
  }),
}));

vi.mock("@/hooks/use-proxy-wallet", () => ({
  useProxyWallet: () => ({
    proxyAddress: "0x0000000000000000000000000000000000000002",
  }),
}));

vi.mock("@/hooks/use-shared-websocket", () => ({
  useOrderBookWebSocket: vi.fn(),
}));

vi.mock("@/lib/rpc", () => ({
  clearBalanceCache: vi.fn(),
}));

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const worldCupPosition: Position = {
  id: "position-1",
  outcome: "Portugal",
  size: 10,
  avgPrice: 0.42,
  currentPrice: 0.435,
  currentValue: 4.35,
  initialValue: 4.2,
  unrealizedPnl: 0.15,
  unrealizedPnlPercent: 3.57,
  asset: "12345678901234567890",
  conditionId: "condition-1",
  negRisk: false,
  market: {
    title: "Portugal vs Spain",
    slug: "portugal-spain-world-cup",
    eventSlug: "world-cup",
  },
};

describe("useSellPosition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrderBookStore.getState().clearAllOrderBooks();
    clobMocks.createOrder.mockResolvedValue({
      success: true,
      order: { id: "order-1" },
    });
    fetchMocks.fetchClobOrderBook.mockResolvedValue({
      bids: [{ price: "0.4350", size: "20" }],
      asks: [{ price: "0.4375", size: "20" }],
      tick_size: "0.0025",
      min_order_size: "5",
    });
  });

  it("rounds quick-sell FAK prices to the market tick size from the order book", async () => {
    const { result } = renderHook(
      () => useSellPosition({ position: worldCupPosition }),
      { wrapper: wrapper() }
    );

    await waitFor(() => {
      expect(result.current.sellEstimate.canFill).toBe(true);
    });

    await act(async () => {
      await result.current.executeSell();
    });

    expect(clobMocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 0.4325,
        orderType: "FAK",
        side: "SELL",
      })
    );
  });
});
