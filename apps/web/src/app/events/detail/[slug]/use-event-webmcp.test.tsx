import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebMcpTool } from "@/lib/webmcp";
import type { PreparedTradeTicket } from "@/types/market";
import type { EventWebMcpSnapshot } from "./event-webmcp";
import { useEventWebMcp } from "./use-event-webmcp";

const webMcpMocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  register: vi.fn(),
}));

vi.mock("@/lib/webmcp", () => ({
  registerWebMcpTools: webMcpMocks.register,
}));

function createSnapshot(title: string): EventWebMcpSnapshot {
  return {
    event: {
      id: "event-1",
      slug: "event-1",
      title,
      status: "open",
    },
    markets: [
      {
        id: "market-1",
        question: title,
        label: title,
        status: "open",
        outcomes: [
          { index: 0, name: "Yes", price: 0.6, probability: 60 },
          { index: 1, name: "No", price: 0.4, probability: 40 },
        ],
      },
    ],
    selected: {
      marketId: "market-1",
      marketLabel: title,
      outcomeIndex: 0,
      outcomeName: "Yes",
      outcomePrice: 0.6,
    },
    chartRange: "ALL",
    orderBook: {
      tickSize: 0.01,
      minOrderSize: 1,
      isLive: false,
      bids: [],
      asks: [],
    },
    observedAt: "2026-09-03T10:00:00.000Z",
  };
}

describe("useEventWebMcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webMcpMocks.register.mockReturnValue(webMcpMocks.cleanup);
  });

  it("registers once, serves fresh page state, and cleans up on unmount", async () => {
    const actions = {
      selectMarket: vi.fn(),
      setChartRange: vi.fn(),
      prepareTrade: vi.fn<(draft: PreparedTradeTicket) => void>(),
    };
    const { rerender, unmount } = renderHook(
      ({ snapshot }) => useEventWebMcp({ snapshot, ...actions }),
      { initialProps: { snapshot: createSnapshot("Initial title") } }
    );

    expect(webMcpMocks.register).toHaveBeenCalledTimes(1);
    rerender({ snapshot: createSnapshot("Fresh title") });

    const tools = webMcpMocks.register.mock.calls[0]?.[0] as WebMcpTool[];
    const contextTool = tools.find(
      (tool) => tool.name === "get_current_event_context"
    );
    await expect(contextTool?.execute({})).resolves.toMatchObject({
      event: { title: "Fresh title" },
    });
    expect(webMcpMocks.register).toHaveBeenCalledTimes(1);

    unmount();
    expect(webMcpMocks.cleanup).toHaveBeenCalledOnce();
  });
});
