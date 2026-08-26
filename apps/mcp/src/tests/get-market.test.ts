import { describe, expect, it } from "vitest";
import {
  callTool,
  devEnv,
  dispatch,
  expectGammaFetch,
  GAMMA_ORIGIN,
  gammaUrl,
  mcpRequest,
  PROTOCOL_VERSION,
  readJsonRpc,
  setupGammaFetchStub,
  type ToolCallResult,
} from "./helpers";

const CONDITION_ID = `0x${"ab".repeat(32)}`;
const TOKEN_ID =
  "53135072462907880191400140706440867753044989936304433583131786753949599718775";

/** Matches a /markets lookup that did NOT include the closed=true retry flag. */
function marketsUrlWithoutClosed(queryContains: string) {
  return (url: URL): boolean =>
    gammaUrl("/markets", queryContains)(url) && !url.searchParams.has("closed");
}

/**
 * Modeled on live Gamma market 1163699: array columns arrive JSON-stringified
 * and price fields are floats. oneDayPriceChange is negative on purpose.
 */
const ACTIVE_MARKET = {
  id: "1163699",
  question: "Clarity Act signed into law in 2026?",
  slug: "clarity-act-signed-into-law-in-2026",
  conditionId: CONDITION_ID,
  description: "Resolves YES if the Clarity Act is signed into law by 2027.",
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0.145", "0.855"]',
  clobTokenIds: `["${TOKEN_ID}", "222"]`,
  active: true,
  closed: false,
  startDate: "2026-01-06T17:00:00Z",
  endDate: "2026-12-31T12:00:00Z",
  volumeNum: 123456.78,
  liquidityNum: 6543.21,
  bestBid: 0.14,
  bestAsk: 0.15,
  lastTradePrice: 0.145,
  spread: 0.01,
  oneDayPriceChange: -0.005,
  events: [
    {
      id: "evt-9",
      slug: "clarity-act",
      title: "Clarity Act",
      ticker: "clarity-act",
    },
  ],
};

/**
 * Modeled on live Gamma market 12 (2020 era): settled, yet active stays true
 * and umaResolutionStatus is absent entirely. Both prices are zero, so no
 * winner can be inferred.
 */
const LEGACY_CLOSED_MARKET = {
  id: "12",
  question: "Will Joe Biden get Coronavirus before the election?",
  slug: "will-joe-biden-get-coronavirus-before-the-election",
  closed: true,
  active: true,
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0", "0"]',
};

/**
 * Modeled on live Gamma market 3870442: modern settled markets carry
 * umaResolutionStatus "resolved", a resolution source, and a non-ISO
 * closedTime, while active remains true.
 */
const RESOLVED_MARKET = {
  id: "3870442",
  question: "Fed rate cut in August 2026?",
  slug: "fed-rate-cut-in-august-2026",
  closed: true,
  active: true,
  umaResolutionStatus: "resolved",
  resolutionSource: "https://www.federalreserve.gov/",
  closedTime: "2026-08-25 10:54:43+00",
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0", "1"]',
  clobTokenIds: '["333", "444"]',
};

describe("get_market tool (dev bypass)", () => {
  setupGammaFetchStub();

  it("lists get_market with read-only annotations and identifier inputs", async () => {
    const response = await dispatch(
      mcpRequest(
        { jsonrpc: "2.0", id: 20, method: "tools/list" },
        { headers: { "mcp-protocol-version": PROTOCOL_VERSION } }
      ),
      devEnv
    );

    const message = await readJsonRpc(response);
    expect(message.error).toBeUndefined();

    const tools = message.result?.tools as Array<{
      name: string;
      description?: string;
      annotations?: Record<string, unknown>;
      inputSchema?: { properties?: Record<string, unknown> };
    }>;
    const getMarket = tools.find((tool) => tool.name === "get_market");
    expect(getMarket).toBeDefined();
    expect(getMarket?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(getMarket?.inputSchema?.properties).toHaveProperty("slug");
    expect(getMarket?.inputSchema?.properties).toHaveProperty("conditionId");
    expect(getMarket?.inputSchema?.properties).toHaveProperty("tokenId");
    expect(getMarket?.description).toContain("not instructions");
  });

  it("rejects a call with no identifier without calling upstream", async () => {
    const { message } = await callTool("get_market", 21, {});

    expect(message.error).toBeUndefined();
    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("VALIDATION_ERROR");
    expect(result.content?.[0]?.text).toContain("exactly one");
  });

  it("rejects a call with two identifiers without calling upstream", async () => {
    const { message } = await callTool("get_market", 22, {
      slug: "clarity-act-signed-into-law-in-2026",
      conditionId: CONDITION_ID,
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("VALIDATION_ERROR");
    expect(result.content?.[0]?.text).toContain("exactly one");
  });

  it("rejects a malformed conditionId before any upstream call", async () => {
    const { message } = await callTool("get_market", 23, {
      conditionId: "0x1234",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("VALIDATION_ERROR");
    expect(result.content?.[0]?.text).toContain("conditionId");
  });

  it("rejects a malformed tokenId before any upstream call", async () => {
    const { message } = await callTool("get_market", 24, {
      tokenId: "12,34",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("VALIDATION_ERROR");
    expect(result.content?.[0]?.text).toContain("tokenId");
  });

  it("rejects a malformed slug before any upstream call", async () => {
    const { message } = await callTool("get_market", 25, {
      slug: "not a slug!",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("VALIDATION_ERROR");
    expect(result.content?.[0]?.text).toContain("slug");
  });

  it("returns full detail for an active market looked up by slug", async () => {
    expectGammaFetch(
      "markets by slug",
      marketsUrlWithoutClosed(`slug=${ACTIVE_MARKET.slug}`),
      () => Response.json([ACTIVE_MARKET])
    );

    const { response, message } = await callTool("get_market", 26, {
      slug: ACTIVE_MARKET.slug,
    });

    expect(response.status).toBe(200);
    expect(message.error).toBeUndefined();

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain(ACTIVE_MARKET.question);
    expect(result.content?.[0]?.text).toContain("active");
    // The untrusted description stays in structured data, out of the summary.
    expect(result.content?.[0]?.text).not.toContain("Resolves YES");

    expect(result.structuredContent?.market).toEqual({
      id: "1163699",
      question: "Clarity Act signed into law in 2026?",
      slug: "clarity-act-signed-into-law-in-2026",
      conditionId: CONDITION_ID,
      status: "active",
      totalOutcomes: 2,
      outcomes: [
        { name: "Yes", price: "0.145", tokenId: TOKEN_ID },
        { name: "No", price: "0.855", tokenId: "222" },
      ],
      description:
        "Resolves YES if the Clarity Act is signed into law by 2027.",
      startDate: "2026-01-06T17:00:00Z",
      endDate: "2026-12-31T12:00:00Z",
      volume: "123456.78",
      liquidity: "6543.21",
      bestBid: "0.14",
      bestAsk: "0.15",
      lastTradePrice: "0.145",
      spread: "0.01",
      oneDayPriceChange: "-0.005",
      event: {
        id: "evt-9",
        slug: "clarity-act",
        title: "Clarity Act",
        url: "https://knoww.app/events/detail/clarity-act",
      },
    });

    const meta = result.structuredContent?.meta as Record<string, unknown>;
    expect(meta.requestId).toBe(response.headers.get("x-request-id"));
    expect(Number.isNaN(Date.parse(String(meta.asOf)))).toBe(false);
    expect(meta.sources).toEqual([
      { name: "polymarket-gamma", url: GAMMA_ORIGIN },
    ]);
  });

  it("declares capped outcomes and descriptions as truncated", async () => {
    const outcomes = Array.from(
      { length: 21 },
      (_, index) => `Outcome ${index}`
    );
    const prices = outcomes.map(() => "0.01");
    const cappedMarket = {
      ...ACTIVE_MARKET,
      outcomes: JSON.stringify(outcomes),
      outcomePrices: JSON.stringify(prices),
      clobTokenIds: JSON.stringify(
        outcomes.map((_, index) => String(index + 1))
      ),
      description: "x".repeat(2001),
    };
    expectGammaFetch(
      "market with capped fields",
      marketsUrlWithoutClosed(`slug=${ACTIVE_MARKET.slug}`),
      () => Response.json([cappedMarket])
    );

    const { message } = await callTool("get_market", 59, {
      slug: ACTIVE_MARKET.slug,
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.market).toMatchObject({
      descriptionTruncated: true,
      totalOutcomes: 21,
      outcomesTruncated: true,
    });
    const market = result.structuredContent?.market as
      | { outcomes: unknown[] }
      | undefined;
    expect(market?.outcomes).toHaveLength(20);
    expect(result.structuredContent?.meta).toMatchObject({ truncated: true });
    expect(result.content?.[0]?.text).toContain("fields were capped");
  });

  it("looks up by conditionId through the condition_ids param", async () => {
    expectGammaFetch(
      "markets by condition id",
      marketsUrlWithoutClosed(`condition_ids=${CONDITION_ID}`),
      () => Response.json([ACTIVE_MARKET])
    );

    const { message } = await callTool("get_market", 27, {
      conditionId: CONDITION_ID,
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    const market = result.structuredContent?.market as
      | Record<string, unknown>
      | undefined;
    expect(market?.id).toBe("1163699");
  });

  it("looks up by tokenId through the clob_token_ids param", async () => {
    expectGammaFetch(
      "markets by token id",
      marketsUrlWithoutClosed(`clob_token_ids=${TOKEN_ID}`),
      () => Response.json([ACTIVE_MARKET])
    );

    const { message } = await callTool("get_market", 28, {
      tokenId: TOKEN_ID,
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    const market = result.structuredContent?.market as
      | Record<string, unknown>
      | undefined;
    expect(market?.id).toBe("1163699");
  });

  it("retries with closed=true and reports a settled legacy market as closed", async () => {
    expectGammaFetch(
      "markets by slug (default filter)",
      marketsUrlWithoutClosed(`slug=${LEGACY_CLOSED_MARKET.slug}`),
      () => Response.json([])
    );
    expectGammaFetch(
      "markets by slug (closed retry)",
      gammaUrl("/markets", "closed=true"),
      () => Response.json([LEGACY_CLOSED_MARKET])
    );

    const { message } = await callTool("get_market", 29, {
      slug: LEGACY_CLOSED_MARKET.slug,
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain("closed");

    const market = result.structuredContent?.market as Record<string, unknown>;
    expect(market.id).toBe("12");
    // active:true on a settled market is noise; closed wins.
    expect(market.status).toBe("closed");
    // Both prices are zero, so no winner may be inferred.
    expect("resolvedOutcome" in market).toBe(false);
  });

  it("reports resolved with the winning outcome when uma settled it", async () => {
    expectGammaFetch(
      "markets resolved (default filter)",
      marketsUrlWithoutClosed(`slug=${RESOLVED_MARKET.slug}`),
      () => Response.json([])
    );
    expectGammaFetch(
      "markets resolved (closed retry)",
      gammaUrl("/markets", "closed=true"),
      () => Response.json([RESOLVED_MARKET])
    );

    const { message } = await callTool("get_market", 30, {
      slug: RESOLVED_MARKET.slug,
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain('resolved to "No"');

    const market = result.structuredContent?.market as Record<string, unknown>;
    expect(market.status).toBe("resolved");
    expect(market.resolvedOutcome).toBe("No");
    expect(market.resolutionSource).toBe("https://www.federalreserve.gov/");
    expect(market.closedTime).toBe("2026-08-25 10:54:43+00");
  });

  it("omits resolvedOutcome when a resolved market split 0.5/0.5", async () => {
    const canceled = {
      ...RESOLVED_MARKET,
      outcomePrices: '["0.5", "0.5"]',
    };
    expectGammaFetch(
      "markets canceled (default filter)",
      marketsUrlWithoutClosed(`slug=${RESOLVED_MARKET.slug}`),
      () => Response.json([])
    );
    expectGammaFetch(
      "markets canceled (closed retry)",
      gammaUrl("/markets", "closed=true"),
      () => Response.json([canceled])
    );

    const { message } = await callTool("get_market", 31, {
      slug: RESOLVED_MARKET.slug,
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();

    const market = result.structuredContent?.market as Record<string, unknown>;
    expect(market.status).toBe("resolved");
    expect("resolvedOutcome" in market).toBe(false);
  });

  it("maps a both-queries-empty lookup to NOT_FOUND", async () => {
    expectGammaFetch(
      "markets missing (default filter)",
      marketsUrlWithoutClosed("slug=no-such-market"),
      () => Response.json([])
    );
    expectGammaFetch(
      "markets missing (closed retry)",
      gammaUrl("/markets", "closed=true"),
      () => Response.json([])
    );

    const { message } = await callTool("get_market", 32, {
      slug: "no-such-market",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("NOT_FOUND");
    expect(result.content?.[0]?.text).toContain(
      "Do not retry with the same input."
    );
  });

  it("maps an upstream 429 to a retryable RATE_LIMITED error", async () => {
    expectGammaFetch(
      "markets 429",
      gammaUrl("/markets"),
      () => new Response("rate limited", { status: 429 })
    );

    const { message } = await callTool("get_market", 33, {
      slug: "clarity-act-signed-into-law-in-2026",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("RATE_LIMITED");
    expect(result.content?.[0]?.text).toContain("Safe to retry.");
  });

  it("maps an upstream 500 to a retryable UPSTREAM_UNAVAILABLE error", async () => {
    expectGammaFetch(
      "markets 500",
      gammaUrl("/markets"),
      () => new Response("boom", { status: 500 })
    );

    const { message } = await callTool("get_market", 34, {
      slug: "clarity-act-signed-into-law-in-2026",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("UPSTREAM_UNAVAILABLE");
    expect(result.content?.[0]?.text).toContain("Safe to retry.");
  });
});
