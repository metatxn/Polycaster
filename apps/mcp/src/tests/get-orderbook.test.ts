import { describe, expect, it } from "vitest";
import {
  CLOB_ORIGIN,
  callTool,
  clobUrl,
  devEnv,
  dispatch,
  expectGammaFetch,
  mcpRequest,
  PROTOCOL_VERSION,
  readJsonRpc,
  setupGammaFetchStub,
  type ToolCallResult,
} from "./helpers";

/**
 * get_orderbook tests. The CLOB /book contract these encode (probed
 * 2026-08-25): levels arrive worst-to-best on both sides, every scalar is a
 * snake_case string, and timestamp is a milliseconds epoch string. The tool
 * must re-sort with Decimal (bids descending, asks ascending), canonicalize
 * level values as decimal strings, and mark snapshots older than 60 seconds
 * as stale.
 */

const TOKEN_ID =
  "27146956652877944551877724690365745048289675287536243265951843487691050802191";
const CONDITION_ID =
  "0x0e5e7d3f9bde74f60fbfd5ba4d9c1e2b8a2f4c6d8e0a1b3c5d7e9f0a2b4c6d8e";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Mirrors the live payload: snake_case strings, both sides worst-to-best,
 * one non-canonical price ("0.4500") to prove canonicalization, and the
 * neg_risk / last_trade_price extras the service drops.
 */
function rawBook(overrides: Record<string, unknown> = {}) {
  return {
    market: CONDITION_ID,
    asset_id: TOKEN_ID,
    timestamp: String(Date.now()),
    hash: "5b686e63f5f6a2c9d4e1b8a7f0c3d6e9",
    bids: [
      { price: "0.001", size: "40" },
      { price: "0.4500", size: "100" },
      { price: "0.46", size: "60.5" },
    ],
    asks: [
      { price: "0.999", size: "1210.05" },
      { price: "0.52", size: "20" },
      { price: "0.47", size: "75" },
    ],
    min_order_size: "5",
    tick_size: "0.001",
    neg_risk: true,
    last_trade_price: "0.46",
    ...overrides,
  };
}

interface OrderbookStructured {
  orderbook: Record<string, unknown> & {
    stale?: boolean;
    bids?: Array<{ price: string; size: string }>;
    asks?: Array<{ price: string; size: string }>;
  };
  meta: {
    requestId: string;
    asOf: string;
    sources: Array<{ name: string; url?: string }>;
    truncated?: boolean;
  };
}

function structuredOf(result: ToolCallResult): OrderbookStructured {
  return result.structuredContent as unknown as OrderbookStructured;
}

describe("get_orderbook tool", () => {
  setupGammaFetchStub();

  it("appears in tools/list with read-only annotations and bounded inputs", async () => {
    const response = await dispatch(
      mcpRequest(
        { jsonrpc: "2.0", id: 60, method: "tools/list" },
        { headers: { "mcp-protocol-version": PROTOCOL_VERSION } }
      ),
      devEnv
    );
    const message = await readJsonRpc(response);
    const tools = message.result?.tools as Array<Record<string, unknown>>;
    const tool = tools.find((entry) => entry.name === "get_orderbook");

    expect(tool).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    const inputSchema = tool?.inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(inputSchema.properties).toHaveProperty("tokenId");
    expect(inputSchema.properties).toHaveProperty("depth");
    expect(String(tool?.description)).toContain("order book");
    expect(String(tool?.description)).toContain("decimal strings");
  });

  it("rejects a missing tokenId before calling upstream", async () => {
    const { message } = await callTool("get_orderbook", 61, {});
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).toContain("tokenId");
    expect(text).toContain("Do not retry with the same input.");
  });

  it("rejects a malformed tokenId before calling upstream", async () => {
    const { message } = await callTool("get_orderbook", 62, {
      tokenId: "12,34",
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain(
      "tokenId must be a string of up to 80 decimal digits."
    );
  });

  it("returns a sorted, canonicalized snapshot with spread and depth", async () => {
    const nowMs = Date.now();
    expectGammaFetch(
      "clob-book",
      clobUrl("/book", `token_id=${TOKEN_ID}`),
      () => jsonResponse(rawBook({ timestamp: String(nowMs) }))
    );

    const { response, message } = await callTool("get_orderbook", 63, {
      tokenId: TOKEN_ID,
    });
    const result = message.result as ToolCallResult;

    expect(response.status).toBe(200);
    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain(
      "Best bid 0.46, best ask 0.47, spread 0.01."
    );

    const structured = structuredOf(result);
    expect(structured.orderbook).toEqual({
      tokenId: TOKEN_ID,
      conditionId: CONDITION_ID,
      timestamp: new Date(nowMs).toISOString(),
      stale: false,
      bids: [
        { price: "0.46", size: "60.5" },
        { price: "0.45", size: "100" },
        { price: "0.001", size: "40" },
      ],
      asks: [
        { price: "0.47", size: "75" },
        { price: "0.52", size: "20" },
        { price: "0.999", size: "1210.05" },
      ],
      bestBid: "0.46",
      bestAsk: "0.47",
      spread: "0.01",
      midpoint: "0.465",
      bidDepth: "200.5",
      askDepth: "1305.05",
      minOrderSize: "5",
      tickSize: "0.001",
    });
    expect(structured.meta.requestId).toBe(
      response.headers.get("x-request-id")
    );
    expect(structured.meta.asOf).toBe(new Date(nowMs).toISOString());
    expect(structured.meta.sources).toEqual([
      { name: "polymarket-clob", url: CLOB_ORIGIN },
    ]);
    expect(structured.meta.truncated).toBeUndefined();
  });

  it("caps depth, sums depth over returned levels, and flags truncation", async () => {
    expectGammaFetch("clob-book", clobUrl("/book"), () =>
      jsonResponse(rawBook())
    );

    const { message } = await callTool("get_orderbook", 64, {
      tokenId: TOKEN_ID,
      depth: 2,
    });
    const structured = structuredOf(message.result as ToolCallResult);

    expect(structured.orderbook).toMatchObject({
      bids: [
        { price: "0.46", size: "60.5" },
        { price: "0.45", size: "100" },
      ],
      asks: [
        { price: "0.47", size: "75" },
        { price: "0.52", size: "20" },
      ],
      bidDepth: "160.5",
      askDepth: "95",
    });
    expect(structured.meta.truncated).toBe(true);
  });

  it("marks a snapshot stale when its timestamp exceeds the threshold", async () => {
    expectGammaFetch("clob-book", clobUrl("/book"), () =>
      jsonResponse(rawBook({ timestamp: String(Date.now() - 120_000) }))
    );

    const { message } = await callTool("get_orderbook", 65, {
      tokenId: TOKEN_ID,
    });
    const result = message.result as ToolCallResult;
    const structured = structuredOf(result);

    expect(structured.orderbook.stale).toBe(true);
    expect(result.content?.[0]?.text).toContain("stale");
  });

  it("marks a snapshot without a usable timestamp stale and omits the field", async () => {
    expectGammaFetch("clob-book", clobUrl("/book"), () =>
      jsonResponse(rawBook({ timestamp: undefined }))
    );

    const { message } = await callTool("get_orderbook", 66, {
      tokenId: TOKEN_ID,
    });
    const structured = structuredOf(message.result as ToolCallResult);

    expect(structured.orderbook.stale).toBe(true);
    expect(structured.orderbook).not.toHaveProperty("timestamp");
  });

  it("returns zero depths and no spread for an empty book", async () => {
    expectGammaFetch("clob-book", clobUrl("/book"), () =>
      jsonResponse(rawBook({ bids: [], asks: [] }))
    );

    const { message } = await callTool("get_orderbook", 67, {
      tokenId: TOKEN_ID,
    });
    const result = message.result as ToolCallResult;
    const structured = structuredOf(result);

    expect(result.content?.[0]?.text).toContain("The order book is empty.");
    expect(structured.orderbook).toMatchObject({
      bids: [],
      asks: [],
      bidDepth: "0",
      askDepth: "0",
    });
    expect(structured.orderbook).not.toHaveProperty("bestBid");
    expect(structured.orderbook).not.toHaveProperty("bestAsk");
    expect(structured.orderbook).not.toHaveProperty("spread");
    expect(structured.orderbook).not.toHaveProperty("midpoint");
  });

  it("rejects a malformed upstream level instead of returning a partial book", async () => {
    expectGammaFetch("clob-book", clobUrl("/book"), () =>
      jsonResponse(
        rawBook({
          bids: [
            { price: "abc", size: "5" },
            { price: "0.30", size: "12" },
          ],
          asks: [],
        })
      )
    );

    const { message } = await callTool("get_orderbook", 68, {
      tokenId: TOKEN_ID,
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("UPSTREAM_UNAVAILABLE");
  });

  it("maps a missing book to NOT_FOUND", async () => {
    expectGammaFetch("clob-book", clobUrl("/book"), () =>
      jsonResponse(
        { error: "No orderbook exists for the requested token id" },
        404
      )
    );

    const { message } = await callTool("get_orderbook", 69, {
      tokenId: "123",
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("NOT_FOUND");
    expect(text).toContain("Do not retry with the same input.");
  });

  it("maps CLOB 429 responses to RATE_LIMITED", async () => {
    expectGammaFetch("clob-book", clobUrl("/book"), () =>
      jsonResponse({}, 429)
    );

    const { message } = await callTool("get_orderbook", 70, {
      tokenId: TOKEN_ID,
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("RATE_LIMITED");
    expect(text).toContain("Safe to retry.");
  });

  it("maps CLOB server failures to UPSTREAM_UNAVAILABLE", async () => {
    expectGammaFetch("clob-book", clobUrl("/book"), () =>
      jsonResponse({ error: "boom" }, 500)
    );

    const { message } = await callTool("get_orderbook", 71, {
      tokenId: TOKEN_ID,
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("UPSTREAM_UNAVAILABLE");
    expect(text).toContain("Safe to retry.");
  });

  it("maps aborted upstream fetches to UPSTREAM_TIMEOUT", async () => {
    expectGammaFetch("clob-book", clobUrl("/book"), () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    const { message } = await callTool("get_orderbook", 72, {
      tokenId: TOKEN_ID,
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("UPSTREAM_TIMEOUT");
    expect(text).toContain("Safe to retry.");
  });
});
