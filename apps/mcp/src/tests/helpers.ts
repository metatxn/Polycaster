import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import worker from "../index";

/**
 * Shared infrastructure for per-tool test files. worker.test.ts predates this
 * module and keeps its own copy so its suite stays byte-stable; new tool
 * suites import from here instead.
 */

/**
 * The pool loads the top-level wrangler.jsonc vars, so `env` is the
 * production shape (oauth-required). Tests that exercise the MCP handler
 * spread these dev-bypass overrides on top.
 */
const DEV_VARS = {
  MCP_AUTH_MODE: "dev-bypass",
  MCP_ALLOWED_HOSTNAMES: "localhost,127.0.0.1",
  MCP_ALLOWED_ORIGIN_HOSTNAMES: "localhost,127.0.0.1",
} as const;

export const devEnv = { ...env, ...DEV_VARS } as Env;

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * Requests emulate today's MCP clients (Claude Desktop, claude.ai connectors,
 * the inspector), which all speak the classic initialize handshake. In SDK v2
 * that handshake tops out at protocol 2025-11-25.
 */
export const PROTOCOL_VERSION = "2025-11-25";

export function mcpRequest(
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

export async function dispatch(
  request: Request,
  testEnv: Env
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

/** Reads a JSON-RPC response from either a JSON body or an SSE stream. */
export async function readJsonRpc(
  response: Response
): Promise<JsonRpcResponse> {
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

export interface ToolCallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

export async function callTool(
  toolName: string,
  id: number,
  args: Record<string, unknown>
): Promise<{ response: Response; message: JsonRpcResponse }> {
  const response = await dispatch(
    mcpRequest(
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      },
      { headers: { "mcp-protocol-version": PROTOCOL_VERSION } }
    ),
    devEnv
  );
  const message = await readJsonRpc(response);
  return { response, message };
}

export const GAMMA_ORIGIN = "https://gamma-api.polymarket.com";

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

export function expectGammaFetch(
  label: string,
  match: (url: URL) => boolean,
  respond: () => Response
): void {
  gammaRoutes.push({ label, match, respond, consumed: false });
}

export function gammaUrl(pathname: string, queryContains?: string) {
  return (url: URL): boolean =>
    url.origin === GAMMA_ORIGIN &&
    url.pathname === pathname &&
    (queryContains === undefined || url.search.includes(queryContains));
}

export const CLOB_ORIGIN = "https://clob.polymarket.com";
export const DATA_ORIGIN = "https://data-api.polymarket.com";

/** The route table matches any URL, so CLOB routes ride the same stub. */
export function clobUrl(pathname: string, queryContains?: string) {
  return (url: URL): boolean =>
    url.origin === CLOB_ORIGIN &&
    url.pathname === pathname &&
    (queryContains === undefined || url.search.includes(queryContains));
}

export function dataUrl(pathname: string, queryContains?: string) {
  return (url: URL): boolean =>
    url.origin === DATA_ORIGIN &&
    url.pathname === pathname &&
    (queryContains === undefined || url.search.includes(queryContains));
}

/**
 * Installs the route-table fetch stub for the enclosing describe block.
 * Unmatched outbound fetches throw, so a test with no registered routes also
 * proves its code path never called upstream. afterEach fails the test if a
 * registered route went unused.
 */
export function setupGammaFetchStub(): void {
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
}
