import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import worker from "../index";
import { KNOWW_MCP_TOOL_NAMES } from "../tool-catalog";

/**
 * The pool loads the top-level wrangler.jsonc vars, so `env` is the
 * production shape (oauth-required). Tests that exercise the MCP handler
 * spread these dev-bypass overrides on top.
 */
const DEV_VARS = {
  MCP_AUTH_MODE: "dev-bypass",
  MCP_CANONICAL_RESOURCE: "http://localhost:8787/mcp",
  MCP_ALLOWED_HOSTNAMES: "localhost,127.0.0.1",
  MCP_ALLOWED_ORIGIN_HOSTNAMES: "localhost,127.0.0.1",
} as const;

const devEnv = { ...env, ...DEV_VARS } as Env;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function mcpRequest(
  body: unknown,
  init?: { url?: string; headers?: Record<string, string>; method?: string }
): Request {
  const url = init?.url ?? "http://localhost/mcp";
  return new Request(url, {
    method: init?.method ?? "POST",
    headers: {
      // Real inbound requests always carry a Host header (workerd sets it from
      // the connection); the bare Request constructor does not, so set it here
      // or host validation rejects every request as missing_host.
      host: new URL(url).host,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...init?.headers,
    },
    body: init?.method === "GET" ? undefined : JSON.stringify(body),
  });
}

/**
 * Requests emulate today's MCP clients (Claude Desktop, claude.ai connectors,
 * the inspector), which all speak the classic initialize handshake. In SDK v2
 * that handshake tops out at protocol 2025-11-25. The 2026-07-28 revision is a
 * separate wire era (server/discover plus per-request _meta envelopes) that no
 * mainstream client sends yet, and the SDK rejects a classic initialize paired
 * with a 2026-07-28 mcp-protocol-version header as a version mismatch.
 */
const PROTOCOL_VERSION = "2025-11-25";
const MODERN_PROTOCOL_VERSION = "2026-07-28";

function initializeBody(id = 1): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "knoww-mcp-tests", version: "0.0.0" },
    },
  };
}

async function dispatch(request: Request, testEnv: Env): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

/** Reads a JSON-RPC response from either a JSON body or an SSE stream. */
async function readJsonRpc(response: Response): Promise<JsonRpcResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    const messages = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5)) as JsonRpcResponse);
    const last = messages.at(-1);
    if (!last) {
      throw new Error(`SSE response contained no data frames: ${text}`);
    }
    return last;
  }
  return JSON.parse(text) as JsonRpcResponse;
}

describe("MCP endpoint (dev bypass)", () => {
  it("answers initialize with the negotiated protocol and server identity", async () => {
    const response = await dispatch(mcpRequest(initializeBody()), devEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const message = await readJsonRpc(response);
    expect(message.error).toBeUndefined();
    expect(message.result?.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(message.result?.serverInfo).toMatchObject({ name: "knoww-mcp" });
  });

  it("serves the 2026 server/discover negotiation path", async () => {
    const response = await dispatch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: "discover-1",
          method: "server/discover",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion":
                MODERN_PROTOCOL_VERSION,
              "io.modelcontextprotocol/clientInfo": {
                name: "knoww-mcp-tests",
                version: "0.0.0",
              },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        },
        {
          headers: {
            "mcp-protocol-version": MODERN_PROTOCOL_VERSION,
            "mcp-method": "server/discover",
          },
        }
      ),
      devEnv
    );

    expect(response.status).toBe(200);
    const message = await readJsonRpc(response);
    expect(message.error).toBeUndefined();
    expect(message.result?.supportedVersions).toContain(
      MODERN_PROTOCOL_VERSION
    );
    expect(message.result?._meta).toMatchObject({
      "io.modelcontextprotocol/serverInfo": { name: "knoww-mcp" },
    });
  });

  it("lists the search_markets tool with read-only annotations", async () => {
    const response = await dispatch(
      mcpRequest(
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { headers: { "mcp-protocol-version": PROTOCOL_VERSION } }
      ),
      devEnv
    );

    expect(response.status).toBe(200);
    const message = await readJsonRpc(response);
    expect(message.error).toBeUndefined();

    const tools = message.result?.tools as Array<{
      name: string;
      description?: string;
      annotations?: Record<string, unknown>;
      inputSchema?: { properties?: Record<string, unknown> };
    }>;
    expect(tools.map((tool) => tool.name)).toEqual(KNOWW_MCP_TOOL_NAMES);
    expect(tools[0]?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(tools[0]?.inputSchema?.properties).toHaveProperty("query");
    expect(tools[0]?.inputSchema?.properties).toHaveProperty("limit");
  });

  it("allows requests without an Origin header (desktop MCP clients)", async () => {
    const response = await dispatch(
      mcpRequest(
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        { headers: { "mcp-protocol-version": PROTOCOL_VERSION } }
      ),
      devEnv
    );
    expect(response.status).toBe(200);
  });

  it("allows an allowlisted Origin header", async () => {
    const response = await dispatch(
      mcpRequest(
        { jsonrpc: "2.0", id: 4, method: "tools/list" },
        {
          headers: {
            "mcp-protocol-version": PROTOCOL_VERSION,
            origin: "http://localhost",
          },
        }
      ),
      devEnv
    );
    expect(response.status).toBe(200);
  });

  it("rejects a Host header outside the allowlist", async () => {
    const response = await dispatch(
      mcpRequest(initializeBody(5), { url: "http://evil.example/mcp" }),
      devEnv
    );
    expect(response.status).toBe(403);
  });

  it("rejects a malformed Host header that embeds an allowlisted hostname", async () => {
    const response = await dispatch(
      mcpRequest(initializeBody(51), {
        headers: { host: "evil.example@localhost" },
      }),
      devEnv
    );
    expect(response.status).toBe(403);
  });

  it("rejects a present Origin header outside the allowlist", async () => {
    const response = await dispatch(
      mcpRequest(initializeBody(6), {
        headers: { origin: "https://evil.example" },
      }),
      devEnv
    );
    expect(response.status).toBe(403);
  });

  it("returns 404 for paths other than /mcp", async () => {
    const response = await dispatch(
      new Request("http://localhost/other", { method: "POST" }),
      devEnv
    );
    expect(response.status).toBe(404);
  });

  it("rejects GET /mcp (stateless server has no session stream)", async () => {
    const response = await dispatch(
      mcpRequest(undefined, { method: "GET" }),
      devEnv
    );
    expect(response.status).toBe(405);
  });
});

describe("MCP endpoint (production auth mode)", () => {
  it("rejects a declared MCP body larger than 1 MiB before OAuth processing", async () => {
    const response = await dispatch(
      new Request("https://mcp.knoww.app/mcp", {
        method: "POST",
        headers: {
          host: "mcp.knoww.app",
          "content-length": String(1024 * 1024 + 1),
          "content-type": "application/json",
        },
        body: "{}",
      }),
      env
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(await response.text()).not.toContain("stack");
  });

  it("rejects a chunked MCP body larger than 1 MiB", async () => {
    const response = await dispatch(
      new Request("https://mcp.knoww.app/mcp", {
        method: "POST",
        headers: {
          host: "mcp.knoww.app",
          "content-type": "application/json",
        },
        body: "x".repeat(1024 * 1024 + 1),
      }),
      env
    );

    expect(response.status).toBe(413);
  });

  it("rejects an oversized OAuth token form before provider parsing", async () => {
    const response = await dispatch(
      new Request("https://mcp.knoww.app/oauth/token", {
        method: "POST",
        headers: {
          host: "mcp.knoww.app",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `grant_type=refresh_token&refresh_token=${"x".repeat(64 * 1024)}`,
      }),
      env
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    });
  });

  it("rejects an oversized OAuth registration before provider parsing", async () => {
    const response = await dispatch(
      new Request("https://mcp.knoww.app/oauth/register", {
        method: "POST",
        headers: {
          host: "mcp.knoww.app",
          "content-length": String(1024 * 1024 + 1),
          "content-type": "application/json",
        },
        body: "{}",
      }),
      env
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    });
  });

  it("applies the OAuth quota before reading an oversized token form", async () => {
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as RateLimit;
    const response = await dispatch(
      new Request("https://mcp.knoww.app/oauth/token", {
        method: "POST",
        headers: {
          host: "mcp.knoww.app",
          "cf-connecting-ip": "192.0.2.13",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `grant_type=refresh_token&refresh_token=${"x".repeat(64 * 1024)}`,
      }),
      { ...env, MCP_AUTH_RATE_LIMITER: limiter }
    );

    expect(response.status).toBe(429);
    expect(keys).toEqual(["/oauth/token:192.0.2.13"]);
  });

  it("rejects MCP traffic when the unauthenticated edge quota is exhausted", async () => {
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as RateLimit;
    const response = await dispatch(
      mcpRequest(initializeBody(70), {
        url: "https://mcp.knoww.app/mcp",
        headers: { "cf-connecting-ip": "192.0.2.10" },
      }),
      { ...env, MCP_EDGE_RATE_LIMITER: limiter }
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(keys).toEqual(["source:192.0.2.10"]);
  });

  it("rate limits the public liveness route", async () => {
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as RateLimit;
    const response = await dispatch(
      new Request("https://mcp.knoww.app/healthz", {
        headers: {
          host: "mcp.knoww.app",
          "cf-connecting-ip": "192.0.2.11",
        },
      }),
      { ...env, MCP_EDGE_RATE_LIMITER: limiter }
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(keys).toEqual(["source:192.0.2.11"]);
  });

  it("rate limits public OAuth discovery", async () => {
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as RateLimit;
    const response = await dispatch(
      new Request(
        "https://mcp.knoww.app/.well-known/oauth-protected-resource/mcp",
        {
          headers: {
            host: "mcp.knoww.app",
            "cf-connecting-ip": "192.0.2.12",
          },
        }
      ),
      { ...env, MCP_EDGE_RATE_LIMITER: limiter }
    );

    expect(response.status).toBe(429);
    expect(keys).toEqual(["source:192.0.2.12"]);
  });

  it("applies the edge quota to unknown paths", async () => {
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as RateLimit;
    const response = await dispatch(
      new Request("https://mcp.knoww.app/random-path", {
        headers: {
          host: "mcp.knoww.app",
          "cf-connecting-ip": "192.0.2.14",
        },
      }),
      { ...env, MCP_EDGE_RATE_LIMITER: limiter }
    );

    expect(response.status).toBe(429);
    expect(keys).toEqual(["source:192.0.2.14"]);
  });

  it("serves an unauthenticated liveness probe with production security headers", async () => {
    const response = await dispatch(
      new Request("https://mcp.knoww.app/healthz", {
        headers: { host: "mcp.knoww.app" },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000"
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("www-authenticate")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("serves a readiness probe after checking stateful bindings", async () => {
    const response = await dispatch(
      new Request("https://mcp.knoww.app/readyz", {
        headers: { host: "mcp.knoww.app" },
      }),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ready" });
  });

  it("fails readiness safely when a stateful binding is unavailable", async () => {
    const failingKv = {
      get: async () => {
        throw new Error("private binding failure");
      },
    } as unknown as KVNamespace;
    const response = await dispatch(
      new Request("https://mcp.knoww.app/readyz", {
        headers: { host: "mcp.knoww.app" },
      }),
      { ...env, OAUTH_KV: failingKv }
    );

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('"status":"unavailable"');
    expect(body).not.toContain("private binding failure");
    expect(body).not.toContain("stack");
  });

  it("rejects non-GET health checks", async () => {
    const response = await dispatch(
      new Request("https://mcp.knoww.app/healthz", {
        method: "POST",
        headers: { host: "mcp.knoww.app" },
      }),
      env
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  it("rejects unauthenticated requests with OAuth discovery metadata", async () => {
    const response = await dispatch(
      mcpRequest(initializeBody(7), { url: "https://mcp.knoww.app/mcp" }),
      env
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.knoww.app/.well-known/oauth-protected-resource/mcp"'
    );
    expect(response.headers.get("x-request-id")).toBeTruthy();

    expect(await response.text()).not.toContain("stack");
  });

  it("treats an unrecognized auth mode as oauth-required (fail closed)", async () => {
    const response = await dispatch(
      mcpRequest(initializeBody(8), { url: "https://mcp.knoww.app/mcp" }),
      { ...env, MCP_AUTH_MODE: "dev-bypass-typo" } as unknown as Env
    );
    expect(response.status).toBe(401);
  });

  it("does not send HSTS for explicit local development", async () => {
    const response = await dispatch(
      new Request("http://localhost/healthz", {
        headers: { host: "localhost" },
      }),
      devEnv
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });
});

const GAMMA_ORIGIN = "https://gamma-api.polymarket.com";

/**
 * @cloudflare/vitest-pool-workers 0.21.3 no longer exports fetchMock from
 * cloudflare:test (verified against dist/worker/index.mjs; the docs still
 * describe it). Tests stub globalThis.fetch instead, which reaches the tool
 * because knoww-services resolves `options?.fetchImpl ?? fetch` at call time.
 */
interface GammaRoute {
  label: string;
  match: (url: URL) => boolean;
  respond: () => Response;
  consumed: boolean;
}

const gammaRoutes: GammaRoute[] = [];

function expectGammaFetch(
  label: string,
  match: (url: URL) => boolean,
  respond: () => Response
): void {
  gammaRoutes.push({ label, match, respond, consumed: false });
}

function gammaUrl(pathname: string, queryContains?: string) {
  return (url: URL): boolean =>
    url.origin === GAMMA_ORIGIN &&
    url.pathname === pathname &&
    (queryContains === undefined || url.search.includes(queryContains));
}

interface ToolCallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  _meta?: Record<string, unknown>;
  structuredContent?: {
    events?: Array<Record<string, unknown>>;
    meta?: Record<string, unknown>;
  };
}

async function callSearchMarkets(
  id: number,
  args: Record<string, unknown>,
  testEnv: Env = devEnv
): Promise<{ response: Response; message: JsonRpcResponse }> {
  const response = await dispatch(
    mcpRequest(
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "search_markets", arguments: args },
      },
      { headers: { "mcp-protocol-version": PROTOCOL_VERSION } }
    ),
    testEnv
  );
  const message = await readJsonRpc(response);
  return { response, message };
}

describe("search_markets tool (dev bypass)", () => {
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      _init?: RequestInit
    ) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString()
      );
      const route = gammaRoutes.find(
        (candidate) => !candidate.consumed && candidate.match(url)
      );
      if (!route) {
        throw new Error(
          `unexpected outbound fetch in test: ${url.origin}${url.pathname}`
        );
      }
      route.consumed = true;
      return route.respond();
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  afterEach(() => {
    const pending = gammaRoutes
      .filter((route) => !route.consumed)
      .map((route) => route.label);
    gammaRoutes.length = 0;
    expect(pending).toEqual([]);
  });

  /** Gamma /public-search event shaped like the live API (JSON-string outcomes). */
  const bitcoinEvent = {
    id: "evt-1",
    slug: "bitcoin-above-100k",
    title: "Bitcoin above $100k in 2026?",
    active: true,
    closed: false,
    endDate: "2026-12-31T00:00:00Z",
    volume24hr: 12345.67,
    liquidity: 89000.5,
    markets: [
      {
        id: "mkt-1",
        slug: "bitcoin-above-100k-in-2026",
        conditionId:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        question: "Bitcoin above $100k in 2026?",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.62","0.38"]',
        clobTokenIds: '["123456789","987654321"]',
      },
      {
        id: "mkt-2",
        question: "Alternate outcome market",
        outcomes: '["Maybe"]',
        outcomePrices: '["0.1"]',
      },
    ],
  };

  it("returns a tool-level retry signal when the per-tool quota is exhausted", async () => {
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as RateLimit;

    const { response, message } = await callSearchMarkets(
      9,
      { query: "bitcoin" },
      { ...devEnv, MCP_FREE_TOOL_RATE_LIMITER: limiter }
    );

    expect(response.status).toBe(200);
    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("RATE_LIMITED");
    expect(result.content?.[0]?.text).toContain("Retry after 60 seconds");
    expect(result._meta).toMatchObject({
      "app.knoww/error": {
        code: "RATE_LIMITED",
        retryable: true,
        retryAfterSeconds: 60,
      },
    });
    expect(keys).toEqual(["free:local-development:search_markets"]);
  });

  it("returns event summaries with decimal-string prices and request metadata", async () => {
    expectGammaFetch(
      "public-search q=bitcoin",
      gammaUrl("/public-search", "q=bitcoin"),
      () =>
        Response.json({
          events: [bitcoinEvent],
          tags: [],
          profiles: [],
          pagination: { hasMore: true, totalResults: 42 },
        })
    );

    const { response, message } = await callSearchMarkets(10, {
      query: "bitcoin",
    });

    expect(response.status).toBe(200);
    expect(message.error).toBeUndefined();

    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(result.content?.[0]?.type).toBe("text");
    expect(result.content?.[0]?.text).toContain('"bitcoin"');

    expect(result.structuredContent?.events).toEqual([
      {
        id: "evt-1",
        slug: "bitcoin-above-100k",
        title: "Bitcoin above $100k in 2026?",
        status: "active",
        url: "https://knoww.app/events/detail/bitcoin-above-100k",
        endDate: "2026-12-31T00:00:00Z",
        volume24hr: "12345.67",
        liquidity: "89000.5",
        topOutcome: { name: "Yes", price: "0.62" },
        totalMarkets: 2,
        markets: [
          {
            id: "mkt-1",
            slug: "bitcoin-above-100k-in-2026",
            conditionId:
              "0x1111111111111111111111111111111111111111111111111111111111111111",
            question: "Bitcoin above $100k in 2026?",
            totalOutcomes: 2,
            outcomes: [
              { name: "Yes", price: "0.62", tokenId: "123456789" },
              { name: "No", price: "0.38", tokenId: "987654321" },
            ],
          },
          {
            id: "mkt-2",
            question: "Alternate outcome market",
            totalOutcomes: 1,
            outcomes: [{ name: "Maybe", price: "0.1" }],
          },
        ],
      },
    ]);

    const meta = result.structuredContent?.meta as Record<string, unknown>;
    expect(meta.requestId).toBe(response.headers.get("x-request-id"));
    expect(Number.isNaN(Date.parse(String(meta.asOf)))).toBe(false);
    expect(meta.sources).toEqual([
      { name: "polymarket-gamma", url: GAMMA_ORIGIN },
    ]);
    expect(meta.truncated).toBe(true);
    expect("nextCursor" in meta).toBe(false);
  });

  it("ignores incomplete archived markets in otherwise active events", async () => {
    expectGammaFetch(
      "public-search archived market",
      gammaUrl("/public-search", "q=archived"),
      () =>
        Response.json({
          events: [
            {
              id: "evt-archived",
              title: "Live event with an archived market",
              active: true,
              closed: false,
              markets: [
                {
                  id: "mkt-active",
                  active: true,
                  closed: false,
                  outcomes: '["Yes","No"]',
                  outcomePrices: '["0.6","0.4"]',
                },
                {
                  id: "mkt-archived",
                  active: false,
                  closed: true,
                  archived: true,
                  outcomes: '["Yes","No"]',
                  outcomePrices: "[]",
                },
              ],
            },
          ],
          tags: [],
          profiles: [],
          hasMore: false,
        })
    );

    const { message } = await callSearchMarkets(16, { query: "archived" });

    expect(message.error).toBeUndefined();
    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.events).toEqual([
      expect.objectContaining({
        id: "evt-archived",
        totalMarkets: 1,
        markets: [expect.objectContaining({ id: "mkt-active" })],
      }),
    ]);
  });

  it("merges tag results when a category is given, normalized to a slug", async () => {
    expectGammaFetch(
      "public-search q=election",
      gammaUrl("/public-search", "q=election"),
      () =>
        Response.json({
          events: [
            {
              id: "evt-2",
              slug: "presidential-election-2028",
              title: "Presidential election 2028 winner",
              active: true,
              markets: [],
            },
          ],
          tags: [],
          profiles: [],
          pagination: { hasMore: false, totalResults: 1 },
        })
    );
    expectGammaFetch(
      "events/keyset tag_slug=us-politics",
      gammaUrl("/events/keyset", "tag_slug=us-politics"),
      () =>
        Response.json([
          {
            id: "evt-3",
            slug: "senate-2028",
            title: "Senate election 2028 control",
            active: true,
            markets: [],
          },
        ])
    );

    const { message } = await callSearchMarkets(11, {
      query: "election",
      category: "US Politics",
    });

    expect(message.error).toBeUndefined();
    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    const events = result.structuredContent?.events ?? [];
    expect(events.map((event) => event.id)).toEqual(["evt-2", "evt-3"]);
  });

  it("preserves exact top-outcome precision and reports nested truncation", async () => {
    const outcomes = Array.from({ length: 21 }, (_, index) => `O${index}`);
    const prices = Array.from({ length: 21 }, (_, index) =>
      index === 20 ? "0.01" : "0.001"
    );
    const markets = Array.from({ length: 11 }, (_, index) => ({
      id: `m${index}`,
      groupItemTitle:
        index === 0 ? "Lower" : index === 1 ? "Higher" : `M${index}`,
      outcomes:
        index === 0
          ? '["Yes","No"]'
          : index === 1
            ? '["Yes","No"]'
            : JSON.stringify(outcomes),
      outcomePrices:
        index === 0
          ? '["0.9","0.1"]'
          : index === 1
            ? '["0.90000000000000001","0.09999999999999999"]'
            : JSON.stringify(prices),
    }));
    expectGammaFetch(
      "public-search nested caps",
      gammaUrl("/public-search"),
      () =>
        Response.json({
          events: [{ id: "e-capped", title: "Capped", markets }],
          pagination: { hasMore: false, totalResults: 1 },
        })
    );

    const { message } = await callSearchMarkets(15, { query: "capped" });

    const result = message.result as ToolCallResult;
    const event = result.structuredContent?.events?.[0] as Record<
      string,
      unknown
    >;
    expect(event.topOutcome).toEqual({
      name: "Higher",
      price: "0.90000000000000001",
    });
    expect(event.totalMarkets).toBe(11);
    expect(event.marketsTruncated).toBe(true);
    const returnedMarkets = event.markets as Array<Record<string, unknown>>;
    expect(returnedMarkets).toHaveLength(10);
    expect(returnedMarkets[2].totalOutcomes).toBe(21);
    expect(returnedMarkets[2].outcomesTruncated).toBe(true);
    expect(result.structuredContent?.meta?.truncated).toBe(true);
  });

  it("maps a failed upstream with no results to a retryable tool error", async () => {
    expectGammaFetch(
      "public-search 503",
      gammaUrl("/public-search"),
      () => new Response("upstream unavailable", { status: 503 })
    );

    const { message } = await callSearchMarkets(12, { query: "bitcoin" });

    expect(message.error).toBeUndefined();
    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("UPSTREAM_UNAVAILABLE");
    expect(result.content?.[0]?.text).toContain("Safe to retry.");
  });

  it("returns an empty success (not an error) when nothing matches", async () => {
    expectGammaFetch("public-search empty", gammaUrl("/public-search"), () =>
      Response.json({
        events: [],
        tags: [],
        profiles: [],
        pagination: { hasMore: false, totalResults: 0 },
      })
    );

    const { message } = await callSearchMarkets(13, {
      query: "zzz-nothing-matches",
    });

    expect(message.error).toBeUndefined();
    const result = message.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.events).toEqual([]);
    const meta = result.structuredContent?.meta as Record<string, unknown>;
    expect("truncated" in meta).toBe(false);
    expect(result.content?.[0]?.text).toBeTruthy();
  });

  it("rejects a whitespace-only query as invalid params without calling upstream", async () => {
    const { message } = await callSearchMarkets(14, { query: "   " });

    // The installed SDK reports input-validation failures as a tool-level
    // isError result ("Input validation error: Invalid arguments for tool
    // ..."), not as a JSON-RPC -32602 protocol error. The fetch stub in this
    // suite throws on any outbound request, so reaching these assertions also
    // proves the tool never called upstream.
    expect(message.error).toBeUndefined();
    const result = message.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/invalid/i);
    expect(result.content?.[0]?.text).toContain("query");
  });
});
