import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "./index";

const DEV_VARS = {
  MCP_AUTH_MODE: "dev-bypass",
  MCP_CANONICAL_RESOURCE: "http://localhost:8787/mcp",
  MCP_ALLOWED_HOSTNAMES: "localhost,127.0.0.1",
  MCP_ALLOWED_ORIGIN_HOSTNAMES: "localhost,127.0.0.1",
} as const;

interface PostHogBatch {
  api_key: string;
  batch: Array<{
    event: string;
    properties: Record<string, unknown>;
  }>;
}

describe("MCP analytics lifecycle", () => {
  const delivered: PostHogBatch[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString()
      );
      if (url.origin !== "https://us.i.posthog.com") {
        throw new Error(`unexpected outbound fetch: ${url.origin}`);
      }
      delivered.push(JSON.parse(String(init?.body)) as PostHogBatch);
      return Response.json({ status: "Ok" });
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("captures HTTP, protocol, and tool outcomes without request arguments", async () => {
    const testEnv = {
      ...env,
      ...DEV_VARS,
      POSTHOG_PROJECT_API_KEY: "test-project-token",
      POSTHOG_HOST: "https://us.i.posthog.com",
      MCP_FREE_TOOL_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
    } as unknown as Env;
    const request = new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_market",
          arguments: { slug: "private-test-query" },
        },
      }),
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(delivered).toHaveLength(1);
    const batch = delivered[0]?.batch ?? [];
    expect(batch.map(({ event }) => event).sort()).toEqual([
      "mcp_http_request_completed",
      "mcp_protocol_request_completed",
      "mcp_tool_called",
    ]);

    const toolEvent = batch.find(({ event }) => event === "mcp_tool_called");
    expect(toolEvent?.properties).toMatchObject({
      product: "mcp",
      service: "knoww-mcp",
      tool_name: "get_market",
      outcome: "error",
      error_code: "RATE_LIMITED",
      auth_method: "dev-bypass",
      plan: "free",
    });
    expect(toolEvent?.properties.distinct_id).not.toContain(
      "local-development"
    );

    const protocolEvent = batch.find(
      ({ event }) => event === "mcp_protocol_request_completed"
    );
    expect(protocolEvent?.properties).toMatchObject({
      protocol_method: "tools/call",
      tool_name: "get_market",
      status: 200,
    });
    expect(JSON.stringify(delivered)).not.toContain("private-test-query");
  });
});
