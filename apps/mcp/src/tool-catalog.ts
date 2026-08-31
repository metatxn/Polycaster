export const KNOWW_MCP_TOOL_NAMES = [
  "search_markets",
  "get_market",
  "get_event",
  "get_orderbook",
  "get_price_history",
  "list_events",
  "get_market_trades",
  "get_market_quotes",
  "get_market_holders",
  "get_open_interest",
  "get_event_live_volume",
  "get_trader_leaderboard",
  "list_tags",
  "list_sports_markets",
  "get_public_profile",
  "get_wallet_positions",
  "get_wallet_activity",
  "get_closed_positions",
  "get_wallet_pnl",
  "get_wallet_portfolio_value",
] as const;

const toolNameSet = new Set<string>(KNOWW_MCP_TOOL_NAMES);

export function knownMcpToolName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return toolNameSet.has(value) ? value : "other";
}
