import { z } from "zod";

export interface KnowwToolSource {
  name: string;
  url?: string;
}

/** Metadata attached to every successful data tool result. */
export interface KnowwToolMeta {
  requestId: string;
  asOf: string;
  sources: KnowwToolSource[];
  nextCursor?: string;
  truncated?: boolean;
}

/** Zod mirror of KnowwToolMeta for tool output schemas. */
export const toolMetaSchema = z.object({
  requestId: z.string(),
  asOf: z.string(),
  sources: z.array(z.object({ name: z.string(), url: z.string().optional() })),
  nextCursor: z.string().optional(),
  truncated: z.boolean().optional(),
});

/**
 * Client hints for read-only data tools. Hints only: OAuth scopes and
 * server-side checks are the actual controls.
 */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export interface BuildToolMetaInput {
  requestId: string;
  sources: KnowwToolSource[];
  /** Upstream source timestamp when the API provides one; defaults to now. */
  asOf?: string;
  nextCursor?: string;
  truncated?: boolean;
}

export function buildToolMeta(input: BuildToolMetaInput): KnowwToolMeta {
  const meta: KnowwToolMeta = {
    requestId: input.requestId,
    asOf: input.asOf ?? new Date().toISOString(),
    sources: input.sources,
  };
  // Leave pagination keys out of the JSON entirely when unused; agents read
  // key presence as signal.
  if (input.nextCursor !== undefined) {
    meta.nextCursor = input.nextCursor;
  }
  if (input.truncated !== undefined) {
    meta.truncated = input.truncated;
  }
  return meta;
}
