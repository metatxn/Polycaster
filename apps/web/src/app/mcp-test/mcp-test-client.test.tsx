import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpTestClient } from "./mcp-test-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("McpTestClient", () => {
  it("shows the complete documented tool catalog before connecting", () => {
    render(<McpTestClient />);

    expect(
      screen.getByRole("button", { name: /^TOOLsearch_markets/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^TOOLget_market/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^TOOLget_event/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^TOOLget_orderbook/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^TOOLget_price_history/i })
    ).toBeInTheDocument();
  });

  it("connects, discovers tools, and runs an operation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      if (request.method === "initialize") {
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { serverInfo: { name: "knoww-mcp", version: "0.1.0" } },
        });
      }
      if (request.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: 2,
          result: {
            tools: [
              {
                name: "search_markets",
                description: "Search active prediction markets.",
                inputSchema: {
                  properties: { query: { type: "string" } },
                  required: ["query"],
                },
              },
            ],
          },
        });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: 3,
        result: { structuredContent: { events: [{ title: "Bitcoin" }] } },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<McpTestClient />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await screen.findByText("Connected to knoww-mcp 0.1.0. Found 1 tool.");
    expect(screen.getByLabelText("Arguments for search_markets")).toHaveValue(
      '{\n  "query": "bitcoin",\n  "limit": 3\n}'
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Execute search_markets" })
    );

    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "search_markets response" })
      ).toHaveTextContent('"title": "Bitcoin"');
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows invalid argument JSON without sending a tool call", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      return request.method === "initialize"
        ? Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: { serverInfo: { name: "knoww-mcp" } },
          })
        : Response.json({
            jsonrpc: "2.0",
            id: 2,
            result: { tools: [{ name: "search_markets" }] },
          });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<McpTestClient />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected to knoww-mcp. Found 1 tool.");

    fireEvent.change(screen.getByLabelText("Arguments for search_markets"), {
      target: { value: "not json" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Execute search_markets" })
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Arguments must be a JSON object."
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports an MCP tool result marked as an error", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      if (request.method === "initialize") {
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { serverInfo: { name: "knoww-mcp" } },
        });
      }
      if (request.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: 2,
          result: { tools: [{ name: "search_markets" }] },
        });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: 3,
        result: {
          isError: true,
          content: [{ type: "text", text: "VALIDATION_ERROR: Invalid query." }],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<McpTestClient />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected to knoww-mcp. Found 1 tool.");
    fireEvent.click(
      screen.getByRole("button", { name: "Execute search_markets" })
    );

    await screen.findByText("search_markets failed.");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "VALIDATION_ERROR: Invalid query."
    );
  });

  it("authorizes a production connection with PKCE and keeps the token out of the page", async () => {
    const popup = {
      close: vi.fn(),
      location: { href: "" },
    };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("oauth-protected-resource")) {
        return Response.json({
          resource: "https://mcp.knoww.app/mcp",
          authorization_servers: ["https://mcp.knoww.app"],
          scopes_supported: ["markets:read"],
        });
      }
      if (url.includes("oauth-authorization-server")) {
        return Response.json({
          issuer: "https://mcp.knoww.app",
          authorization_endpoint: "https://mcp.knoww.app/authorize",
          token_endpoint: "https://mcp.knoww.app/oauth/token",
          registration_endpoint: "https://mcp.knoww.app/oauth/register",
          code_challenge_methods_supported: ["S256"],
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (url.endsWith("/oauth/register")) {
        return Response.json({ client_id: "browser-client" });
      }
      if (url.endsWith("/oauth/token")) {
        return Response.json({
          access_token: "private-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "markets:read",
        });
      }
      const request = JSON.parse(String(init?.body)) as { method: string };
      return request.method === "initialize"
        ? Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: { serverInfo: { name: "knoww-mcp" } },
          })
        : Response.json({
            jsonrpc: "2.0",
            id: 2,
            result: { tools: [{ name: "search_markets" }] },
          });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<McpTestClient />);
    fireEvent.change(screen.getByRole("textbox", { name: "Server" }), {
      target: { value: "https://mcp.knoww.app/mcp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

    await waitFor(() => {
      expect(popup.location.href).toContain("https://mcp.knoww.app/authorize?");
    });
    const authorizationUrl = new URL(popup.location.href);
    fireEvent(
      window,
      new window.MessageEvent("message", {
        origin: window.location.origin,
        data: {
          type: "knoww-mcp-oauth-callback",
          params: {
            code: "authorization-code",
            state: authorizationUrl.searchParams.get("state"),
            iss: "https://mcp.knoww.app",
          },
        },
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await screen.findByRole("button", { name: "Disconnect" });
    expect(document.body).not.toHaveTextContent("private-access-token");

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected to knoww-mcp. Found 1 tool.");
    const mcpCalls = fetchMock.mock.calls.filter(
      ([input]) => String(input) === "https://mcp.knoww.app/mcp"
    );
    expect(mcpCalls).toHaveLength(2);
    for (const [, init] of mcpCalls) {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer private-access-token",
      });
    }
  });
});
