import { describe, expect, it, vi } from "vitest";
import {
  createMcpAnalytics,
  MCP_ANALYTICS_EVENTS,
  mcpRoute,
  parseMcpProtocolMessages,
} from "./analytics";

describe("MCP PostHog analytics", () => {
  it("batches privacy-safe events and hashes authenticated identities", async () => {
    const backgroundTasks: Promise<unknown>[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ status: "Ok" })
    );
    const analytics = createMcpAnalytics({
      projectApiKey: "test-project-token",
      host: "https://us.i.posthog.com///",
      fetchImpl,
      waitUntil: (task) => backgroundTasks.push(task),
    });

    analytics.capture(
      MCP_ANALYTICS_EVENTS.httpRequestCompleted,
      {
        request_id: "request-1",
        route: "/mcp",
        status: 200,
      },
      "principal-123"
    );
    analytics.capture(
      MCP_ANALYTICS_EVENTS.toolCalled,
      {
        request_id: "request-1",
        tool_name: "search_markets",
        outcome: "success",
      },
      "principal-123"
    );
    analytics.flush();
    await Promise.all(backgroundTasks);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://us.i.posthog.com/batch/");
    expect(init).toMatchObject({ method: "POST" });

    const payload = JSON.parse(String(init?.body)) as {
      api_key: string;
      batch: Array<{
        event: string;
        properties: Record<string, unknown>;
      }>;
    };
    expect(payload.api_key).toBe("test-project-token");
    expect(payload.batch.map(({ event }) => event)).toEqual([
      "mcp_http_request_completed",
      "mcp_tool_called",
    ]);
    expect(payload.batch[0]?.properties).toMatchObject({
      product: "mcp",
      service: "knoww-mcp",
      $process_person_profile: false,
      request_id: "request-1",
    });
    expect(payload.batch[0]?.properties.distinct_id).toBe(
      payload.batch[1]?.properties.distinct_id
    );
    expect(payload.batch[0]?.properties.distinct_id).not.toContain(
      "principal-123"
    );
  });

  it("does not schedule delivery when the project token is absent", () => {
    const waitUntil = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>();
    const analytics = createMcpAnalytics({
      projectApiKey: "",
      fetchImpl,
      waitUntil,
    });

    analytics.capture(MCP_ANALYTICS_EVENTS.httpRequestCompleted, {
      route: "/healthz",
    });
    analytics.flush();

    expect(waitUntil).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses bounded route names for every public endpoint", () => {
    const publicRoutes = [
      "/healthz",
      "/readyz",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-authorization-server",
      "/authorize",
      "/auth/google/callback",
      "/oauth/token",
      "/oauth/register",
      "/mcp",
    ];

    for (const route of publicRoutes) {
      expect(mcpRoute(route)).toBe(route);
    }
    expect(mcpRoute("/attacker-controlled-value")).toBe("other");
  });

  it("extracts only bounded MCP protocol and tool metadata", () => {
    expect(
      parseMcpProtocolMessages({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "Codex Desktop", version: "1.2.3" },
        },
      })
    ).toEqual([
      {
        protocol_method: "initialize",
        client_family: "codex",
      },
    ]);

    expect(
      parseMcpProtocolMessages([
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "get_market",
            arguments: { query: "must not be captured" },
          },
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "attacker-controlled-method",
        },
      ])
    ).toEqual([
      { protocol_method: "tools/call", tool_name: "get_market" },
      { protocol_method: "other" },
    ]);
  });
});
