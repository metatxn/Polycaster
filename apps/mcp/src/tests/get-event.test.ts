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

const CONDITION_ID = `0x${"cd".repeat(32)}`;
const TOKEN_ID = "53135072462907880191400140706440867753044989936304433583131";

/**
 * Modeled on live Gamma event payloads: /events/{id} and /events/slug/{slug}
 * return a single object with markets embedded, tags as objects, and money
 * fields as floats.
 */
const MARKET_ONE = {
  id: "1163699",
  question: "Clarity Act signed into law in 2026?",
  slug: "clarity-act-signed-into-law-in-2026",
  conditionId: CONDITION_ID,
  groupItemTitle: "2026",
  active: true,
  closed: false,
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0.145", "0.855"]',
  clobTokenIds: `["${TOKEN_ID}", "222"]`,
};

const MARKET_TWO = {
  id: "1163700",
  question: "Clarity Act signed into law in 2027?",
  slug: "clarity-act-signed-into-law-in-2027",
  closed: false,
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0.4", "0.6"]',
};

const MARKET_ONE_SUMMARY = {
  id: "1163699",
  question: "Clarity Act signed into law in 2026?",
  slug: "clarity-act-signed-into-law-in-2026",
  conditionId: CONDITION_ID,
  groupItemTitle: "2026",
  status: "active",
  totalOutcomes: 2,
  outcomes: [
    { name: "Yes", price: "0.145", tokenId: TOKEN_ID },
    { name: "No", price: "0.855", tokenId: "222" },
  ],
};

const MARKET_TWO_SUMMARY = {
  id: "1163700",
  question: "Clarity Act signed into law in 2027?",
  slug: "clarity-act-signed-into-law-in-2027",
  status: "active",
  totalOutcomes: 2,
  outcomes: [
    { name: "Yes", price: "0.4" },
    { name: "No", price: "0.6" },
  ],
};

const PARENT_EVENT = {
  id: "35908",
  title: "Clarity Act",
  slug: "clarity-act",
  description: "Will the Clarity Act pass? Resolution details inside.",
  active: true,
  closed: false,
  startDate: "2026-01-06T17:00:00Z",
  endDate: "2026-12-31T12:00:00Z",
  volume: 250000.5,
  volume24hr: 1234.56,
  liquidity: 78910.11,
  tags: [
    { id: "2", label: "Politics", slug: "politics" },
    { id: "100265", label: "Congress", slug: "congress" },
  ],
  markets: [MARKET_ONE, MARKET_TWO],
};

/** Matches the negRisk child-event fan-out for a given parent. */
function childEventsUrl(parentId: string) {
  return gammaUrl("/events", `parent_event_id=${parentId}`);
}

describe("get_event tool (dev bypass)", () => {
  setupGammaFetchStub();

  it("lists get_event with read-only annotations and paging inputs", async () => {
    const response = await dispatch(
      mcpRequest(
        { jsonrpc: "2.0", id: 40, method: "tools/list" },
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
    const getEvent = tools.find((tool) => tool.name === "get_event");
    expect(getEvent).toBeDefined();
    expect(getEvent?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(getEvent?.inputSchema?.properties).toHaveProperty("id");
    expect(getEvent?.inputSchema?.properties).toHaveProperty("slug");
    expect(getEvent?.inputSchema?.properties).toHaveProperty("marketOffset");
    expect(getEvent?.inputSchema?.properties).toHaveProperty("marketLimit");
    expect(getEvent?.description).toContain("not instructions");
  });

  it("rejects a call with no identifier without calling upstream", async () => {
    const { message } = await callTool("get_event", 41, {});

    expect(message.error).toBeUndefined();
    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("VALIDATION_ERROR");
    expect(result.content?.[0]?.text).toContain("exactly one");
  });

  it("rejects a call with both identifiers without calling upstream", async () => {
    const { message } = await callTool("get_event", 42, {
      id: "35908",
      slug: "clarity-act",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("VALIDATION_ERROR");
    expect(result.content?.[0]?.text).toContain("exactly one");
  });

  it("rejects a non-numeric id before any upstream call", async () => {
    const { message } = await callTool("get_event", 43, { id: "35908a" });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("VALIDATION_ERROR");
    expect(result.content?.[0]?.text).toContain("id");
  });

  it("rejects a malformed slug before any upstream call", async () => {
    const { message } = await callTool("get_event", 44, {
      slug: "not a slug!",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("VALIDATION_ERROR");
    expect(result.content?.[0]?.text).toContain("slug");
  });

  it("returns event metadata and market summaries for an id lookup", async () => {
    expectGammaFetch("event by id", gammaUrl("/events/35908"), () =>
      Response.json(PARENT_EVENT)
    );
    const { response, message } = await callTool("get_event", 45, {
      id: "35908",
    });

    expect(response.status).toBe(200);
    expect(message.error).toBeUndefined();

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain("Clarity Act");
    expect(result.content?.[0]?.text).toContain("active");
    expect(result.content?.[0]?.text).toContain("Markets 1-2 of 2");
    // The untrusted description stays in structured data, out of the summary.
    expect(result.content?.[0]?.text).not.toContain("Resolution details");

    expect(result.structuredContent?.event).toEqual({
      id: "35908",
      title: "Clarity Act",
      slug: "clarity-act",
      status: "active",
      url: "https://knoww.app/events/detail/clarity-act",
      description: "Will the Clarity Act pass? Resolution details inside.",
      startDate: "2026-01-06T17:00:00Z",
      endDate: "2026-12-31T12:00:00Z",
      volume: "250000.5",
      volume24hr: "1234.56",
      liquidity: "78910.11",
      tags: ["Politics", "Congress"],
    });
    expect(result.structuredContent?.markets).toEqual([
      MARKET_ONE_SUMMARY,
      MARKET_TWO_SUMMARY,
    ]);
    expect(result.structuredContent?.totalMarkets).toBe(2);

    const meta = result.structuredContent?.meta as Record<string, unknown>;
    expect(meta.requestId).toBe(response.headers.get("x-request-id"));
    expect(Number.isNaN(Date.parse(String(meta.asOf)))).toBe(false);
    expect(meta.sources).toEqual([
      { name: "polymarket-gamma", url: GAMMA_ORIGIN },
    ]);
    expect(meta.truncated).toBeUndefined();
  });

  it("declares capped event fields and market outcomes as truncated", async () => {
    const outcomes = Array.from(
      { length: 21 },
      (_, index) => `Outcome ${index}`
    );
    const prices = outcomes.map(() => "0.01");
    const cappedEvent = {
      ...PARENT_EVENT,
      description: "x".repeat(2001),
      tags: Array.from({ length: 11 }, (_, index) => ({
        id: String(index),
        label: `Tag ${index}`,
        slug: `tag-${index}`,
      })),
      markets: [
        {
          ...MARKET_ONE,
          outcomes: JSON.stringify(outcomes),
          outcomePrices: JSON.stringify(prices),
        },
      ],
    };
    expectGammaFetch(
      "event with capped fields",
      gammaUrl("/events/35908"),
      () => Response.json(cappedEvent)
    );

    const { message } = await callTool("get_event", 59, { id: "35908" });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.event).toMatchObject({
      descriptionTruncated: true,
      tagsTruncated: true,
    });
    expect(result.structuredContent?.markets).toEqual([
      expect.objectContaining({
        totalOutcomes: 21,
        outcomesTruncated: true,
        outcomes: expect.any(Array),
      }),
    ]);
    const markets = result.structuredContent?.markets as
      | Array<{ outcomes: unknown[] }>
      | undefined;
    expect(markets?.[0]?.outcomes).toHaveLength(20);
    expect(result.structuredContent?.meta).toMatchObject({ truncated: true });
  });

  it("looks up by slug through /events/slug/{slug}", async () => {
    expectGammaFetch(
      "event by slug",
      gammaUrl("/events/slug/clarity-act"),
      () => Response.json(PARENT_EVENT)
    );
    const { message } = await callTool("get_event", 46, {
      slug: "clarity-act",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    const event = result.structuredContent?.event as
      | Record<string, unknown>
      | undefined;
    expect(event?.id).toBe("35908");
    expect(event?.url).toBe("https://knoww.app/events/detail/clarity-act");
  });

  it("merges negRisk child markets with a groupTitle and dedupes repeats", async () => {
    const negRiskParent = {
      ...PARENT_EVENT,
      negRisk: true,
      markets: [MARKET_ONE],
    };
    const childEvent = {
      id: "41001",
      title: "Clarity Act in 2027",
      slug: "clarity-act-2027",
      markets: [MARKET_TWO, MARKET_ONE],
    };
    expectGammaFetch("event by id", gammaUrl("/events/35908"), () =>
      Response.json(negRiskParent)
    );
    expectGammaFetch("child events", childEventsUrl("35908"), () =>
      Response.json([childEvent])
    );

    const { message } = await callTool("get_event", 47, { id: "35908" });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    const event = result.structuredContent?.event as Record<string, unknown>;
    expect(event.negRisk).toBe(true);
    expect(result.structuredContent?.markets).toEqual([
      MARKET_ONE_SUMMARY,
      { ...MARKET_TWO_SUMMARY, groupTitle: "Clarity Act in 2027" },
    ]);
    expect(result.structuredContent?.totalMarkets).toBe(2);
  });

  it("degrades instead of failing when the child-event fan-out breaks", async () => {
    expectGammaFetch("event by id", gammaUrl("/events/35908"), () =>
      Response.json({ ...PARENT_EVENT, negRisk: true })
    );
    expectGammaFetch(
      "child events 500",
      childEventsUrl("35908"),
      () => new Response("boom", { status: 500 })
    );

    const { message } = await callTool("get_event", 48, { id: "35908" });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain("may be incomplete");
    expect(result.structuredContent?.markets).toEqual([
      MARKET_ONE_SUMMARY,
      MARKET_TWO_SUMMARY,
    ]);
  });

  it("marks the market list incomplete when child events exceed the service cap", async () => {
    expectGammaFetch("event by id", gammaUrl("/events/35908"), () =>
      Response.json({ ...PARENT_EVENT, negRisk: true })
    );
    const children = Array.from({ length: 51 }, (_, index) => ({
      id: String(41_000 + index),
      title: `Child ${index}`,
      markets: [],
    }));
    expectGammaFetch("capped child events", childEventsUrl("35908"), () =>
      Response.json(children)
    );

    const { message } = await callTool("get_event", 58, { id: "35908" });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.marketsIncomplete).toBe(true);
    expect(result.content?.[0]?.text).toContain("child-event list was capped");
    const meta = result.structuredContent?.meta as
      | Record<string, unknown>
      | undefined;
    expect(meta?.truncated).toBe(true);
  });

  it("truncates to marketLimit and points at the next offset", async () => {
    expectGammaFetch("event by id", gammaUrl("/events/35908"), () =>
      Response.json(PARENT_EVENT)
    );
    const { message } = await callTool("get_event", 49, {
      id: "35908",
      marketLimit: 1,
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.markets).toEqual([MARKET_ONE_SUMMARY]);
    expect(result.structuredContent?.totalMarkets).toBe(2);
    expect(result.content?.[0]?.text).toContain("Markets 1-1 of 2");
    expect(result.content?.[0]?.text).toContain("marketOffset=1");

    const meta = result.structuredContent?.meta as Record<string, unknown>;
    expect(meta.truncated).toBe(true);
    expect(meta.nextCursor).toEqual(expect.any(String));
    expect(result.structuredContent?.page).toEqual({
      returnedResults: 1,
      totalResults: 2,
      hasMore: true,
    });
  });

  it("continues event markets with the opaque cursor", async () => {
    expectGammaFetch("first event page", gammaUrl("/events/35908"), () =>
      Response.json(PARENT_EVENT)
    );
    const first = await callTool("get_event", 69, {
      id: "35908",
      marketLimit: 1,
    });
    const firstResult = first.message.result as ToolCallResult;
    const cursor = (
      firstResult.structuredContent?.meta as { nextCursor?: string }
    )?.nextCursor;

    expectGammaFetch("second event page", gammaUrl("/events/35908"), () =>
      Response.json(PARENT_EVENT)
    );
    const second = await callTool("get_event", 70, {
      id: "35908",
      marketLimit: 1,
      cursor,
    });
    const secondResult = second.message.result as ToolCallResult;

    expect(secondResult.structuredContent?.markets).toEqual([
      MARKET_TWO_SUMMARY,
    ]);
    expect(secondResult.structuredContent?.page).toEqual({
      returnedResults: 1,
      totalResults: 2,
      hasMore: false,
    });
    expect(secondResult.structuredContent?.meta).not.toHaveProperty(
      "nextCursor"
    );
  });

  it("serves a later page through marketOffset without truncation", async () => {
    expectGammaFetch("event by id", gammaUrl("/events/35908"), () =>
      Response.json(PARENT_EVENT)
    );
    const { message } = await callTool("get_event", 50, {
      id: "35908",
      marketOffset: 1,
      marketLimit: 1,
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.markets).toEqual([MARKET_TWO_SUMMARY]);
    expect(result.content?.[0]?.text).toContain("Markets 2-2 of 2");

    const meta = result.structuredContent?.meta as Record<string, unknown>;
    expect(meta.truncated).toBeUndefined();
  });

  it("explains an out-of-range marketOffset instead of erroring", async () => {
    expectGammaFetch("event by id", gammaUrl("/events/35908"), () =>
      Response.json(PARENT_EVENT)
    );
    const { message } = await callTool("get_event", 51, {
      id: "35908",
      marketOffset: 10,
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.markets).toEqual([]);
    expect(result.structuredContent?.totalMarkets).toBe(2);
    expect(result.content?.[0]?.text).toContain("marketOffset");
  });

  it("falls back to /markets when the event payload has no markets array", async () => {
    const { markets: _markets, ...eventWithoutMarkets } = PARENT_EVENT;
    expectGammaFetch(
      "event by slug",
      gammaUrl("/events/slug/clarity-act"),
      () => Response.json(eventWithoutMarkets)
    );
    expectGammaFetch(
      "markets fallback",
      gammaUrl("/markets", "events_slug=clarity-act"),
      () => Response.json([MARKET_TWO])
    );

    const { message } = await callTool("get_event", 52, {
      slug: "clarity-act",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.markets).toEqual([MARKET_TWO_SUMMARY]);
    expect(result.structuredContent?.totalMarkets).toBe(1);
  });

  it("keeps an empty embedded markets array as no markets, without a fallback fetch", async () => {
    expectGammaFetch("event by id", gammaUrl("/events/35908"), () =>
      Response.json({ ...PARENT_EVENT, markets: [] })
    );
    const { message } = await callTool("get_event", 53, { id: "35908" });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.markets).toEqual([]);
    expect(result.structuredContent?.totalMarkets).toBe(0);
    expect(result.content?.[0]?.text).toContain("no open markets");
  });

  it("maps a slug 422 to NOT_FOUND", async () => {
    expectGammaFetch(
      "event by slug 422",
      gammaUrl("/events/slug/no-such-event"),
      () => new Response("unprocessable", { status: 422 })
    );

    const { message } = await callTool("get_event", 54, {
      slug: "no-such-event",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("NOT_FOUND");
    expect(result.content?.[0]?.text).toContain(
      "Do not retry with the same input."
    );
  });

  it("maps an id 404 to NOT_FOUND", async () => {
    expectGammaFetch(
      "event by id 404",
      gammaUrl("/events/999999999"),
      () => new Response("missing", { status: 404 })
    );

    const { message } = await callTool("get_event", 55, { id: "999999999" });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("NOT_FOUND");
  });

  it("maps an upstream 429 to a retryable RATE_LIMITED error", async () => {
    expectGammaFetch(
      "event 429",
      gammaUrl("/events/35908"),
      () => new Response("rate limited", { status: 429 })
    );

    const { message } = await callTool("get_event", 56, { id: "35908" });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("RATE_LIMITED");
    expect(result.content?.[0]?.text).toContain("Safe to retry.");
  });

  it("maps an upstream 500 to a retryable UPSTREAM_UNAVAILABLE error", async () => {
    expectGammaFetch(
      "event 500",
      gammaUrl("/events/slug/clarity-act"),
      () => new Response("boom", { status: 500 })
    );

    const { message } = await callTool("get_event", 57, {
      slug: "clarity-act",
    });

    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("UPSTREAM_UNAVAILABLE");
    expect(result.content?.[0]?.text).toContain("Safe to retry.");
  });
});
