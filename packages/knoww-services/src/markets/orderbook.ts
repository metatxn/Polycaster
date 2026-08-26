import { z } from "zod";
import { UpstreamOrderbookError } from "../errors";
import {
  type ServiceFetchOptions,
  withUpstreamTimeout,
} from "../fetch-options";
import { decimalValueSchema } from "../validation";

/**
 * Standalone CLOB /book fetcher. Deliberately does not reuse
 * @knoww/shared-types/clob: that module dynamically imports the unified
 * Polymarket SDK, which bundlers pull into any Worker that touches it.
 * The normalization here mirrors normalizeClobOrderBook instead.
 */

export const CLOB_API_BASE = "https://clob.polymarket.com";

const ORDERBOOK_UPSTREAM_TIMEOUT_MS = 8500;

export interface OrderbookLevel {
  price: string;
  size: string;
}

/**
 * Normalized /book snapshot. Levels keep the upstream order, which is
 * untrusted (probed 2026-08: both sides arrive worst-to-best); callers
 * sort. timestamp is a milliseconds epoch string.
 */
export interface OrderbookSnapshot {
  market?: string;
  assetId?: string;
  hash?: string;
  timestamp?: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  minOrderSize?: string;
  tickSize?: string;
}

const asDecimalString = (value: string | number): string => String(value);
const priceSchema = decimalValueSchema({ min: "0", max: "1" }).transform(
  asDecimalString
);
const positiveSizeSchema = decimalValueSchema({
  min: "0",
  minExclusive: true,
}).transform(asDecimalString);
const levelSchema = z.object({
  price: priceSchema,
  size: positiveSizeSchema,
});

const snapshotSchema = z
  .object({
    market: z.string().min(1).optional(),
    asset_id: z.string().min(1).optional(),
    tokenId: z.string().min(1).optional(),
    hash: z.string().min(1).optional(),
    timestamp: z
      .string()
      .regex(/^\d+$/)
      .refine((value) => {
        const timestamp = Number(value);
        return Number.isSafeInteger(timestamp) && timestamp > 0;
      }, "Invalid epoch timestamp")
      .optional(),
    bids: z.array(levelSchema),
    asks: z.array(levelSchema),
    min_order_size: positiveSizeSchema.optional(),
    minOrderSize: positiveSizeSchema.optional(),
    tick_size: positiveSizeSchema.optional(),
    tickSize: positiveSizeSchema.optional(),
  })
  .passthrough();

function normalizeSnapshot(payload: unknown): OrderbookSnapshot {
  const parsed = snapshotSchema.safeParse(payload);
  if (!parsed.success) {
    throw new UpstreamOrderbookError(
      "CLOB orderbook returned a malformed payload"
    );
  }
  const data = parsed.data;
  const assetId = data.asset_id ?? data.tokenId;
  const minOrderSize = data.min_order_size ?? data.minOrderSize;
  const tickSize = data.tick_size ?? data.tickSize;
  return {
    ...(data.market !== undefined ? { market: data.market } : {}),
    ...(assetId !== undefined ? { assetId } : {}),
    ...(data.hash !== undefined ? { hash: data.hash } : {}),
    ...(data.timestamp !== undefined ? { timestamp: data.timestamp } : {}),
    bids: data.bids,
    asks: data.asks,
    ...(minOrderSize !== undefined ? { minOrderSize } : {}),
    ...(tickSize !== undefined ? { tickSize } : {}),
  };
}

/**
 * Fetches the live order book for one CLOB token id. Returns null when the
 * CLOB reports that no book exists (404), and throws UpstreamOrderbookError
 * with the status for other failures.
 */
export async function fetchOrderbookByTokenId(
  tokenId: string,
  options?: ServiceFetchOptions
): Promise<OrderbookSnapshot | null> {
  return withUpstreamTimeout(
    options,
    ORDERBOOK_UPSTREAM_TIMEOUT_MS,
    async (fetchImpl, signal) => {
      const params = new URLSearchParams({ token_id: tokenId });
      const response = await fetchImpl(
        `${CLOB_API_BASE}/book?${params.toString()}`,
        {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal,
        }
      );

      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new UpstreamOrderbookError(
          `CLOB orderbook lookup failed with ${response.status}`,
          response.status
        );
      }

      const payload: unknown = await response.json();
      const snapshot = normalizeSnapshot(payload);
      if (snapshot.assetId !== undefined && snapshot.assetId !== tokenId) {
        throw new UpstreamOrderbookError(
          "CLOB orderbook returned a different token"
        );
      }

      return snapshot;
    }
  );
}
