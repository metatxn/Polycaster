import {
  CLOB_API_BASE,
  fetchOrderbookByTokenId,
  type OrderbookLevel,
  type OrderbookSnapshot,
  UpstreamOrderbookError,
} from "@knoww/services";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import Decimal from "decimal.js";
import { z } from "zod";
import { MARKETS_READ_SCOPE } from "../auth/scopes";
import { currentRequestId } from "../context";
import {
  KnowwToolError,
  requireToolScope,
  toKnowwToolError,
  toolFailureContent,
} from "../errors/tool-error";
import { requireToolQuota } from "../quota";
import { isAbortLike } from "./gamma";
import { buildToolMeta, READ_ONLY_ANNOTATIONS, toolMetaSchema } from "./meta";

const DEFAULT_BOOK_DEPTH = 20;
const MAX_BOOK_DEPTH = 50;
const TOKEN_ID_PATTERN = /^[0-9]{1,80}$/;

/**
 * mcp.md asks for a staleness flag but names no threshold; 60 seconds is the
 * product choice here. The CLOB timestamp is a milliseconds epoch string.
 */
const STALE_SNAPSHOT_MS = 60_000;
const TIMESTAMP_PATTERN = /^[0-9]{1,15}$/;

const GET_ORDERBOOK_DESCRIPTION = [
  "Fetch the live CLOB order book for one outcome token id.",
  "Bids and asks come back best price first, capped at the requested depth.",
  "All prices, sizes, spread, midpoint, and per-side depth are decimal strings computed with decimal arithmetic.",
  "Snapshots older than 60 seconds, or without a usable timestamp, are marked stale.",
].join(" ");

/**
 * tokenId checks live in the handler, not the schema: the SDK reports zod
 * failures as bare "Input validation error" text, while the handler surfaces
 * a KnowwToolError with retry guidance (documented conflict #11).
 */
const getOrderbookInputSchema = z.object({
  tokenId: z
    .string()
    .max(100)
    .optional()
    .describe("CLOB token id: a decimal digit string."),
  depth: z
    .number()
    .int()
    .min(1)
    .max(MAX_BOOK_DEPTH)
    .default(DEFAULT_BOOK_DEPTH)
    .describe("Maximum price levels per side, 1 to 50."),
});

type GetOrderbookInput = z.output<typeof getOrderbookInputSchema>;

const orderbookLevelSchema = z.object({
  price: z.string().describe("Decimal string price between 0 and 1."),
  size: z.string().describe("Decimal string share size."),
});

const orderbookSnapshotSchema = z.object({
  tokenId: z.string(),
  conditionId: z.string().optional(),
  timestamp: z
    .string()
    .optional()
    .describe("ISO 8601 snapshot time; omitted when upstream sends none."),
  stale: z
    .boolean()
    .describe("True when the snapshot is over 60 seconds old or undated."),
  bids: z
    .array(orderbookLevelSchema)
    .describe("Sorted best first: highest price at index 0."),
  asks: z
    .array(orderbookLevelSchema)
    .describe("Sorted best first: lowest price at index 0."),
  bestBid: z.string().optional(),
  bestAsk: z.string().optional(),
  spread: z.string().optional(),
  midpoint: z.string().optional(),
  bidDepth: z.string().describe("Sum of the returned bid sizes."),
  askDepth: z.string().describe("Sum of the returned ask sizes."),
  minOrderSize: z.string().optional(),
  tickSize: z.string().optional(),
});

const getOrderbookOutputSchema = z.object({
  orderbook: orderbookSnapshotSchema,
  meta: toolMetaSchema,
});

type OrderbookResult = z.output<typeof orderbookSnapshotSchema>;

function resolveTokenId(args: GetOrderbookInput): string {
  const tokenId = args.tokenId?.trim();
  if (tokenId === undefined || !TOKEN_ID_PATTERN.test(tokenId)) {
    throw new KnowwToolError(
      "VALIDATION_ERROR",
      "tokenId must be a string of up to 80 decimal digits."
    );
  }
  return tokenId;
}

type ParsedLevel = { price: Decimal; size: Decimal };

function parseLevels(levels: OrderbookLevel[]): ParsedLevel[] {
  const parsed: ParsedLevel[] = [];
  for (const level of levels) {
    let price: Decimal;
    let size: Decimal;
    try {
      price = new Decimal(level.price);
      size = new Decimal(level.size);
    } catch {
      continue;
    }
    if (!price.isFinite() || !size.isFinite()) continue;
    parsed.push({ price, size });
  }
  return parsed;
}

type BookSide = {
  levels: { price: string; size: string }[];
  depthTotal: string;
  best?: Decimal;
  truncated: boolean;
};

/**
 * Upstream level order is untrusted (probed 2026-08: both sides arrive
 * worst-to-best), so each side re-sorts best first before the depth cap.
 */
function buildSide(
  raw: OrderbookLevel[],
  depth: number,
  side: "bids" | "asks"
): BookSide {
  const parsed = parseLevels(raw);
  parsed.sort((a, b) =>
    side === "bids" ? b.price.comparedTo(a.price) : a.price.comparedTo(b.price)
  );
  const truncated = parsed.length > depth;
  const kept = parsed.slice(0, depth);
  let depthTotal = new Decimal(0);
  for (const level of kept) {
    depthTotal = depthTotal.plus(level.size);
  }
  return {
    levels: kept.map((level) => ({
      price: level.price.toString(),
      size: level.size.toString(),
    })),
    depthTotal: depthTotal.toString(),
    ...(kept.length > 0 ? { best: kept[0].price } : {}),
    truncated,
  };
}

type SnapshotClock = { iso?: string; stale: boolean };

function readSnapshotClock(timestamp: string | undefined): SnapshotClock {
  if (timestamp === undefined || !TIMESTAMP_PATTERN.test(timestamp)) {
    return { stale: true };
  }
  const ms = Number(timestamp);
  if (!Number.isSafeInteger(ms)) {
    return { stale: true };
  }
  return {
    iso: new Date(ms).toISOString(),
    stale: Date.now() - ms > STALE_SNAPSHOT_MS,
  };
}

function mapBookError(error: unknown): KnowwToolError {
  if (error instanceof KnowwToolError) return error;
  if (error instanceof UpstreamOrderbookError) {
    return error.status === 429
      ? new KnowwToolError(
          "RATE_LIMITED",
          "The order book source is rate limiting requests."
        )
      : new KnowwToolError(
          "UPSTREAM_UNAVAILABLE",
          "Order book data is temporarily unavailable upstream."
        );
  }
  if (isAbortLike(error)) {
    return new KnowwToolError(
      "UPSTREAM_TIMEOUT",
      "The order book source timed out."
    );
  }
  return toKnowwToolError(error);
}

function summaryText(orderbook: OrderbookResult): string {
  const parts: string[] = [];
  if (orderbook.bestBid !== undefined && orderbook.bestAsk !== undefined) {
    parts.push(
      `Best bid ${orderbook.bestBid}, best ask ${orderbook.bestAsk}, spread ${orderbook.spread}.`
    );
  } else if (orderbook.bestBid !== undefined) {
    parts.push(`Best bid ${orderbook.bestBid}, no asks.`);
  } else if (orderbook.bestAsk !== undefined) {
    parts.push(`No bids, best ask ${orderbook.bestAsk}.`);
  } else {
    parts.push("The order book is empty.");
  }
  if (orderbook.stale) {
    parts.push("The snapshot is stale.");
  }
  return parts.join(" ");
}

function buildOrderbookResult(
  snapshot: OrderbookSnapshot,
  tokenId: string,
  depth: number
): { orderbook: OrderbookResult; truncated: boolean; clock: SnapshotClock } {
  const bids = buildSide(snapshot.bids, depth, "bids");
  const asks = buildSide(snapshot.asks, depth, "asks");
  const clock = readSnapshotClock(snapshot.timestamp);
  const bestBid = bids.best;
  const bestAsk = asks.best;
  const spread =
    bestBid !== undefined && bestAsk !== undefined
      ? bestAsk.minus(bestBid).toString()
      : undefined;
  const midpoint =
    bestBid !== undefined && bestAsk !== undefined
      ? bestBid.plus(bestAsk).div(2).toString()
      : undefined;

  const orderbook: OrderbookResult = {
    tokenId: snapshot.assetId ?? tokenId,
    ...(snapshot.market !== undefined ? { conditionId: snapshot.market } : {}),
    ...(clock.iso !== undefined ? { timestamp: clock.iso } : {}),
    stale: clock.stale,
    bids: bids.levels,
    asks: asks.levels,
    ...(bestBid !== undefined ? { bestBid: bestBid.toString() } : {}),
    ...(bestAsk !== undefined ? { bestAsk: bestAsk.toString() } : {}),
    ...(spread !== undefined ? { spread } : {}),
    ...(midpoint !== undefined ? { midpoint } : {}),
    bidDepth: bids.depthTotal,
    askDepth: asks.depthTotal,
    ...(snapshot.minOrderSize !== undefined
      ? { minOrderSize: snapshot.minOrderSize }
      : {}),
    ...(snapshot.tickSize !== undefined ? { tickSize: snapshot.tickSize } : {}),
  };
  return { orderbook, truncated: bids.truncated || asks.truncated, clock };
}

async function handleGetOrderbook(
  args: GetOrderbookInput,
  context: ServerContext
) {
  try {
    requireToolScope(MARKETS_READ_SCOPE);
    await requireToolQuota("get_orderbook");
    const tokenId = resolveTokenId(args);
    let snapshot: OrderbookSnapshot | null;
    try {
      snapshot = await fetchOrderbookByTokenId(tokenId, {
        signal: context.mcpReq.signal,
      });
    } catch (error) {
      throw mapBookError(error);
    }
    if (snapshot === null) {
      throw new KnowwToolError(
        "NOT_FOUND",
        "No order book exists for that token id."
      );
    }
    const { orderbook, truncated, clock } = buildOrderbookResult(
      snapshot,
      tokenId,
      args.depth
    );
    const meta = buildToolMeta({
      requestId: currentRequestId(),
      sources: [{ name: "polymarket-clob", url: CLOB_API_BASE }],
      ...(clock.iso !== undefined ? { asOf: clock.iso } : {}),
      ...(truncated ? { truncated: true } : {}),
    });
    return {
      content: [{ type: "text" as const, text: summaryText(orderbook) }],
      structuredContent: { orderbook, meta },
    };
  } catch (error) {
    return toolFailureContent("get_orderbook", toKnowwToolError(error));
  }
}

export function registerGetOrderbookTool(server: McpServer): void {
  server.registerTool(
    "get_orderbook",
    {
      title: "Get order book",
      description: GET_ORDERBOOK_DESCRIPTION,
      inputSchema: getOrderbookInputSchema,
      outputSchema: getOrderbookOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handleGetOrderbook
  );
}
