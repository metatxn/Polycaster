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
    example: { slug: "fed-rate-cut-in-august-2026" },
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
    example: { slug: "clarity-act", marketLimit: 5 },
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
    example: { tokenId: "", depth: 20 },
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
    example: { tokenId: "", fidelityMinutes: 60 },
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
];

export function exampleArguments(toolName: string): string {
  const tool = TOOL_CATALOG.find((item) => item.name === toolName);
  return JSON.stringify(tool?.example ?? {}, null, 2);
}
