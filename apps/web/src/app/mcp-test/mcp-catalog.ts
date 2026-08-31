export interface ToolParameter {
  description: string;
  name: string;
  required?: boolean;
  type: string;
}

export interface ToolDocument {
  description: string;
  example: Record<string, unknown>;
  name: string;
  parameters: ToolParameter[];
  summary: string;
}

const PUBLIC_WALLET_EXAMPLE = "0x0000000000000000000000000000000000000000";
const walletParameter: ToolParameter = {
  name: "walletAddress",
  type: "string",
  required: true,
  description:
    "Public Polymarket proxy wallet address. Google sign-in does not supply it.",
};

export const TOOL_CATALOG: ToolDocument[] = [
  {
    name: "search_markets",
    summary: "Search active prediction markets",
    description:
      "Returns matching events, nested market summaries, outcome prices, counts, and truncation metadata.",
    example: { query: "bitcoin", limit: 3 },
    parameters: [
      {
        name: "query",
        type: "string",
        required: true,
        description: "Search text, trimmed to 1 to 200 characters.",
      },
      {
        name: "status",
        type: '"active"',
        description: "Optional. Defaults to active.",
      },
      {
        name: "category",
        type: "string",
        description: "Optional category, up to 100 characters.",
      },
      {
        name: "limit",
        type: "integer",
        description: "Optional result limit from 1 to 20. Defaults to 10.",
      },
    ],
  },
  {
    name: "get_market",
    summary: "Read one market",
    description:
      "Looks up a market by slug, condition ID, or outcome token ID. Supply exactly one identifier.",
    example: {},
    parameters: [
      {
        name: "slug",
        type: "string",
        description: "Lowercase letters, digits, and dashes.",
      },
      {
        name: "conditionId",
        type: "string",
        description: "0x followed by 64 hexadecimal characters.",
      },
      {
        name: "tokenId",
        type: "string",
        description: "1 to 80 decimal digits.",
      },
    ],
  },
  {
    name: "get_event",
    summary: "Read one event and its markets",
    description:
      "Looks up an event by numeric ID or slug, then returns a bounded page of its markets.",
    example: { marketLimit: 5 },
    parameters: [
      {
        name: "id",
        type: "string",
        description: "Event ID with 1 to 20 decimal digits.",
      },
      {
        name: "slug",
        type: "string",
        description: "Lowercase letters, digits, and dashes.",
      },
      {
        name: "marketOffset",
        type: "integer",
        description: "Optional offset from 0 to 10,000. Defaults to 0.",
      },
      {
        name: "marketLimit",
        type: "integer",
        description: "Optional page size from 1 to 50. Defaults to 20.",
      },
    ],
  },
  {
    name: "get_orderbook",
    summary: "Read a live CLOB order book",
    description:
      "Returns sorted bids and asks, spread, midpoint, depth totals, and snapshot freshness for one outcome token.",
    example: { depth: 20 },
    parameters: [
      {
        name: "tokenId",
        type: "string",
        required: true,
        description: "Outcome token ID with 1 to 80 decimal digits.",
      },
      {
        name: "depth",
        type: "integer",
        description: "Optional levels per side from 1 to 50. Defaults to 20.",
      },
    ],
  },
  {
    name: "get_price_history",
    summary: "Read outcome-token price history",
    description:
      "Returns ascending CLOB price samples for a window of up to 31 days, with explicit downsampling metadata.",
    example: { fidelityMinutes: 60 },
    parameters: [
      {
        name: "tokenId",
        type: "string",
        required: true,
        description: "Outcome token ID with 1 to 80 decimal digits.",
      },
      {
        name: "startTime",
        type: "ISO 8601",
        description: "Optional start. Defaults to 24 hours before endTime.",
      },
      {
        name: "endTime",
        type: "ISO 8601",
        description: "Optional end. Defaults to the current time.",
      },
      {
        name: "fidelityMinutes",
        type: "integer",
        description: "Optional interval from 1 to 1,440. Defaults to 60.",
      },
    ],
  },
  {
    name: "list_events",
    summary: "List events with keyset pagination",
    description:
      "Returns bounded event records, tags, nested market summaries, and a next cursor.",
    example: { limit: 20, closed: false },
    parameters: [
      {
        name: "limit",
        type: "integer",
        description: "1 to 100. Defaults to 20.",
      },
      {
        name: "cursor",
        type: "string",
        description: "Optional keyset cursor from meta.nextCursor.",
      },
      {
        name: "closed",
        type: "boolean",
        description: "Optional closed-state filter.",
      },
      {
        name: "live",
        type: "boolean",
        description: "Optional live-event filter.",
      },
      { name: "tagSlug", type: "string", description: "Optional tag slug." },
      {
        name: "seriesIds",
        type: "integer[]",
        description: "Optional series identifiers.",
      },
      {
        name: "startDateMin / startDateMax",
        type: "ISO 8601",
        description: "Optional start-date bounds.",
      },
      {
        name: "endDateMin / endDateMax",
        type: "ISO 8601",
        description: "Optional end-date bounds.",
      },
      {
        name: "order",
        type: "enum",
        description: "volume, liquidity, startDate, endDate, or volume24hr.",
      },
      {
        name: "ascending",
        type: "boolean",
        description: "Sort direction. Defaults to false.",
      },
    ],
  },
  {
    name: "get_market_trades",
    summary: "Read public market trades",
    description:
      "Returns bounded public trades for condition IDs or event IDs. Supply exactly one identifier group.",
    example: {},
    parameters: [
      {
        name: "conditionIds",
        type: "string[]",
        description: "1 to 20 condition IDs; mutually exclusive with eventIds.",
      },
      {
        name: "eventIds",
        type: "integer[]",
        description: "1 to 20 event IDs; mutually exclusive with conditionIds.",
      },
      {
        name: "walletAddress",
        type: "string",
        description: "Optional public wallet filter.",
      },
      {
        name: "side",
        type: '"BUY" | "SELL"',
        description: "Optional trade side.",
      },
      {
        name: "startTimestamp / endTimestamp",
        type: "epoch seconds",
        description: "Optional time bounds.",
      },
      {
        name: "limit",
        type: "integer",
        description: "1 to 100. Defaults to 50.",
      },
      { name: "offset", type: "integer", description: "0 to 10,000." },
    ],
  },
  {
    name: "get_market_quotes",
    summary: "Read combined market quotes",
    description:
      "Combines BUY/SELL prices, midpoint, spread, and last trade for CLOB outcome tokens.",
    example: {},
    parameters: [
      {
        name: "tokenIds",
        type: "string[]",
        required: true,
        description: "1 to 20 CLOB outcome token IDs.",
      },
    ],
  },
  {
    name: "get_market_holders",
    summary: "Read top market holders",
    description:
      "Returns the largest public holders for each requested market.",
    example: {},
    parameters: [
      {
        name: "conditionIds",
        type: "string[]",
        required: true,
        description: "1 to 20 market condition IDs.",
      },
      {
        name: "limit",
        type: "integer",
        description: "1 to 20 holders per market.",
      },
      {
        name: "minBalance",
        type: "integer",
        description: "Minimum token balance from 0 to 999,999.",
      },
    ],
  },
  {
    name: "get_open_interest",
    summary: "Read market open interest",
    description: "Returns open-interest values as decimal strings.",
    example: {},
    parameters: [
      {
        name: "conditionIds",
        type: "string[]",
        required: true,
        description: "1 to 20 market condition IDs.",
      },
    ],
  },
  {
    name: "get_event_live_volume",
    summary: "Read event live volume",
    description: "Returns total and per-market live volume for one event.",
    example: {},
    parameters: [
      {
        name: "eventId",
        type: "positive integer",
        required: true,
        description: "Numeric Polymarket event ID.",
      },
    ],
  },
  {
    name: "get_trader_leaderboard",
    summary: "Read trader rankings",
    description: "Returns public trader rank, wallet, volume, and PnL.",
    example: {
      category: "OVERALL",
      timePeriod: "ALL",
      orderBy: "PNL",
      limit: 25,
    },
    parameters: [
      {
        name: "category",
        type: "enum",
        description: "Overall or a documented market category.",
      },
      {
        name: "timePeriod",
        type: '"DAY" | "WEEK" | "MONTH" | "ALL"',
        description: "Ranking window.",
      },
      {
        name: "orderBy",
        type: '"PNL" | "VOL"',
        description: "Ranking metric.",
      },
      { name: "limit", type: "integer", description: "1 to 50." },
      { name: "offset", type: "integer", description: "0 to 1,000." },
      {
        name: "walletAddress / userName",
        type: "string",
        description: "Optional trader filters.",
      },
    ],
  },
  {
    name: "list_tags",
    summary: "List category tags",
    description: "Returns tags usable for event and market filtering.",
    example: { limit: 50, offset: 0 },
    parameters: [
      { name: "limit", type: "integer", description: "1 to 100." },
      { name: "offset", type: "integer", description: "0 to 10,000." },
    ],
  },
  {
    name: "list_sports_markets",
    summary: "List sports metadata and markets",
    description:
      "Returns sports metadata and market types, plus teams and markets when a sport or league tag is supplied.",
    example: { sport: "football", limit: 20 },
    parameters: [
      { name: "sport", type: "slug", description: "Optional sport tag." },
      {
        name: "league",
        type: "slug",
        description: "Optional league tag; also loads teams.",
      },
      { name: "limit", type: "integer", description: "1 to 100." },
      {
        name: "offset",
        type: "integer",
        description: "Team offset from 0 to 10,000.",
      },
      {
        name: "cursor",
        type: "string",
        description: "Optional market keyset cursor.",
      },
    ],
  },
  {
    name: "get_public_profile",
    summary: "Read a public trader profile",
    description:
      "Returns a public Polymarket profile for a proxy wallet address.",
    example: { walletAddress: PUBLIC_WALLET_EXAMPLE },
    parameters: [walletParameter],
  },
  {
    name: "get_wallet_positions",
    summary: "Read current wallet positions",
    description:
      "Returns bounded public positions and their decimal-string values and PnL.",
    example: { walletAddress: PUBLIC_WALLET_EXAMPLE, limit: 50 },
    parameters: [
      walletParameter,
      {
        name: "conditionIds / eventIds",
        type: "array",
        description: "Optional mutually exclusive market filters.",
      },
      {
        name: "sizeThreshold",
        type: "decimal string",
        description: "Defaults to 0.1.",
      },
      {
        name: "redeemable / mergeable",
        type: "boolean",
        description: "Optional state filters.",
      },
      {
        name: "title",
        type: "string",
        description: "Optional title filter, up to 100 characters.",
      },
      { name: "limit", type: "integer", description: "1 to 100." },
      { name: "offset", type: "integer", description: "0 to 10,000." },
      {
        name: "sortBy / sortDirection",
        type: "enum",
        description: "Optional documented sort controls.",
      },
    ],
  },
  {
    name: "get_wallet_activity",
    summary: "Read public wallet activity",
    description:
      "Returns bounded trades, splits, merges, rewards, deposits, withdrawals, and other public activity.",
    example: {
      walletAddress: PUBLIC_WALLET_EXAMPLE,
      types: ["TRADE"],
      limit: 50,
    },
    parameters: [
      walletParameter,
      {
        name: "conditionIds / eventIds",
        type: "array",
        description: "Optional mutually exclusive market filters.",
      },
      {
        name: "types",
        type: "enum[]",
        description: "Optional activity-type filters.",
      },
      {
        name: "startTimestamp / endTimestamp",
        type: "epoch seconds",
        description: "Optional time bounds.",
      },
      { name: "limit", type: "integer", description: "1 to 100." },
      { name: "offset", type: "integer", description: "0 to 5,000." },
      {
        name: "sortDirection",
        type: '"ASC" | "DESC"',
        description: "Defaults to DESC.",
      },
    ],
  },
  {
    name: "get_closed_positions",
    summary: "Read closed wallet positions",
    description:
      "Returns closed positions and realized PnL for a public wallet.",
    example: { walletAddress: PUBLIC_WALLET_EXAMPLE, limit: 25 },
    parameters: [
      walletParameter,
      {
        name: "conditionIds / eventIds",
        type: "array",
        description: "Optional mutually exclusive market filters.",
      },
      { name: "limit", type: "integer", description: "1 to 50." },
      { name: "offset", type: "integer", description: "0 to 100,000." },
      {
        name: "sortBy / sortDirection",
        type: "enum",
        description: "Optional documented sort controls.",
      },
    ],
  },
  {
    name: "get_wallet_pnl",
    summary: "Calculate wallet PnL",
    description:
      "Aggregates validated position values using Decimal.js and returns a decimal-string summary.",
    example: { walletAddress: PUBLIC_WALLET_EXAMPLE },
    parameters: [walletParameter],
  },
  {
    name: "get_wallet_portfolio_value",
    summary: "Read wallet portfolio value",
    description:
      "Returns the current total value of a public wallet's positions.",
    example: { walletAddress: PUBLIC_WALLET_EXAMPLE },
    parameters: [walletParameter],
  },
];

export function exampleArguments(toolName: string): string {
  const tool = TOOL_CATALOG.find((item) => item.name === toolName);
  return JSON.stringify(tool?.example ?? {}, null, 2);
}
