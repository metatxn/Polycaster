export const MCP_PROTOCOL_VERSION = "2025-11-25";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, { description?: string; type?: string }>;
    required?: string[];
  };
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<JsonRpcResponse>;
  return candidate.jsonrpc === "2.0" && "id" in candidate;
}

function parseJsonRpc(value: string): JsonRpcResponse {
  const parsed: unknown = JSON.parse(value);
  if (!isJsonRpcResponse(parsed)) {
    throw new Error("The server returned an invalid JSON-RPC response.");
  }
  return parsed;
}

export async function parseMcpResponse(
  response: Response
): Promise<JsonRpcResponse> {
  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return parseJsonRpc(body);
  }

  const frames = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  const lastFrame = frames.at(-1);
  if (!lastFrame) {
    throw new Error("The server returned an empty event stream.");
  }
  return parseJsonRpc(lastFrame);
}

function validateEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Enter an http:// or https:// MCP endpoint.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Enter an http:// or https:// MCP endpoint.");
  }
  return url.toString();
}

export async function sendMcpRequest(
  endpoint: string,
  body: JsonRpcRequest,
  fetchImpl: typeof fetch = fetch
): Promise<JsonRpcResponse> {
  const response = await fetchImpl(validateEndpoint(endpoint), {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`MCP server returned HTTP ${response.status}.`);
  }
  return parseMcpResponse(response);
}

export function toolsFromResponse(response: JsonRpcResponse): McpTool[] {
  const tools = response.result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error("The server did not return a tool list.");
  }
  return tools.filter(
    (tool): tool is McpTool =>
      Boolean(tool) &&
      typeof tool === "object" &&
      typeof (tool as Partial<McpTool>).name === "string"
  );
}
