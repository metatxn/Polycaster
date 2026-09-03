import Decimal from "decimal.js";
import { z } from "zod";
import type { TimeRange } from "@/components/market-price-chart";
import { normalizeLimitPrice } from "@/lib/slippage";
import type { WebMcpTool } from "@/lib/webmcp";
import type { PreparedTradeTicket } from "@/types/market";

export interface EventWebMcpOutcome {
  index: number;
  name: string;
  price: number;
  probability: number;
}

export interface EventWebMcpMarket {
  id: string;
  question: string;
  label: string;
  status: "open" | "closed";
  outcomes: EventWebMcpOutcome[];
}

export interface EventWebMcpOrderBookLevel {
  price: string;
  size: string;
}

export const EVENT_WEB_MCP_MAX_DEPTH = 10;

export interface EventWebMcpSnapshot {
  event: {
    id: string;
    slug: string;
    title: string;
    status: "open" | "closed";
    endDate?: string;
    volume?: string;
    liquidity?: string;
  };
  markets: EventWebMcpMarket[];
  selected: {
    marketId: string;
    marketLabel: string;
    outcomeIndex: number;
    outcomeName: string;
    outcomePrice: number;
  };
  chartRange: TimeRange;
  orderBook: {
    bestBid?: number;
    bestAsk?: number;
    spread?: number;
    tickSize: number;
    minOrderSize: number;
    isLive: boolean;
    bids: EventWebMcpOrderBookLevel[];
    asks: EventWebMcpOrderBookLevel[];
  };
  observedAt: string;
}

interface EventWebMcpDependencies {
  getSnapshot: () => EventWebMcpSnapshot | null;
  selectMarket: (marketId: string, outcomeIndex: number) => void;
  setChartRange: (range: TimeRange) => void;
  prepareTrade: (draft: PreparedTradeTicket) => void;
}

const chartRanges = [
  "30M",
  "1H",
  "2H",
  "3H",
  "6H",
  "1D",
  "1W",
  "1M",
  "ALL",
] as const;

const emptyInputSchema = z.object({}).strict();
const selectMarketInputSchema = z
  .object({
    market_id: z.string().min(1).max(256),
    outcome_index: z.number().int().min(0).max(1),
  })
  .strict();
const chartRangeInputSchema = z.object({ range: z.enum(chartRanges) }).strict();
const marketSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(100),
    status: z.enum(["open", "closed", "all"]).default("open"),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();
const compareMarketsInputSchema = z
  .object({
    market_ids: z.array(z.string().min(1).max(256)).min(2).max(5),
    outcome_index: z.number().int().min(0).max(1).default(0),
  })
  .strict();
const orderBookDepthInputSchema = z
  .object({
    levels: z.number().int().min(1).max(EVENT_WEB_MCP_MAX_DEPTH).default(5),
  })
  .strict();
const prepareTradeInputSchema = z
  .object({
    side: z.enum(["BUY", "SELL"]),
    order_type: z.enum(["MARKET", "LIMIT"]),
    amount_usd: z.number().finite().positive().max(1_000_000).optional(),
    shares: z.number().finite().positive().max(1_000_000).optional(),
    limit_price: z.number().finite().gt(0).lt(1).optional(),
    allow_partial_fill: z.boolean().optional(),
  })
  .strict();

function requireSnapshot(
  getSnapshot: EventWebMcpDependencies["getSnapshot"]
): EventWebMcpSnapshot {
  const snapshot = getSnapshot();
  if (!snapshot) {
    throw new Error("Event context is not ready");
  }
  return snapshot;
}

function invalidInput(message: string): never {
  throw new Error(message);
}

function toRoundedNumber(value: Decimal, decimalPlaces = 5): number {
  return value.toDecimalPlaces(decimalPlaces).toNumber();
}

function getMarketSearchText(market: EventWebMcpMarket): string {
  return [
    market.id,
    market.question,
    market.label,
    ...market.outcomes.map((outcome) => outcome.name),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function getEventContext(snapshot: EventWebMcpSnapshot) {
  const { bestBid, bestAsk, spread, tickSize, minOrderSize, isLive } =
    snapshot.orderBook;

  return {
    ...snapshot,
    orderBook: {
      ...(bestBid !== undefined ? { bestBid } : {}),
      ...(bestAsk !== undefined ? { bestAsk } : {}),
      ...(spread !== undefined ? { spread } : {}),
      tickSize,
      minOrderSize,
      isLive,
    },
  };
}

function validateTradeShape(
  input: z.infer<typeof prepareTradeInputSchema>
): void {
  if (input.order_type === "MARKET" && input.limit_price !== undefined) {
    invalidInput("MARKET does not accept limit_price");
  }
  if (input.order_type === "LIMIT" && input.limit_price === undefined) {
    invalidInput("LIMIT requires limit_price");
  }
  if (input.order_type === "LIMIT" && input.shares === undefined) {
    invalidInput("LIMIT requires shares");
  }
  if (input.order_type === "LIMIT" && input.amount_usd !== undefined) {
    invalidInput("LIMIT does not accept amount_usd");
  }
  if (input.order_type === "LIMIT" && input.allow_partial_fill !== undefined) {
    invalidInput("LIMIT does not accept allow_partial_fill");
  }
  if (
    input.order_type === "MARKET" &&
    input.side === "BUY" &&
    (input.amount_usd === undefined || input.shares !== undefined)
  ) {
    invalidInput("MARKET BUY requires amount_usd and does not accept shares");
  }
  if (
    input.order_type === "MARKET" &&
    input.side === "SELL" &&
    (input.shares === undefined || input.amount_usd !== undefined)
  ) {
    invalidInput("MARKET SELL requires shares and does not accept amount_usd");
  }
}

export function createEventWebMcpTools({
  getSnapshot,
  selectMarket,
  setChartRange,
  prepareTrade,
}: EventWebMcpDependencies): WebMcpTool[] {
  let tradeRevision = 0;

  return [
    {
      name: "get_current_event_context",
      description:
        "Read the event, visible markets, current selection, chart range, and current order-book summary shown on this Knoww page.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        if (!emptyInputSchema.safeParse(rawInput).success) {
          invalidInput("Invalid event-context input");
        }
        return getEventContext(requireSnapshot(getSnapshot));
      },
    },
    {
      name: "find_markets_on_page",
      description:
        "Search the markets already loaded on this Knoww event page. This reads public page data only and does not change the page or place a trade.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 100 },
          status: {
            type: "string",
            enum: ["open", "closed", "all"],
            default: "open",
          },
          limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const parsed = marketSearchInputSchema.safeParse(rawInput);
        if (!parsed.success) invalidInput("Invalid market search");

        const snapshot = requireSnapshot(getSnapshot);
        const normalizedQuery = parsed.data.query.toLocaleLowerCase();
        const matches = snapshot.markets.filter(
          (market) =>
            (parsed.data.status === "all" ||
              market.status === parsed.data.status) &&
            getMarketSearchText(market).includes(normalizedQuery)
        );

        return {
          query: parsed.data.query,
          status: parsed.data.status,
          total_matches: matches.length,
          markets: matches.slice(0, parsed.data.limit).map((market) => ({
            market_id: market.id,
            market: market.label,
            question: market.question,
            status: market.status,
            outcomes: market.outcomes,
          })),
          observed_at: snapshot.observedAt,
        };
      },
    },
    {
      name: "compare_markets",
      description:
        "Compare the same Yes/No outcome across two to five markets already loaded on this Knoww event page. This reads public page data only.",
      inputSchema: {
        type: "object",
        properties: {
          market_ids: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 256 },
            minItems: 2,
            maxItems: 5,
          },
          outcome_index: {
            type: "integer",
            minimum: 0,
            maximum: 1,
            default: 0,
          },
        },
        required: ["market_ids"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const parsed = compareMarketsInputSchema.safeParse(rawInput);
        if (!parsed.success) invalidInput("Invalid market comparison");
        if (
          new Set(parsed.data.market_ids).size !== parsed.data.market_ids.length
        ) {
          invalidInput("Market IDs must be unique");
        }

        const snapshot = requireSnapshot(getSnapshot);
        const comparisons = parsed.data.market_ids.map((marketId) => {
          const market = snapshot.markets.find(
            (candidate) => candidate.id === marketId
          );
          if (!market) {
            invalidInput("One or more markets are not available on this page");
          }
          const outcome = market.outcomes.find(
            (candidate) => candidate.index === parsed.data.outcome_index
          );
          if (!outcome) {
            invalidInput("An outcome is not available for one or more markets");
          }

          return {
            market_id: market.id,
            market: market.label,
            status: market.status,
            outcome: outcome.name,
            price: outcome.price,
            probability: outcome.probability,
          };
        });
        const highest = comparisons.reduce((current, candidate) =>
          new Decimal(candidate.probability).greaterThan(current.probability)
            ? candidate
            : current
        );
        const lowest = comparisons.reduce((current, candidate) =>
          new Decimal(candidate.probability).lessThan(current.probability)
            ? candidate
            : current
        );

        return {
          outcome_index: parsed.data.outcome_index,
          markets: comparisons,
          highest_probability: {
            market_id: highest.market_id,
            probability: highest.probability,
          },
          lowest_probability: {
            market_id: lowest.market_id,
            probability: lowest.probability,
          },
          probability_range: new Decimal(highest.probability)
            .minus(lowest.probability)
            .toNumber(),
          observed_at: snapshot.observedAt,
        };
      },
    },
    {
      name: "get_selected_order_book",
      description:
        "Read a bounded number of bid and ask levels for the market outcome currently selected on this Knoww event page. This does not change the page or place a trade.",
      inputSchema: {
        type: "object",
        properties: {
          levels: {
            type: "integer",
            minimum: 1,
            maximum: EVENT_WEB_MCP_MAX_DEPTH,
            default: 5,
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const parsed = orderBookDepthInputSchema.safeParse(rawInput);
        if (!parsed.success) invalidInput("Invalid order-book depth");

        const snapshot = requireSnapshot(getSnapshot);
        return {
          market_id: snapshot.selected.marketId,
          market: snapshot.selected.marketLabel,
          outcome_index: snapshot.selected.outcomeIndex,
          outcome: snapshot.selected.outcomeName,
          levels_requested: parsed.data.levels,
          bids: snapshot.orderBook.bids.slice(0, parsed.data.levels),
          asks: snapshot.orderBook.asks.slice(0, parsed.data.levels),
          best_bid: snapshot.orderBook.bestBid,
          best_ask: snapshot.orderBook.bestAsk,
          spread: snapshot.orderBook.spread,
          tick_size: snapshot.orderBook.tickSize,
          minimum_order_size: snapshot.orderBook.minOrderSize,
          is_live: snapshot.orderBook.isLive,
          observed_at: snapshot.observedAt,
        };
      },
    },
    {
      name: "select_market_view",
      description:
        "Change the market and outcome visible on this page. This only changes the page view and does not create or submit a trade.",
      inputSchema: {
        type: "object",
        properties: {
          market_id: { type: "string", minLength: 1, maxLength: 256 },
          outcome_index: { type: "integer", minimum: 0, maximum: 1 },
        },
        required: ["market_id", "outcome_index"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (rawInput) => {
        const parsed = selectMarketInputSchema.safeParse(rawInput);
        if (!parsed.success) invalidInput("Invalid market selection");

        const snapshot = requireSnapshot(getSnapshot);
        const market = snapshot.markets.find(
          (candidate) => candidate.id === parsed.data.market_id
        );
        if (!market) invalidInput("Market is not available on this page");
        if (market.status !== "open") {
          invalidInput("Market is not available for selection");
        }
        const outcome = market.outcomes.find(
          (candidate) => candidate.index === parsed.data.outcome_index
        );
        if (!outcome) invalidInput("Outcome is not available for this market");

        selectMarket(market.id, outcome.index);
        return {
          changed: true,
          market_id: market.id,
          market: market.label,
          outcome_index: outcome.index,
          outcome_name: outcome.name,
          executed: false,
        };
      },
    },
    {
      name: "set_chart_range",
      description:
        "Change the price-chart time range on this page. This only changes the visible chart.",
      inputSchema: {
        type: "object",
        properties: { range: { type: "string", enum: chartRanges } },
        required: ["range"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (rawInput) => {
        const parsed = chartRangeInputSchema.safeParse(rawInput);
        if (!parsed.success) invalidInput("Invalid chart range");

        setChartRange(parsed.data.range);
        return { chart_range: parsed.data.range, changed: true };
      },
    },
    {
      name: "prepare_trade",
      description:
        "Prefill the trade ticket for the market and outcome currently selected on this page. This never places, signs, approves, or submits an order. The user must review the ticket and click the trading button themselves.",
      inputSchema: {
        type: "object",
        properties: {
          side: { type: "string", enum: ["BUY", "SELL"] },
          order_type: { type: "string", enum: ["MARKET", "LIMIT"] },
          amount_usd: {
            type: "number",
            exclusiveMinimum: 0,
            maximum: 1_000_000,
            description: "Required only for a MARKET BUY.",
          },
          shares: {
            type: "number",
            exclusiveMinimum: 0,
            maximum: 1_000_000,
            description: "Required for a MARKET SELL or any LIMIT order.",
          },
          limit_price: {
            type: "number",
            exclusiveMinimum: 0,
            exclusiveMaximum: 1,
            description: "Required only for a LIMIT order, in USD per share.",
          },
          allow_partial_fill: {
            type: "boolean",
            description: "Optional for MARKET orders. Defaults to true.",
          },
        },
        required: ["side", "order_type"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (rawInput) => {
        const parsed = prepareTradeInputSchema.safeParse(rawInput);
        if (!parsed.success) invalidInput("Invalid trade-ticket input");
        validateTradeShape(parsed.data);

        const snapshot = requireSnapshot(getSnapshot);
        if (snapshot.event.status !== "open") {
          invalidInput("Trading is unavailable because this event is closed");
        }
        const market = snapshot.markets.find(
          (candidate) => candidate.id === snapshot.selected.marketId
        );
        if (market?.status !== "open") {
          invalidInput("The selected market is unavailable for trading");
        }
        const outcome = market.outcomes.find(
          (candidate) => candidate.index === snapshot.selected.outcomeIndex
        );
        if (!outcome) invalidInput("The selected outcome is unavailable");

        const normalizedLimitPrice =
          parsed.data.limit_price === undefined
            ? undefined
            : normalizeLimitPrice(
                parsed.data.limit_price,
                snapshot.orderBook.tickSize
              );
        const referencePrice = new Decimal(
          parsed.data.order_type === "LIMIT"
            ? (normalizedLimitPrice as number)
            : parsed.data.side === "BUY"
              ? (snapshot.orderBook.bestAsk ?? outcome.price)
              : (snapshot.orderBook.bestBid ?? outcome.price)
        );
        if (
          !referencePrice.isFinite() ||
          referencePrice.lte(0) ||
          referencePrice.gte(1)
        ) {
          invalidInput("A valid reference price is unavailable");
        }
        const usesLiveQuote =
          parsed.data.order_type === "MARKET" &&
          (parsed.data.side === "BUY"
            ? snapshot.orderBook.bestAsk !== undefined
            : snapshot.orderBook.bestBid !== undefined);
        const estimatedShares =
          parsed.data.order_type === "MARKET" && parsed.data.side === "BUY"
            ? new Decimal(parsed.data.amount_usd as number).div(referencePrice)
            : new Decimal(parsed.data.shares as number);
        const estimatedTotal =
          parsed.data.order_type === "MARKET" && parsed.data.side === "BUY"
            ? new Decimal(parsed.data.amount_usd as number)
            : estimatedShares.mul(referencePrice);

        const draft: PreparedTradeTicket = {
          revision: ++tradeRevision,
          marketId: market.id,
          outcomeIndex: outcome.index,
          side: parsed.data.side,
          orderType: parsed.data.order_type,
          ...(parsed.data.amount_usd !== undefined
            ? { amountUsd: parsed.data.amount_usd }
            : {}),
          ...(parsed.data.shares !== undefined
            ? { shares: parsed.data.shares }
            : {}),
          ...(normalizedLimitPrice !== undefined
            ? { limitPrice: normalizedLimitPrice }
            : {}),
          ...(parsed.data.order_type === "MARKET"
            ? { allowPartialFill: parsed.data.allow_partial_fill ?? true }
            : {}),
        };
        prepareTrade(draft);

        const warnings = [
          "No order was placed. Review the ticket and submit it manually.",
          "Prices, liquidity, slippage, and fees can change before submission.",
        ];
        if (!usesLiveQuote) {
          warnings.push(
            "The estimate uses the displayed outcome price because a live bid or ask is unavailable."
          );
        }

        return {
          prepared: true,
          executed: false,
          market: market.label,
          outcome: outcome.name,
          side: draft.side,
          order_type: draft.orderType,
          estimate: {
            reference_price: referencePrice.toNumber(),
            estimated_shares: toRoundedNumber(estimatedShares),
            estimated_total_usd: toRoundedNumber(estimatedTotal),
            spread: snapshot.orderBook.spread,
            quote_source:
              parsed.data.order_type === "LIMIT"
                ? "limit_price"
                : usesLiveQuote
                  ? "live_order_book"
                  : "displayed_price",
          },
          warnings,
          next_step:
            "Review every field in the visible trade ticket, then use the page button if you choose to submit.",
        };
      },
    },
  ];
}
