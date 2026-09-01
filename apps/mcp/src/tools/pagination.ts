import { z } from "zod";
import { KnowwToolError } from "../errors/tool-error";

const CURSOR_PREFIX = "k1.";

export const cursorInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .optional()
  .describe("Opaque cursor returned in meta.nextCursor.");

export const pageInfoSchema = z.object({
  returnedResults: z.number().int().nonnegative(),
  totalResults: z.number().int().nonnegative().optional(),
  hasMore: z.boolean(),
});

export type PageInfo = z.output<typeof pageInfoSchema>;

const offsetCursorSchema = z.object({
  v: z.literal(1),
  kind: z.literal("offset"),
  namespace: z.string().min(1),
  offset: z.number().int().safe().nonnegative(),
  fingerprint: z.string().min(1),
});
const legacyOffsetCursorSchema = z.object({
  v: z.literal(1),
  offset: z.number().int().safe().nonnegative(),
  fingerprint: z.string().min(1),
});
const stateCursorSchema = z.object({
  v: z.literal(1),
  kind: z.literal("state"),
  namespace: z.string().min(1),
  fingerprint: z.string().min(1),
  state: z.unknown(),
});

function invalidCursor(): KnowwToolError {
  return new KnowwToolError(
    "VALIDATION_ERROR",
    "cursor is invalid or does not match this request."
  );
}

function encodeBase64Url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): unknown {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "="
  );
  return JSON.parse(atob(padded));
}

export function paginationFingerprint(value: unknown): string {
  const material = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < material.length; index++) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function encodeOffsetCursor(input: {
  namespace: string;
  offset: number;
  fingerprint: string;
}): string {
  return `${CURSOR_PREFIX}${encodeBase64Url({
    v: 1,
    kind: "offset",
    namespace: input.namespace,
    offset: input.offset,
    fingerprint: input.fingerprint,
  })}`;
}

export function isKnowwCursor(cursor: string): boolean {
  return cursor.startsWith(CURSOR_PREFIX);
}

export function encodeStateCursor<T>(input: {
  namespace: string;
  fingerprint: string;
  state: T;
}): string {
  return `${CURSOR_PREFIX}${encodeBase64Url({
    v: 1,
    kind: "state",
    namespace: input.namespace,
    fingerprint: input.fingerprint,
    state: input.state,
  })}`;
}

export function decodeStateCursor<T>(
  cursor: string,
  expected: {
    namespace: string;
    fingerprint: string;
    stateSchema: z.ZodType<T>;
  }
): T {
  try {
    if (!isKnowwCursor(cursor)) throw invalidCursor();
    const decoded = stateCursorSchema.safeParse(
      decodeBase64Url(cursor.slice(CURSOR_PREFIX.length))
    );
    if (
      !decoded.success ||
      decoded.data.namespace !== expected.namespace ||
      decoded.data.fingerprint !== expected.fingerprint
    ) {
      throw invalidCursor();
    }
    const state = expected.stateSchema.safeParse(decoded.data.state);
    if (!state.success) throw invalidCursor();
    return state.data;
  } catch (error) {
    if (error instanceof KnowwToolError) throw error;
    throw invalidCursor();
  }
}

export function decodeOffsetCursor(
  cursor: string,
  expected: {
    namespace: string;
    fingerprint: string;
    maxOffset: number;
  }
): number {
  try {
    if (!cursor.startsWith(CURSOR_PREFIX)) {
      const legacy = legacyOffsetCursorSchema.safeParse(
        decodeBase64Url(cursor)
      );
      if (
        !legacy.success ||
        legacy.data.fingerprint !== expected.fingerprint ||
        legacy.data.offset > expected.maxOffset
      ) {
        throw invalidCursor();
      }
      return legacy.data.offset;
    }
    const decoded = decodeBase64Url(cursor.slice(CURSOR_PREFIX.length));
    const parsed = offsetCursorSchema.safeParse(decoded);
    if (
      !parsed.success ||
      parsed.data.namespace !== expected.namespace ||
      parsed.data.fingerprint !== expected.fingerprint ||
      parsed.data.offset > expected.maxOffset
    ) {
      throw invalidCursor();
    }
    return parsed.data.offset;
  } catch (error) {
    if (error instanceof KnowwToolError) throw error;
    throw invalidCursor();
  }
}

export function resolveOffset(input: {
  cursor?: string;
  legacyOffset: number;
  namespace: string;
  fingerprint: string;
  maxOffset: number;
}): number {
  if (input.cursor === undefined) return input.legacyOffset;
  if (input.legacyOffset !== 0) {
    throw new KnowwToolError(
      "VALIDATION_ERROR",
      "Do not combine cursor with a non-zero offset."
    );
  }
  return decodeOffsetCursor(input.cursor, input);
}

export function buildOffsetPage(input: {
  namespace: string;
  fingerprint: string;
  offset: number;
  limit: number;
  returnedResults: number;
  maxOffset: number;
  totalResults?: number;
}): {
  page: PageInfo;
  nextCursor?: string;
  offsetLimitReached?: boolean;
} {
  const nextOffset = input.offset + input.returnedResults;
  const hasMoreByResult =
    input.totalResults === undefined
      ? input.returnedResults === input.limit
      : nextOffset < input.totalResults;
  const canContinue = nextOffset <= input.maxOffset;
  const hasMore = hasMoreByResult && canContinue;
  return {
    page: {
      returnedResults: input.returnedResults,
      ...(input.totalResults !== undefined
        ? { totalResults: input.totalResults }
        : {}),
      hasMore,
    },
    ...(hasMore
      ? {
          nextCursor: encodeOffsetCursor({
            namespace: input.namespace,
            offset: nextOffset,
            fingerprint: input.fingerprint,
          }),
        }
      : {}),
    ...(hasMoreByResult && !canContinue ? { offsetLimitReached: true } : {}),
  };
}
