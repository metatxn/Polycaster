import type { JsonRpcResponse } from "./mcp-client";

const SLUG_PATTERN = /^[a-z0-9-]{1,200}$/;
const EVENT_ID_PATTERN = /^[0-9]{1,20}$/;
const CONDITION_ID_PATTERN = /^0x[0-9a-f]{64}$/;
const TOKEN_ID_PATTERN = /^[0-9]{1,80}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? record(value[0]) : null;
}

function matchingString(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function json(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Builds runnable explorer arguments from the first complete live search hit.
 * Search data is upstream-controlled, so every identifier is validated before
 * it reaches an editable request.
 */
export function liveArgumentsFromSearch(
  response: JsonRpcResponse
): Record<string, string> {
  const structuredContent = record(response.result?.structuredContent);
  const event = firstRecord(structuredContent?.events);
  if (!event) return {};

  const eventSlug = matchingString(event.slug, SLUG_PATTERN);
  const eventId = matchingString(event.id, EVENT_ID_PATTERN);
  const market = firstRecord(event.markets);
  const marketSlug = matchingString(market?.slug, SLUG_PATTERN);
  const conditionId = matchingString(market?.conditionId, CONDITION_ID_PATTERN);
  const outcome = firstRecord(market?.outcomes);
  const tokenId = matchingString(outcome?.tokenId, TOKEN_ID_PATTERN);

  const argumentsByTool: Record<string, string> = {};
  if (eventSlug || eventId) {
    argumentsByTool.get_event = json({
      ...(eventSlug ? { slug: eventSlug } : { id: eventId }),
      marketLimit: 5,
    });
  }
  if (marketSlug || conditionId || tokenId) {
    argumentsByTool.get_market = json(
      marketSlug
        ? { slug: marketSlug }
        : conditionId
          ? { conditionId }
          : { tokenId }
    );
  }
  if (tokenId) {
    argumentsByTool.get_orderbook = json({ tokenId, depth: 20 });
    argumentsByTool.get_price_history = json({
      tokenId,
      fidelityMinutes: 60,
    });
    argumentsByTool.get_market_quotes = json({ tokenIds: [tokenId] });
  }
  if (conditionId) {
    argumentsByTool.get_market_trades = json({
      conditionIds: [conditionId],
      limit: 50,
    });
    argumentsByTool.get_market_holders = json({
      conditionIds: [conditionId],
      limit: 10,
    });
    argumentsByTool.get_open_interest = json({
      conditionIds: [conditionId],
    });
  }
  if (eventId) {
    const numericEventId = Number(eventId);
    if (Number.isSafeInteger(numericEventId) && numericEventId > 0) {
      argumentsByTool.get_event_live_volume = json({
        eventId: numericEventId,
      });
    }
  }
  return argumentsByTool;
}
