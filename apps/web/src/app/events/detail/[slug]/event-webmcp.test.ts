import { describe, expect, it, vi } from "vitest";
import type { PreparedTradeTicket } from "@/types/market";
import {
  createEventWebMcpTools,
  type EventWebMcpSnapshot,
} from "./event-webmcp";

const snapshot: EventWebMcpSnapshot = {
  event: {
    id: "event-1",
    slug: "will-it-rain",
    title: "Will it rain?",
    status: "open",
    endDate: "2026-09-10T00:00:00.000Z",
    volume: "1000",
    liquidity: "500",
  },
  markets: [
    {
      id: "market-1",
      question: "Will it rain in London?",
      label: "London",
      status: "open",
      outcomes: [
        { index: 0, name: "Yes", price: 0.62, probability: 62 },
        { index: 1, name: "No", price: 0.38, probability: 38 },
      ],
    },
    {
      id: "market-2",
      question: "Will it rain in Tokyo?",
      label: "Tokyo",
      status: "open",
      outcomes: [
        { index: 0, name: "Yes", price: 0.48, probability: 48 },
        { index: 1, name: "No", price: 0.52, probability: 52 },
      ],
    },
    {
      id: "market-3",
      question: "Will London record snow?",
      label: "London snow",
      status: "closed",
      outcomes: [
        { index: 0, name: "Yes", price: 1, probability: 100 },
        { index: 1, name: "No", price: 0, probability: 0 },
      ],
    },
  ],
  selected: {
    marketId: "market-1",
    marketLabel: "London",
    outcomeIndex: 0,
    outcomeName: "Yes",
    outcomePrice: 0.62,
  },
  chartRange: "1D",
  orderBook: {
    bestBid: 0.61,
    bestAsk: 0.63,
    spread: 0.02,
    tickSize: 0.01,
    minOrderSize: 1,
    isLive: true,
    bids: [
      { price: "0.61", size: "25" },
      { price: "0.60", size: "40" },
      { price: "0.59", size: "10" },
    ],
    asks: [
      { price: "0.63", size: "30" },
      { price: "0.64", size: "50" },
      { price: "0.65", size: "15" },
    ],
  },
  observedAt: "2026-09-03T10:00:00.000Z",
};

function setup(currentSnapshot: EventWebMcpSnapshot = snapshot) {
  const selectMarket = vi.fn();
  const setChartRange = vi.fn();
  const prepareTrade = vi.fn<(draft: PreparedTradeTicket) => void>();
  const tools = createEventWebMcpTools({
    getSnapshot: () => currentSnapshot,
    selectMarket,
    setChartRange,
    prepareTrade,
  });

  const byName = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Missing tool: ${name}`);
    return tool;
  };

  return { byName, prepareTrade, selectMarket, setChartRange, tools };
}

describe("event WebMCP tools", () => {
  it("returns the current page context as untrusted, read-only data", async () => {
    const { byName } = setup();
    const tool = byName("get_current_event_context");
    const { bids: _bids, asks: _asks, ...orderBook } = snapshot.orderBook;

    await expect(tool.execute({})).resolves.toEqual({ ...snapshot, orderBook });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
  });

  it("selects only a market and outcome that exist on the page", async () => {
    const { byName, selectMarket } = setup();
    const tool = byName("select_market_view");

    await expect(
      tool.execute({ market_id: "market-1", outcome_index: 1 })
    ).resolves.toMatchObject({
      market_id: "market-1",
      outcome_index: 1,
      outcome_name: "No",
    });
    expect(selectMarket).toHaveBeenCalledWith("market-1", 1);

    await expect(
      tool.execute({ market_id: "not-on-page", outcome_index: 0 })
    ).rejects.toThrow("Market is not available on this page");
    expect(selectMarket).toHaveBeenCalledTimes(1);
  });

  it("does not claim that a closed market was selected", async () => {
    const closedSnapshot: EventWebMcpSnapshot = {
      ...snapshot,
      markets: snapshot.markets.map((market) => ({
        ...market,
        status: "closed",
      })),
    };
    const { byName, selectMarket } = setup(closedSnapshot);

    await expect(
      byName("select_market_view").execute({
        market_id: "market-1",
        outcome_index: 0,
      })
    ).rejects.toThrow("Market is not available for selection");
    expect(selectMarket).not.toHaveBeenCalled();
  });

  it("accepts only chart ranges supported by the page", async () => {
    const { byName, setChartRange } = setup();
    const tool = byName("set_chart_range");

    await expect(tool.execute({ range: "1W" })).resolves.toEqual({
      chart_range: "1W",
      changed: true,
    });
    expect(setChartRange).toHaveBeenCalledWith("1W");

    await expect(tool.execute({ range: "2Y" })).rejects.toThrow(
      "Invalid chart range"
    );
  });

  it("finds page markets with bounded filters and result counts", async () => {
    const { byName } = setup();
    const tool = byName("find_markets_on_page");

    await expect(
      tool.execute({ query: "london", status: "all", limit: 1 })
    ).resolves.toMatchObject({
      query: "london",
      status: "all",
      total_matches: 2,
      markets: [
        {
          market_id: "market-1",
          market: "London",
          status: "open",
        },
      ],
    });
    await expect(tool.execute({ query: "", limit: 50 })).rejects.toThrow(
      "Invalid market search"
    );
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
  });

  it("compares one outcome across two to five unique page markets", async () => {
    const { byName } = setup();
    const tool = byName("compare_markets");

    await expect(
      tool.execute({
        market_ids: ["market-1", "market-2"],
        outcome_index: 0,
      })
    ).resolves.toMatchObject({
      outcome_index: 0,
      markets: [
        {
          market_id: "market-1",
          market: "London",
          outcome: "Yes",
          price: 0.62,
          probability: 62,
        },
        {
          market_id: "market-2",
          market: "Tokyo",
          outcome: "Yes",
          price: 0.48,
          probability: 48,
        },
      ],
      highest_probability: { market_id: "market-1", probability: 62 },
      lowest_probability: { market_id: "market-2", probability: 48 },
      probability_range: 14,
    });
    await expect(
      tool.execute({ market_ids: ["market-1", "market-1"] })
    ).rejects.toThrow("Market IDs must be unique");
    await expect(
      tool.execute({ market_ids: ["market-1", "not-on-page"] })
    ).rejects.toThrow("One or more markets are not available on this page");
  });

  it("returns bounded depth for the currently selected order book", async () => {
    const { byName } = setup();
    const tool = byName("get_selected_order_book");

    await expect(tool.execute({ levels: 2 })).resolves.toMatchObject({
      market_id: "market-1",
      market: "London",
      outcome_index: 0,
      outcome: "Yes",
      levels_requested: 2,
      bids: [
        { price: "0.61", size: "25" },
        { price: "0.60", size: "40" },
      ],
      asks: [
        { price: "0.63", size: "30" },
        { price: "0.64", size: "50" },
      ],
      best_bid: 0.61,
      best_ask: 0.63,
      spread: 0.02,
      is_live: true,
    });
    await expect(tool.execute({ levels: 11 })).rejects.toThrow(
      "Invalid order-book depth"
    );
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
  });

  it("prepares a market-buy ticket and never executes an order", async () => {
    const { byName, prepareTrade } = setup();
    const tool = byName("prepare_trade");

    const result = await tool.execute({
      side: "BUY",
      order_type: "MARKET",
      amount_usd: 12.4,
      allow_partial_fill: false,
    });

    expect(prepareTrade).toHaveBeenCalledWith({
      revision: 1,
      marketId: "market-1",
      outcomeIndex: 0,
      side: "BUY",
      orderType: "MARKET",
      amountUsd: 12.4,
      allowPartialFill: false,
    });
    expect(result).toMatchObject({
      prepared: true,
      executed: false,
      market: "London",
      outcome: "Yes",
      estimate: {
        reference_price: 0.63,
        estimated_shares: 19.68254,
        estimated_total_usd: 12.4,
      },
    });
  });

  it("normalizes a limit price to the market tick before preparing it", async () => {
    const { byName, prepareTrade } = setup();

    const result = await byName("prepare_trade").execute({
      side: "BUY",
      order_type: "LIMIT",
      shares: 10,
      limit_price: 0.427,
    });

    expect(prepareTrade).toHaveBeenCalledWith(
      expect.objectContaining({ limitPrice: 0.43 })
    );
    expect(result).toMatchObject({
      estimate: {
        reference_price: 0.43,
        estimated_total_usd: 4.3,
      },
    });
  });

  it("rejects a market estimate when no usable price is available", async () => {
    const noPriceSnapshot: EventWebMcpSnapshot = {
      ...snapshot,
      markets: snapshot.markets.map((market) => ({
        ...market,
        outcomes: market.outcomes.map((outcome) => ({ ...outcome, price: 0 })),
      })),
      selected: { ...snapshot.selected, outcomePrice: 0 },
      orderBook: {
        tickSize: 0.01,
        minOrderSize: 1,
        isLive: false,
        bids: [],
        asks: [],
      },
    };
    const { byName, prepareTrade } = setup(noPriceSnapshot);

    await expect(
      byName("prepare_trade").execute({
        side: "BUY",
        order_type: "MARKET",
        amount_usd: 10,
      })
    ).rejects.toThrow("A valid reference price is unavailable");
    expect(prepareTrade).not.toHaveBeenCalled();
  });

  it("rejects ambiguous trade sizes before changing the ticket", async () => {
    const { byName, prepareTrade } = setup();
    const tool = byName("prepare_trade");

    await expect(
      tool.execute({
        side: "BUY",
        order_type: "MARKET",
        shares: 10,
      })
    ).rejects.toThrow("MARKET BUY requires amount_usd");

    await expect(
      tool.execute({
        side: "SELL",
        order_type: "LIMIT",
        shares: 10,
      })
    ).rejects.toThrow("LIMIT requires limit_price");
    expect(prepareTrade).not.toHaveBeenCalled();
  });
});
