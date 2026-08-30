"use client";

import { useRef, useState } from "react";
import { exampleArguments, TOOL_CATALOG } from "./mcp-catalog";
import {
  type JsonRpcResponse,
  MCP_PROTOCOL_VERSION,
  type McpTool,
  sendMcpRequest,
  toolsFromResponse,
} from "./mcp-client";
import { McpConnectionBar } from "./mcp-connection-bar";
import { McpOperation } from "./mcp-operation";

const DEFAULT_ENDPOINT =
  process.env.NODE_ENV === "production"
    ? "https://mcp.knoww.app/mcp"
    : "http://127.0.0.1:8787/mcp";

function initialArguments(): Record<string, string> {
  return Object.fromEntries(
    TOOL_CATALOG.map((tool) => [tool.name, exampleArguments(tool.name)])
  );
}

function responseError(response: JsonRpcResponse): Error | null {
  if (!response.error) return null;
  return new Error(
    `JSON-RPC ${response.error.code}: ${response.error.message}`
  );
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Arguments must be a JSON object.");
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}

export function McpTestClient() {
  const requestId = useRef(0);
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [connected, setConnected] = useState(false);
  const [expandedTool, setExpandedTool] = useState("search_markets");
  const [argumentsByTool, setArgumentsByTool] = useState(initialArguments);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(
    "Connect to verify the server catalog and enable requests."
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"connect" | "call" | null>(null);

  const nextId = () => {
    requestId.current += 1;
    return requestId.current;
  };

  const connect = async () => {
    setBusy("connect");
    setConnected(false);
    setError("");
    setOutput("");
    setStatus("Connecting and reading the tool catalog...");
    try {
      const initialize = await sendMcpRequest(endpoint, {
        jsonrpc: "2.0",
        id: nextId(),
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "knoww-mcp-explorer", version: "1.0.0" },
        },
      });
      const initializeError = responseError(initialize);
      if (initializeError) throw initializeError;

      const listResponse = await sendMcpRequest(endpoint, {
        jsonrpc: "2.0",
        id: nextId(),
        method: "tools/list",
        params: {},
      });
      const listError = responseError(listResponse);
      if (listError) throw listError;

      const discoveredTools = toolsFromResponse(listResponse);
      setTools(discoveredTools);
      setConnected(true);
      setOutput(JSON.stringify(listResponse, null, 2));

      const serverInfo = initialize.result?.serverInfo as
        | { name?: string; version?: string }
        | undefined;
      const serverName = serverInfo?.name ?? "MCP server";
      const serverVersion = serverInfo?.version ? ` ${serverInfo.version}` : "";
      const toolLabel = discoveredTools.length === 1 ? "tool" : "tools";
      setStatus(
        `Connected to ${serverName}${serverVersion}. Found ${discoveredTools.length} ${toolLabel}.`
      );
    } catch (caught) {
      setTools([]);
      setConnected(false);
      setError(errorText(caught));
      setStatus("Connection failed.");
    } finally {
      setBusy(null);
    }
  };

  const runTool = async (toolName: string) => {
    setError("");
    let args: Record<string, unknown>;
    try {
      args = parseArguments(argumentsByTool[toolName] ?? "{}");
    } catch (caught) {
      setError(errorText(caught));
      return;
    }

    setBusy("call");
    setStatus(`Calling ${toolName}...`);
    try {
      const response = await sendMcpRequest(endpoint, {
        jsonrpc: "2.0",
        id: nextId(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      });
      setOutput(JSON.stringify(response, null, 2));
      const callError = responseError(response);
      if (callError) throw callError;
      setStatus(`${toolName} returned a response.`);
    } catch (caught) {
      setError(errorText(caught));
      setStatus(`${toolName} failed.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <McpConnectionBar
        busy={busy === "connect"}
        connected={connected}
        endpoint={endpoint}
        onConnect={() => void connect()}
        onEndpointChange={(value) => {
          setEndpoint(value);
          setConnected(false);
          setTools([]);
          setError("");
          setStatus("Endpoint changed. Connect to verify its tool catalog.");
        }}
        status={status}
      />

      <section aria-labelledby="mcp-tools-heading">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 id="mcp-tools-heading" className="text-lg font-semibold">
              Tools
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Expand an operation, edit its JSON arguments, and execute it.
            </p>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {TOOL_CATALOG.length} operations
          </span>
        </div>
        <div className="space-y-2">
          {TOOL_CATALOG.map((tool) => (
            <McpOperation
              key={tool.name}
              tool={tool}
              argumentsJson={argumentsByTool[tool.name] ?? "{}"}
              busy={busy === "call" && expandedTool === tool.name}
              connected={connected}
              discoveredTool={tools.find((item) => item.name === tool.name)}
              error={expandedTool === tool.name ? error : ""}
              expanded={expandedTool === tool.name}
              output={expandedTool === tool.name ? output : ""}
              onArgumentsChange={(value) =>
                setArgumentsByTool((current) => ({
                  ...current,
                  [tool.name]: value,
                }))
              }
              onExecute={() => void runTool(tool.name)}
              onToggle={() => {
                setExpandedTool((current) =>
                  current === tool.name ? "" : tool.name
                );
                setError("");
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
