import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpTestClient } from "./mcp-test-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("McpTestClient", () => {
  it("connects, discovers tools, and runs the selected tool", async () => {
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

    await screen.findByRole("option", { name: "search_markets" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Connected to knoww-mcp 0.1.0. Found 1 tool."
    );
    expect(screen.getByLabelText("Arguments as JSON")).toHaveValue(
      '{\n  "query": "bitcoin",\n  "limit": 3\n}'
    );

    fireEvent.click(screen.getByRole("button", { name: "Run tool" }));

    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Response output" })
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
    await screen.findByRole("option", { name: "search_markets" });

    fireEvent.change(screen.getByLabelText("Arguments as JSON"), {
      target: { value: "not json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run tool" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Arguments must be a JSON object."
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
