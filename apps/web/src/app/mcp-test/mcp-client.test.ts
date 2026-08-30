import { describe, expect, it, vi } from "vitest";
import {
  MCP_PROTOCOL_VERSION,
  parseMcpResponse,
  sendMcpRequest,
} from "./mcp-client";

describe("parseMcpResponse", () => {
  it("reads a plain JSON-RPC response", async () => {
    const response = Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "knoww-mcp" } },
    });

    await expect(parseMcpResponse(response)).resolves.toMatchObject({
      id: 1,
      result: { serverInfo: { name: "knoww-mcp" } },
    });
  });

  it("uses the final data frame from an SSE response", async () => {
    const response = new Response(
      [
        "event: message",
        'data: {"jsonrpc":"2.0","id":1,"result":{"step":"first"}}',
        "",
        "event: message",
        'data: {"jsonrpc":"2.0","id":1,"result":{"step":"last"}}',
        "",
      ].join("\n"),
      { headers: { "content-type": "text/event-stream" } }
    );

    await expect(parseMcpResponse(response)).resolves.toMatchObject({
      result: { step: "last" },
    });
  });

  it("does not expose malformed response content in its error", async () => {
    const response = new Response("<private upstream response>", {
      headers: { "content-type": "application/json" },
    });

    await expect(parseMcpResponse(response)).rejects.toThrow(
      "The server returned invalid JSON."
    );
  });
});

describe("sendMcpRequest", () => {
  it("sends the protocol headers and JSON-RPC body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        jsonrpc: "2.0",
        id: 7,
        result: { tools: [] },
      })
    );

    await sendMcpRequest(
      "http://127.0.0.1:8787/mcp",
      { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} },
      { fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/mcp",
      expect.objectContaining({
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/list",
          params: {},
        }),
      })
    );
  });

  it("sends an access token in the authorization header", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ jsonrpc: "2.0", id: 8, result: { tools: [] } })
      );

    await sendMcpRequest(
      "https://mcp.knoww.app/mcp",
      { jsonrpc: "2.0", id: 8, method: "tools/list", params: {} },
      { accessToken: "private-access-token", fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://mcp.knoww.app/mcp",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer private-access-token",
        }),
      })
    );
  });

  it("rejects endpoints that are not HTTP URLs before fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      sendMcpRequest(
        "javascript:alert(1)",
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { fetchImpl }
      )
    ).rejects.toThrow("Enter an http:// or https:// MCP endpoint.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects endpoints with embedded credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      sendMcpRequest(
        "http://user:password@127.0.0.1:8787/mcp",
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { fetchImpl }
      )
    ).rejects.toThrow("Do not include credentials in the endpoint URL.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports HTTP failures without trying to parse them as JSON-RPC", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Forbidden", { status: 403 }));

    await expect(
      sendMcpRequest(
        "http://localhost:8787/mcp",
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { fetchImpl }
      )
    ).rejects.toThrow("MCP server returned HTTP 403.");
  });
});
