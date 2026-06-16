import { z } from "zod";

/**
 * Shared zod schemas for /api/* query-string validation.
 *
 * Routes parse `searchParams` through these at the top of the handler and
 * use the parsed values below; on parse failure they return
 * `jsonError(<first issue message>, 400)` (see `@/lib/api-error`).
 */

/** CLOB token ids are long decimal strings (>=10 digits). */
export const tokenIdSchema = z.string().regex(/^\d{10,}$/, "invalid token id");

/**
 * Coercing integer query param with clamping and a default.
 *
 * - `undefined` (param absent) → `fallback`
 * - non-numeric / non-integer junk → `fallback` (never a parse failure)
 * - out-of-range integers → clamped into `[min, max]`
 */
export function clampedInt(min: number, max: number, fallback: number) {
  return z.coerce
    .number()
    .int()
    .catch(fallback)
    .transform((v) => Math.min(max, Math.max(min, v)))
    .default(fallback);
}

/** Polygon address (checksummed or lowercase). */
export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "invalid address");

/** First human-readable issue message from a failed `safeParse`. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid query parameters";
}

/**
 * Null/empty query values are treated as "absent" so defaults apply cleanly
 * (mirrors the legacy `searchParams.get(x) || "<default>"` routes, where
 * `?limit=` meant "use the default" — without this, `z.coerce` would turn
 * `""` into `0`).
 */
export function orAbsent(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

/**
 * Finite non-negative float query param with legacy fallback/clamping semantics.
 *
 * - absent/empty/invalid/non-finite values -> fallback
 * - negative finite values -> 0
 * - valid finite values -> parsed number
 */
export function nonNegativeFloatParam(
  value: string | null,
  fallback: number
): number {
  if (value === null) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(parsed, 0);
}
