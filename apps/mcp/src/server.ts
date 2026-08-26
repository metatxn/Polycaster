import { McpServer } from "@modelcontextprotocol/server";
import { registerGetEventTool } from "./tools/get-event";
import { registerGetMarketTool } from "./tools/get-market";
import { registerGetOrderbookTool } from "./tools/get-orderbook";
import { registerGetPriceHistoryTool } from "./tools/get-price-history";
import { registerSearchMarketsTool } from "./tools/search-markets";

export const SERVER_INFO = { name: "knoww-mcp", version: "0.1.0" } as const;

export function createKnowwMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
  registerSearchMarketsTool(server);
  registerGetMarketTool(server);
  registerGetEventTool(server);
  registerGetOrderbookTool(server);
  registerGetPriceHistoryTool(server);
  return server;
}
