import { createLogger } from "@knoww/logger";
import Decimal from "decimal.js";
import type { AgentWatchlistItem } from "./types.ts";

const log = createLogger("agent.resolutions");
const GAMMA_MARKETS_BASE = "https://gamma-api.polymarket.com/markets";
const GAMMA_TIMEOUT_MS = 5000;

export interface AgentResolution {
  tokenId: string;
  conditionId?: string;
  marketSlug?: string;
  /** 0 if our token expired worthless, 1 if it paid out. */
  outcomeYes: 0 | 1;
  /** Raw settlement price for our token (decimal string from gamma). */
  settlementPrice: string;
  /** ISO timestamp when the resolution row was written. */
  resolvedAt: string;
}

interface GammaMarketShape {
  closed?: boolean;
  outcomes?: unknown;
  outcomePrices?: unknown;
  clobTokenIds?: unknown;
  endDate?: string;
  umaResolutionStatus?: string;
}

// Gamma sometimes serializes array columns as JSON-encoded strings instead
// of native arrays — normalize both forms.
function parseStringList(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // fall through
    }
  }
  return null;
}

export async function fetchMarketResolution(
  item: Pick<AgentWatchlistItem, "tokenId" | "conditionId" | "marketSlug">
): Promise<AgentResolution | null> {
  if (!item.conditionId) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GAMMA_TIMEOUT_MS);
  try {
    // closed=true is required: gamma's default filter excludes resolved
    // markets, so we'd get an empty array without it.
    const url = `${GAMMA_MARKETS_BASE}?condition_ids=${encodeURIComponent(item.conditionId)}&closed=true`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = (await response.json()) as GammaMarketShape[];
    const market = Array.isArray(data) ? data[0] : null;
    if (!market || market.closed !== true) return null;

    const tokens = parseStringList(market.clobTokenIds);
    const prices = parseStringList(market.outcomePrices);
    if (!tokens || !prices || tokens.length !== prices.length) return null;

    const idx = tokens.indexOf(item.tokenId);
    if (idx === -1) return null;

    const settlementPrice = prices[idx];
    // Canceled or refunded markets settle 50/50 with prices like ["0.5","0.5"].
    // Ambiguous for binary scoring — skip until we have a separate handling path.
    if (settlementPrice === "0.5") return null;

    const outcomeYes: 0 | 1 = new Decimal(settlementPrice).gte("0.5") ? 1 : 0;

    return {
      tokenId: item.tokenId,
      conditionId: item.conditionId,
      marketSlug: item.marketSlug,
      outcomeYes,
      settlementPrice,
      resolvedAt: new Date().toISOString(),
    };
  } catch (error) {
    log.error("resolution.fetch.failed", { tokenId: item.tokenId, error });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Per-vote Brier score = (fairProbability - outcomeYes)^2.
 * Mean across votes for a model gives that model's calibration over time.
 * Lower is better; 0.25 is "no skill" (always predicting 0.5).
 */
export function brierScore(fairProbability: number, outcomeYes: 0 | 1): number {
  const clamped = Math.min(1, Math.max(0, fairProbability));
  const diff = clamped - outcomeYes;
  return diff * diff;
}
