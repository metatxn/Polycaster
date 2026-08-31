import { McpServer } from "@modelcontextprotocol/server";
import { MCP_ANALYTICS_EVENTS } from "./analytics";
import {
  currentAnalytics,
  currentPrincipal,
  currentRequestId,
} from "./context";
import { KnowwToolError } from "./errors/tool-error";
import { registerGetEventTool } from "./tools/get-event";
import { registerGetMarketTool } from "./tools/get-market";
import { registerGetOrderbookTool } from "./tools/get-orderbook";
import { registerGetPriceHistoryTool } from "./tools/get-price-history";
import { registerPublicMarketTools } from "./tools/public-markets";
import { registerPublicWalletTools } from "./tools/public-wallets";
import { registerSearchMarketsTool } from "./tools/search-markets";

export const SERVER_INFO = { name: "knoww-mcp", version: "0.1.0" } as const;

type ToolCallback = (...args: unknown[]) => unknown;
type RegisterTool = (
  name: string,
  config: unknown,
  callback: ToolCallback
) => unknown;

const TOOL_ERROR_CODE =
  /^(VALIDATION_ERROR|UNAUTHENTICATED|FORBIDDEN|NOT_FOUND|RATE_LIMITED|CONFLICT|UPSTREAM_TIMEOUT|UPSTREAM_UNAVAILABLE|INTERNAL_ERROR):/u;

function toolErrorCode(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("isError" in result)) {
    return undefined;
  }
  if ((result as { isError?: unknown }).isError !== true) return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "INTERNAL_ERROR";
  const text = content.find(
    (item): item is { text: string } =>
      item !== null &&
      typeof item === "object" &&
      "text" in item &&
      typeof item.text === "string"
  )?.text;
  return text?.match(TOOL_ERROR_CODE)?.[1] ?? "INTERNAL_ERROR";
}

export function withToolAnalytics(
  toolName: string,
  callback: ToolCallback
): ToolCallback {
  return async (...args: unknown[]) => {
    const startedAt = Date.now();
    const analytics = currentAnalytics();
    const principal = currentPrincipal();
    const capture = (outcome: "success" | "error", errorCode?: string) => {
      analytics?.capture(
        MCP_ANALYTICS_EVENTS.toolCalled,
        {
          request_id: currentRequestId(),
          tool_name: toolName,
          outcome,
          error_code: errorCode,
          duration_ms: Date.now() - startedAt,
          auth_method: principal?.authMethod,
          plan: principal?.plan,
        },
        principal?.id
      );
    };

    try {
      const result = await callback(...args);
      const errorCode = toolErrorCode(result);
      capture(errorCode ? "error" : "success", errorCode);
      return result;
    } catch (error) {
      capture(
        "error",
        error instanceof KnowwToolError ? error.code : "INTERNAL_ERROR"
      );
      throw error;
    }
  };
}

function instrumentToolRegistration(server: McpServer): void {
  const registerToolWithoutAnalytics = server.registerTool.bind(
    server
  ) as unknown as RegisterTool;
  server.registerTool = ((
    name: string,
    config: unknown,
    callback: ToolCallback
  ) =>
    registerToolWithoutAnalytics(
      name,
      config,
      withToolAnalytics(name, callback)
    )) as typeof server.registerTool;
}

export function createKnowwMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
  instrumentToolRegistration(server);
  registerSearchMarketsTool(server);
  registerGetMarketTool(server);
  registerGetEventTool(server);
  registerGetOrderbookTool(server);
  registerGetPriceHistoryTool(server);
  registerPublicMarketTools(server);
  registerPublicWalletTools(server);
  return server;
}
