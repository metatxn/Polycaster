"use client";

import { useRef, useState } from "react";
import {
  type JsonRpcResponse,
  MCP_PROTOCOL_VERSION,
  type McpTool,
  sendMcpRequest,
  toolsFromResponse,
} from "./mcp-client";
import { ConnectionPanel, ResponsePanel } from "./mcp-test-panels";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8787/mcp";
const TOOL_EXAMPLES: Record<string, Record<string, unknown>> = {
  search_markets: { query: "bitcoin", limit: 3 },
  get_market: { slug: "fed-rate-cut-in-august-2026" },
  get_event: { slug: "clarity-act", marketLimit: 5 },
  get_orderbook: { tokenId: "" },
  get_price_history: { tokenId: "", fidelityMinutes: 60 },
};

function exampleArguments(toolName: string): string {
  return JSON.stringify(TOOL_EXAMPLES[toolName] ?? {}, null, 2);
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
  const [selectedToolName, setSelectedToolName] = useState("");
  const [argumentsJson, setArgumentsJson] = useState("{}");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(
    "Start the MCP worker, then connect to discover its tools."
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"connect" | "call" | null>(null);

  const nextId = () => {
    requestId.current += 1;
    return requestId.current;
  };

  const connect = async () => {
    setBusy("connect");
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
          clientInfo: { name: "knoww-mcp-test-ui", version: "1.0.0" },
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
      const firstTool = discoveredTools[0];
      setTools(discoveredTools);
      setSelectedToolName(firstTool?.name ?? "");
      setArgumentsJson(exampleArguments(firstTool?.name ?? ""));
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
      setSelectedToolName("");
      setError(errorText(caught));
      setStatus("Connection failed.");
    } finally {
      setBusy(null);
    }
  };

  const runTool = async () => {
    setError("");
    let args: Record<string, unknown>;
    try {
      args = parseArguments(argumentsJson);
    } catch (caught) {
      setError(errorText(caught));
      return;
    }

    setBusy("call");
    setStatus(`Calling ${selectedToolName}...`);
    try {
      const response = await sendMcpRequest(endpoint, {
        jsonrpc: "2.0",
        id: nextId(),
        method: "tools/call",
        params: { name: selectedToolName, arguments: args },
      });
      setOutput(JSON.stringify(response, null, 2));
      const callError = responseError(response);
      if (callError) throw callError;
      setStatus(`${selectedToolName} returned a response.`);
    } catch (caught) {
      setError(errorText(caught));
      setStatus(`${selectedToolName} failed.`);
    } finally {
      setBusy(null);
    }
  };

  const selectedTool = tools.find((tool) => tool.name === selectedToolName);

  return (
    <div className="grid overflow-hidden rounded-xl border bg-card lg:h-160 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
      <ConnectionPanel
        argumentsJson={argumentsJson}
        busy={busy}
        endpoint={endpoint}
        error={error}
        onArgumentsChange={setArgumentsJson}
        onConnect={() => void connect()}
        onEndpointChange={setEndpoint}
        onRunTool={() => void runTool()}
        onToolChange={(name) => {
          setSelectedToolName(name);
          setArgumentsJson(exampleArguments(name));
          setError("");
        }}
        selectedTool={selectedTool}
        selectedToolName={selectedToolName}
        status={status}
        tools={tools}
      />
      <ResponsePanel output={output} />
    </div>
  );
}
