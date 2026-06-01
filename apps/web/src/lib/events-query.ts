import { z } from "zod";

/**
 * Shared, strict query validation for the public `/api/events/trending` and
 * `/api/events/new` routes. Both forward caller-controlled paging/filter
 * controls to Gamma; without bounds a caller can request oversized pages or
 * malformed filters (CWE-20). This schema enforces numeric bounds, a boolean
 * `closed`, and length-capped cursor/tag strings before anything reaches
 * upstream.
 */

const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const MAX_TAG_LENGTH = 100;
// Generous upper bound for monetary filters (USD); rejects absurd/overflow input
// while comfortably covering any real market volume/liquidity.
const MAX_NUMERIC = 1e12;

const optionalBoundedNumber = z.coerce
  .number()
  .finite()
  .nonnegative()
  .max(MAX_NUMERIC)
  .optional();

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(15),
  after_cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
  closed: z.enum(["true", "false"]).default("false"),
  volume24hr_min: optionalBoundedNumber,
  volume1wk_min: optionalBoundedNumber,
  liquidity_min: optionalBoundedNumber,
  tag_slug: z.string().min(1).max(MAX_TAG_LENGTH).optional(),
});

export interface NormalizedEventsQuery {
  limit: string;
  closed: "true" | "false";
  afterCursor?: string;
  volume24hrMin?: string;
  volume1wkMin?: string;
  liquidityMin?: string;
  tagSlug?: string;
  fullMarkets: boolean;
}

export type EventsQueryParseResult =
  | { ok: true; data: NormalizedEventsQuery }
  | { ok: false; status: number; error: string; details?: string };

/** Null/empty query values are treated as "absent" so optional fields don't
 * accidentally coerce (e.g. `""` → `0`) and defaults apply cleanly. */
function orUndefined(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

function asString(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

export function parseEventsQuery(
  searchParams: URLSearchParams
): EventsQueryParseResult {
  if (searchParams.has("offset")) {
    return {
      ok: false,
      status: 400,
      error: "offset is no longer supported; use after_cursor",
    };
  }

  const parsed = eventsQuerySchema.safeParse({
    limit: orUndefined(searchParams.get("limit")),
    after_cursor: orUndefined(searchParams.get("after_cursor")),
    closed: orUndefined(searchParams.get("closed")),
    volume24hr_min: orUndefined(searchParams.get("volume24hr_min")),
    volume1wk_min: orUndefined(searchParams.get("volume1wk_min")),
    liquidity_min: orUndefined(searchParams.get("liquidity_min")),
    tag_slug: orUndefined(searchParams.get("tag_slug")),
  });

  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "Invalid query parameters",
      details: parsed.error.message,
    };
  }

  return {
    ok: true,
    data: {
      limit: String(parsed.data.limit),
      closed: parsed.data.closed,
      afterCursor: parsed.data.after_cursor,
      volume24hrMin: asString(parsed.data.volume24hr_min),
      volume1wkMin: asString(parsed.data.volume1wk_min),
      liquidityMin: asString(parsed.data.liquidity_min),
      tagSlug: parsed.data.tag_slug,
      fullMarkets: searchParams.get("markets") === "full",
    },
  };
}
