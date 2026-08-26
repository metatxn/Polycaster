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
 * get_price_history tests. The CLOB /prices-history contract these encode
 * (probed 2026-08-25): the query key is `market` but carries the TOKEN id,
 * `t` is a seconds epoch number, `p` a float, points arrive ascending, and
 * an unknown token answers HTTP 200 with an empty history, so an empty
 * window is a success, never NOT_FOUND. The tool validates the time range
 * itself, converts points to ISO timestamps and decimal-string prices, and
 * downsamples past 1000 points instead of returning unbounded arrays.
 */

const TOKEN_ID =
  "27146956652877944551877724690365745048289675287536243265951843487691050802191";

const START_ISO = "2026-08-20T00:00:00.000Z";
const END_ISO = "2026-08-21T00:00:00.000Z";
const START_TS = Math.floor(Date.parse(START_ISO) / 1000);
const END_TS = Math.floor(Date.parse(END_ISO) / 1000);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface HistoryStructured {
  history: {
    tokenId: string;
    startTime: string;
    endTime: string;
    fidelityMinutes: number;
    points: Array<{ timestamp: string; price: string }>;
    downsampled?: boolean;
  };
  meta: {
    requestId: string;
    asOf: string;
    sources: Array<{ name: string; url?: string }>;
    truncated?: boolean;
  };
}

function structuredOf(result: ToolCallResult): HistoryStructured {
  return result.structuredContent as unknown as HistoryStructured;
}

describe("get_price_history tool", () => {
  setupGammaFetchStub();

  it("appears in tools/list with read-only annotations and bounded inputs", async () => {
    const response = await dispatch(
      mcpRequest(
        { jsonrpc: "2.0", id: 80, method: "tools/list" },
        { headers: { "mcp-protocol-version": PROTOCOL_VERSION } }
      ),
      devEnv
    );
    const message = await readJsonRpc(response);
    const tools = message.result?.tools as Array<Record<string, unknown>>;
    const tool = tools.find((entry) => entry.name === "get_price_history");

    expect(tool).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    const inputSchema = tool?.inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(inputSchema.properties).toHaveProperty("tokenId");
    expect(inputSchema.properties).toHaveProperty("startTime");
    expect(inputSchema.properties).toHaveProperty("endTime");
    expect(inputSchema.properties).toHaveProperty("fidelityMinutes");
    expect(String(tool?.description)).toContain("price history");
    expect(String(tool?.description)).toContain("trade");
  });

  it("rejects a missing tokenId before calling upstream", async () => {
    const { message } = await callTool("get_price_history", 81, {});
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).toContain("tokenId");
    expect(text).toContain("Do not retry with the same input.");
  });

  it("rejects a malformed tokenId before calling upstream", async () => {
    const { message } = await callTool("get_price_history", 82, {
      tokenId: "12,34",
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain(
      "tokenId must be a string of up to 80 decimal digits."
    );
  });

  it("converts ISO inputs to epoch seconds and points to ISO plus decimal strings", async () => {
    expectGammaFetch(
      "clob-history",
      clobUrl(
        "/prices-history",
        `market=${TOKEN_ID}&startTs=${START_TS}&endTs=${END_TS}&fidelity=120`
      ),
      () =>
        jsonResponse({
          history: [
            { t: START_TS + 425, p: 0.006 },
            { t: START_TS + 4025, p: 0.007 },
            { t: START_TS + 7625, p: 0.0065 },
          ],
        })
    );

    const { response, message } = await callTool("get_price_history", 83, {
      tokenId: TOKEN_ID,
      startTime: START_ISO,
      endTime: END_ISO,
      fidelityMinutes: 120,
    });
    const result = message.result as ToolCallResult;

    expect(response.status).toBe(200);
    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain("3 price points");
    expect(result.content?.[0]?.text).toContain("0.0065");

    const structured = structuredOf(result);
    expect(structured.history).toEqual({
      tokenId: TOKEN_ID,
      startTime: START_ISO,
      endTime: END_ISO,
      fidelityMinutes: 120,
      points: [
        {
          timestamp: new Date((START_TS + 425) * 1000).toISOString(),
          price: "0.006",
        },
        {
          timestamp: new Date((START_TS + 4025) * 1000).toISOString(),
          price: "0.007",
        },
        {
          timestamp: new Date((START_TS + 7625) * 1000).toISOString(),
          price: "0.0065",
        },
      ],
    });
    expect(structured.meta.requestId).toBe(
      response.headers.get("x-request-id")
    );
    expect(structured.meta.asOf).toBe(
      new Date((START_TS + 7625) * 1000).toISOString()
    );
    expect(structured.meta.sources).toEqual([
      { name: "polymarket-clob", url: CLOB_ORIGIN },
    ]);
    expect(structured.meta.truncated).toBeUndefined();
  });

  it("defaults to a 24 hour window ending now", async () => {
    expectGammaFetch(
      "clob-history",
      clobUrl("/prices-history", `market=${TOKEN_ID}`),
      () => jsonResponse({ history: [] })
    );

    const { message } = await callTool("get_price_history", 84, {
      tokenId: TOKEN_ID,
    });
    const result = message.result as ToolCallResult;
    const structured = structuredOf(result);

    expect(result.isError).toBeFalsy();
    const spanSeconds =
      (Date.parse(structured.history.endTime) -
        Date.parse(structured.history.startTime)) /
      1000;
    expect(spanSeconds).toBe(24 * 60 * 60);
    expect(Date.parse(structured.history.endTime)).toBeGreaterThan(
      Date.now() - 10_000
    );
    expect(structured.history.fidelityMinutes).toBe(60);
  });

  it("rejects an unparseable startTime before calling upstream", async () => {
    const { message } = await callTool("get_price_history", 85, {
      tokenId: TOKEN_ID,
      startTime: "yesterday",
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).toContain("startTime");
  });

  it("rejects a startTime at or after endTime before calling upstream", async () => {
    const { message } = await callTool("get_price_history", 86, {
      tokenId: TOKEN_ID,
      startTime: END_ISO,
      endTime: START_ISO,
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).toContain("before");
  });

  it("rejects a window longer than 31 days before calling upstream", async () => {
    const { message } = await callTool("get_price_history", 87, {
      tokenId: TOKEN_ID,
      startTime: "2026-06-01T00:00:00.000Z",
      endTime: "2026-08-01T00:00:00.000Z",
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).toContain("31 days");
  });

  it("downsamples past 1000 points, keeps the endpoints, and flags truncation", async () => {
    const dense = Array.from({ length: 1500 }, (_, index) => ({
      t: START_TS + index * 30,
      p: 0.4 + (index % 10) / 1000,
    }));
    expectGammaFetch(
      "clob-history",
      clobUrl("/prices-history", `market=${TOKEN_ID}`),
      () => jsonResponse({ history: dense })
    );

    const { message } = await callTool("get_price_history", 88, {
      tokenId: TOKEN_ID,
      startTime: START_ISO,
      endTime: END_ISO,
      fidelityMinutes: 1,
    });
    const result = message.result as ToolCallResult;
    const structured = structuredOf(result);

    expect(result.isError).toBeFalsy();
    expect(structured.history.points).toHaveLength(1000);
    expect(structured.history.points[0].timestamp).toBe(
      new Date(START_TS * 1000).toISOString()
    );
    expect(structured.history.points.at(-1)?.timestamp).toBe(
      new Date((START_TS + 1499 * 30) * 1000).toISOString()
    );
    expect(structured.history.downsampled).toBe(true);
    expect(structured.meta.truncated).toBe(true);
    expect(result.content?.[0]?.text).toContain("downsampled");
  });

  it("treats an empty history as success, not NOT_FOUND", async () => {
    expectGammaFetch(
      "clob-history",
      clobUrl("/prices-history", `market=${TOKEN_ID}`),
      () => jsonResponse({ history: [] })
    );

    const { message } = await callTool("get_price_history", 89, {
      tokenId: TOKEN_ID,
      startTime: START_ISO,
      endTime: END_ISO,
    });
    const result = message.result as ToolCallResult;
    const structured = structuredOf(result);

    expect(result.isError).toBeFalsy();
    expect(structured.history.points).toEqual([]);
    expect(result.content?.[0]?.text).toContain(
      "No price history in the requested window."
    );
    expect(structured.history).not.toHaveProperty("downsampled");
  });

  it("maps CLOB 429 responses to RATE_LIMITED", async () => {
    expectGammaFetch(
      "clob-history",
      clobUrl("/prices-history", `market=${TOKEN_ID}`),
      () => jsonResponse({}, 429)
    );

    const { message } = await callTool("get_price_history", 90, {
      tokenId: TOKEN_ID,
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("RATE_LIMITED");
    expect(text).toContain("Safe to retry.");
  });

  it("maps CLOB server failures to UPSTREAM_UNAVAILABLE", async () => {
    expectGammaFetch(
      "clob-history",
      clobUrl("/prices-history", `market=${TOKEN_ID}`),
      () => jsonResponse({ error: "boom" }, 500)
    );

    const { message } = await callTool("get_price_history", 91, {
      tokenId: TOKEN_ID,
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("UPSTREAM_UNAVAILABLE");
    expect(text).toContain("Safe to retry.");
  });

  it("maps aborted upstream fetches to UPSTREAM_TIMEOUT", async () => {
    expectGammaFetch(
      "clob-history",
      clobUrl("/prices-history", `market=${TOKEN_ID}`),
      () => {
        throw new DOMException("The operation was aborted", "AbortError");
      }
    );

    const { message } = await callTool("get_price_history", 92, {
      tokenId: TOKEN_ID,
    });
    const result = message.result as ToolCallResult;

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("UPSTREAM_TIMEOUT");
    expect(text).toContain("Safe to retry.");
  });
});
