import type { GammaMarketDetail } from "@knoww/services";
import { parseGammaStringArray } from "@knoww/shared-types/polymarket";
import { z } from "zod";
import { toDecimalString } from "./decimal";

/**
 * Projections shared by the Gamma-backed tools (get_market, get_event).
 * search_markets keeps its own stricter market summary because search
 * results drop price-less outcomes while detail lookups keep them.
 */

export const KNOWW_EVENT_URL_BASE = "https://knoww.app/events/detail";
export const MAX_OUTCOMES_PER_MARKET = 20;
export const MAX_DESCRIPTION_LENGTH = 2000;

export const SLUG_PATTERN = /^[a-z0-9-]{1,200}$/;

export function knowwEventUrl(slug: string): string {
  return `${KNOWW_EVENT_URL_BASE}/${slug}`;
}

export function cleanDescription(raw: string | undefined): string | undefined {
  return raw?.trim() ? raw.slice(0, MAX_DESCRIPTION_LENGTH) : undefined;
}

export function descriptionIsTruncated(raw: string | undefined): boolean {
  return Boolean(raw?.trim()) && (raw?.length ?? 0) > MAX_DESCRIPTION_LENGTH;
}

export const marketStatusSchema = z.enum([
  "active",
  "closed",
  "resolved",
  "unknown",
]);

export type MarketStatus = z.output<typeof marketStatusSchema>;

/**
 * Gamma keeps `active: true` on settled markets, so lifecycle derives from
 * `closed` plus `umaResolutionStatus` alone. Legacy markets omit
 * umaResolutionStatus entirely; without an explicit "resolved" a closed
 * market stays "closed" because resolution is never inferred.
 */
export function deriveMarketStatus(detail: GammaMarketDetail): MarketStatus {
  if (typeof detail.closed !== "boolean") return "unknown";
  if (!detail.closed) return "active";
  return detail.umaResolutionStatus === "resolved" ? "resolved" : "closed";
}

export const marketOutcomeSchema = z.object({
  name: z.string(),
  price: z
    .string()
    .optional()
    .describe("Decimal string probability between 0 and 1."),
  tokenId: z.string().optional().describe("CLOB token id for this outcome."),
});

export type MarketOutcome = z.output<typeof marketOutcomeSchema>;

export interface MarketOutcomeProjection {
  outcomes: MarketOutcome[];
  totalOutcomes: number;
  truncated: boolean;
}

/**
 * Aligns outcome names with prices and CLOB token ids. Unlike search
 * summaries, a detail lookup keeps price-less outcomes up to the output cap.
 * The projection reports the full count so callers can detect omitted legs.
 */
export function projectMarketOutcomes(
  detail: GammaMarketDetail
): MarketOutcomeProjection {
  const names = parseGammaStringArray(detail.outcomes);
  const prices = parseGammaStringArray(detail.outcomePrices);
  const tokenIds = parseGammaStringArray(detail.clobTokenIds, {
    fallbackCsv: true,
  });
  const outcomes: MarketOutcome[] = [];
  const count = Math.min(names.length, MAX_OUTCOMES_PER_MARKET);
  for (let index = 0; index < count; index++) {
    const price = toDecimalString(prices[index]);
    const tokenId = tokenIds[index];
    outcomes.push({
      name: names[index],
      ...(price !== undefined ? { price } : {}),
      ...(tokenId !== undefined ? { tokenId } : {}),
    });
  }
  return {
    outcomes,
    totalOutcomes: names.length,
    truncated: names.length > MAX_OUTCOMES_PER_MARKET,
  };
}

export function isAbortLike(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}
