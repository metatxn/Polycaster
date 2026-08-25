import {
  CLOB_API_BASE,
  fetchPriceHistoryByTokenId,
  type PriceHistoryPoint,
  UpstreamPriceHistoryError,
} from "@knoww/services";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import Decimal from "decimal.js";
import { z } from "zod";
import { currentRequestId } from "../context";
import {
  KnowwToolError,
  toKnowwToolError,
  toolFailureContent,
} from "../errors/tool-error";
import { isAbortLike } from "./gamma";
import { buildToolMeta, READ_ONLY_ANNOTATIONS, toolMetaSchema } from "./meta";

/**
 * Upstream /prices-history quirks this tool absorbs (probed 2026-08-25):
 * the query key is `market` but carries the token id, `t` is a seconds
 * epoch while /book uses a milliseconds string, and an unknown token
 * answers HTTP 200 with an empty history. An empty window is therefore a
 * success, never NOT_FOUND. The time range is validated here, so an
 * upstream 400 is unexpected and maps to UPSTREAM_UNAVAILABLE.
 */

const TOKEN_ID_PATTERN = /^[0-9]{1,80}$/;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_FIDELITY_MINUTES = 60;
/** At fidelity 1 a single week holds 10k+ samples; cap what we return. */
const MAX_POINTS = 1000;

const description = [
  "Fetches price history for one outcome token from the Polymarket CLOB.",
  "Points are upstream price samples derived from trade activity, returned",
  "in ascending time order with ISO 8601 timestamps and decimal-string",
  "prices in USDC (0 to 1). The window defaults to the last 24 hours, is",
  "capped at 31 days, and fidelityMinutes controls the sample spacing.",
  "Series longer than 1000 points are downsampled evenly with the",
  "endpoints kept. An empty result means no trades in the window or an",
  "unknown token; upstream does not distinguish the two.",
].join(" ");

const inputSchema = {
  tokenId: z.string().max(100).optional(),
  startTime: z.string().max(40).optional(),
  endTime: z.string().max(40).optional(),
  fidelityMinutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(DEFAULT_FIDELITY_MINUTES),
};

const outputSchema = {
  history: z.object({
    tokenId: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    fidelityMinutes: z.number(),
    points: z.array(z.object({ timestamp: z.string(), price: z.string() })),
    downsampled: z.boolean().optional(),
  }),
  meta: toolMetaSchema,
};

interface HistoryArgs {
  tokenId?: string;
  startTime?: string;
  endTime?: string;
  fidelityMinutes?: number;
}

function resolveTokenId(args: HistoryArgs): string {
  const tokenId = args.tokenId;
  if (typeof tokenId !== "string" || !TOKEN_ID_PATTERN.test(tokenId)) {
    throw new KnowwToolError(
      "VALIDATION_ERROR",
      "tokenId must be a string of up to 80 decimal digits."
    );
  }
  return tokenId;
}

function parseIsoMs(value: string, field: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new KnowwToolError(
      "VALIDATION_ERROR",
      `${field} must be an ISO 8601 timestamp.`
    );
  }
  return ms;
}

function resolveWindow(args: HistoryArgs): { startMs: number; endMs: number } {
  const endMs =
    args.endTime === undefined
      ? Date.now()
      : parseIsoMs(args.endTime, "endTime");
  const startMs =
    args.startTime === undefined
      ? endMs - DEFAULT_WINDOW_MS
      : parseIsoMs(args.startTime, "startTime");
  if (startMs >= endMs) {
    throw new KnowwToolError(
      "VALIDATION_ERROR",
      "startTime must be before endTime."
    );
  }
  if (endMs - startMs > MAX_WINDOW_MS) {
    throw new KnowwToolError(
      "VALIDATION_ERROR",
      "The requested window must be 31 days or shorter."
    );
  }
  return { startMs, endMs };
}

function downsample(points: PriceHistoryPoint[]): {
  points: PriceHistoryPoint[];
  downsampled: boolean;
} {
  if (points.length <= MAX_POINTS) {
    return { points, downsampled: false };
  }
  const lastIndex = points.length - 1;
  const kept: PriceHistoryPoint[] = [];
  for (let i = 0; i < MAX_POINTS; i++) {
    kept.push(points[Math.round((i * lastIndex) / (MAX_POINTS - 1))]);
  }
  return { points: kept, downsampled: true };
}

function mapHistoryError(error: unknown): KnowwToolError {
  if (error instanceof KnowwToolError) {
    return error;
  }
  if (error instanceof UpstreamPriceHistoryError) {
    if (error.status === 429) {
      return new KnowwToolError(
        "RATE_LIMITED",
        "The CLOB API rate limited this request."
      );
    }
    return new KnowwToolError(
      "UPSTREAM_UNAVAILABLE",
      "The CLOB API could not serve price history."
    );
  }
  if (isAbortLike(error)) {
    return new KnowwToolError(
      "UPSTREAM_TIMEOUT",
      "The CLOB API took too long to answer."
    );
  }
  return toKnowwToolError(error);
}

export function registerGetPriceHistoryTool(server: McpServer): void {
  server.registerTool(
    "get_price_history",
    {
      title: "Get price history",
      description,
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args: HistoryArgs, context: ServerContext) => {
      try {
        const tokenId = resolveTokenId(args);
        const { startMs, endMs } = resolveWindow(args);
        const fidelityMinutes =
          args.fidelityMinutes ?? DEFAULT_FIDELITY_MINUTES;

        let raw: PriceHistoryPoint[];
        try {
          raw = await fetchPriceHistoryByTokenId(
            tokenId,
            {
              startTs: Math.floor(startMs / 1000),
              endTs: Math.floor(endMs / 1000),
              fidelity: fidelityMinutes,
            },
            { signal: context.mcpReq.signal }
          );
        } catch (error) {
          throw mapHistoryError(error);
        }

        const { points: keptPoints, downsampled } = downsample(raw);
        const points = keptPoints.map((point) => ({
          timestamp: new Date(point.t * 1000).toISOString(),
          price: new Decimal(point.p).toString(),
        }));

        const startTime = new Date(startMs).toISOString();
        const endTime = new Date(endMs).toISOString();
        const lastPoint = points.at(-1);

        const text =
          lastPoint === undefined
            ? "No price history in the requested window."
            : [
                `${points.length} price points from ${startTime} to ${endTime}.`,
                `Latest price ${lastPoint.price} at ${lastPoint.timestamp}.`,
                ...(downsampled
                  ? [`Series downsampled from ${raw.length} upstream samples.`]
                  : []),
              ].join(" ");

        const meta = buildToolMeta({
          requestId: currentRequestId(),
          sources: [{ name: "polymarket-clob", url: CLOB_API_BASE }],
          ...(lastPoint === undefined ? {} : { asOf: lastPoint.timestamp }),
          ...(downsampled ? { truncated: true } : {}),
        });

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            history: {
              tokenId,
              startTime,
              endTime,
              fidelityMinutes,
              points,
              ...(downsampled ? { downsampled: true } : {}),
            },
            meta,
          },
        };
      } catch (error) {
        return toolFailureContent("get_price_history", toKnowwToolError(error));
      }
    }
  );
}
