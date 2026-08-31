import { describe, expect, it } from "vitest";
import {
  callTool,
  clobUrl,
  dataUrl,
  devEnv,
  dispatch,
  expectGammaFetch,
  gammaUrl,
  mcpRequest,
  PROTOCOL_VERSION,
  readJsonRpc,
  setupGammaFetchStub,
  type ToolCallResult,
} from "./helpers";

const CONDITION_ID = `0x${"a".repeat(64)}`;
const WALLET = `0x${"b".repeat(40)}`;
const TOKEN_ID = "123456789";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const POSITION = {
  proxyWallet: WALLET,
  asset: TOKEN_ID,
  conditionId: CONDITION_ID,
  size: 10,
  avgPrice: 0.4,
  initialValue: 4,
  currentValue: 6,
  cashPnl: 2,
  percentPnl: 50,
  totalBought: 10,
  realizedPnl: 0.5,
  percentRealizedPnl: 12.5,
  curPrice: 0.6,
  redeemable: false,
  mergeable: false,
  title: "Quoted upstream title",
  slug: "market",
  eventSlug: "event",
  outcome: "Yes",
  outcomeIndex: 0,
};

describe("public read tools", () => {
  setupGammaFetchStub();

  it("publishes every getter as a read-only tool", async () => {
    const response = await dispatch(
      mcpRequest(
        { jsonrpc: "2.0", id: 200, method: "tools/list" },
        { headers: { "mcp-protocol-version": PROTOCOL_VERSION } }
      ),
      devEnv
    );
    const message = await readJsonRpc(response);
    const tools = message.result?.tools as Array<{
      name: string;
      annotations?: Record<string, unknown>;
      inputSchema?: { properties?: Record<string, unknown> };
    }>;
    const expected = [
      "list_events",
      "get_market_trades",
      "get_market_quotes",
      "get_market_holders",
      "get_open_interest",
      "get_event_live_volume",
      "get_trader_leaderboard",
      "list_tags",
      "list_sports_markets",
      "get_public_profile",
      "get_wallet_positions",
      "get_wallet_activity",
      "get_closed_positions",
      "get_wallet_pnl",
      "get_wallet_portfolio_value",
    ];

    for (const name of expected) {
      const tool = tools.find((entry) => entry.name === name);
      expect(tool, name).toBeDefined();
      expect(tool?.annotations, name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
    for (const name of expected.filter(
      (entry) =>
        entry.includes("wallet") ||
        entry === "get_public_profile" ||
        entry === "get_closed_positions"
    )) {
      const tool = tools.find((entry) => entry.name === name);
      expect(tool?.inputSchema?.properties, name).toHaveProperty(
        "walletAddress"
      );
    }
    const listEvents = tools.find((entry) => entry.name === "list_events");
    expect(listEvents?.inputSchema?.properties).toHaveProperty("live");
    expect(listEvents?.inputSchema?.properties).not.toHaveProperty("active");
  });

  it("lists event data with decimal strings and cursor metadata", async () => {
    expectGammaFetch("events", gammaUrl("/events/keyset", "limit=1"), () =>
      jsonResponse({
        events: [
          {
            id: "7",
            title: "Fed decision",
            volume: 1200.5,
            liquidity: "900.25",
            markets: [],
            tags: [],
          },
        ],
        next_cursor: "next-page",
      })
    );

    const { message } = await callTool("list_events", 201, { limit: 1 });
    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.events).toMatchObject([
      { volume: "1200.5", liquidity: "900.25" },
    ]);
    expect(result.structuredContent?.meta).toMatchObject({
      nextCursor: "next-page",
    });
  });

  it("combines all CLOB quote sources", async () => {
    expectGammaFetch("prices", clobUrl("/prices"), () =>
      jsonResponse({ [TOKEN_ID]: { BUY: 0.44, SELL: 0.46 } })
    );
    expectGammaFetch("midpoints", clobUrl("/midpoints"), () =>
      jsonResponse({ [TOKEN_ID]: 0.45 })
    );
    expectGammaFetch("spreads", clobUrl("/spreads"), () =>
      jsonResponse({ [TOKEN_ID]: 0.02 })
    );
    expectGammaFetch("last trade", clobUrl("/last-trades-prices"), () =>
      jsonResponse([{ token_id: TOKEN_ID, price: 0.43, side: "SELL" }])
    );

    const { message } = await callTool("get_market_quotes", 202, {
      tokenIds: [TOKEN_ID],
    });
    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.quotes).toEqual([
      {
        tokenId: TOKEN_ID,
        buyPrice: "0.44",
        sellPrice: "0.46",
        midpoint: "0.45",
        spread: "0.02",
        lastTradePrice: "0.43",
        lastTradeSide: "SELL",
      },
    ]);
  });

  it("requires an explicit wallet address for public wallet data", async () => {
    const { message } = await callTool("get_wallet_positions", 203, {});
    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Input validation error");
  });

  it("returns projected positions with decimal strings", async () => {
    expectGammaFetch("positions", dataUrl("/positions", `user=${WALLET}`), () =>
      jsonResponse([POSITION])
    );

    const { message } = await callTool("get_wallet_positions", 204, {
      walletAddress: WALLET,
    });
    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.positions).toMatchObject([
      {
        size: "10",
        avgPrice: "0.4",
        currentValue: "6",
        cashPnl: "2",
      },
    ]);
  });

  it("calculates wallet PnL with Decimal.js-safe values", async () => {
    expectGammaFetch("pnl positions", dataUrl("/positions", `limit=500`), () =>
      jsonResponse([
        POSITION,
        {
          ...POSITION,
          asset: "987654321",
          initialValue: 3,
          currentValue: 2,
          cashPnl: -1,
          realizedPnl: 0.25,
        },
      ])
    );

    const { message } = await callTool("get_wallet_pnl", 205, {
      walletAddress: WALLET,
    });
    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.pnl).toEqual({
      positionCount: 2,
      initialValue: "7",
      currentValue: "8",
      cashPnl: "1",
      realizedPnl: "0.75",
      totalPnl: "1.75",
      roiPercent: "25",
      winningPositions: 1,
      losingPositions: 1,
    });
  });
});
