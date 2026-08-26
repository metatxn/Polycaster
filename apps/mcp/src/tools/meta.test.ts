import { describe, expect, it } from "vitest";
import { buildToolMeta, READ_ONLY_ANNOTATIONS } from "./meta";

describe("READ_ONLY_ANNOTATIONS", () => {
  it("matches the plan's read-only data tool hints exactly", () => {
    expect(READ_ONLY_ANNOTATIONS).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});

describe("buildToolMeta", () => {
  it("carries requestId and sources through and stamps asOf as ISO 8601", () => {
    const meta = buildToolMeta({
      requestId: "req-1",
      sources: [{ name: "gamma", url: "https://gamma-api.polymarket.com" }],
    });

    expect(meta.requestId).toBe("req-1");
    expect(meta.sources).toEqual([
      { name: "gamma", url: "https://gamma-api.polymarket.com" },
    ]);
    // ISO 8601 UTC round-trips through Date without drift.
    expect(new Date(meta.asOf).toISOString()).toBe(meta.asOf);
  });

  it("prefers a caller-supplied upstream timestamp for asOf", () => {
    const meta = buildToolMeta({
      requestId: "req-2",
      sources: [{ name: "clob" }],
      asOf: "2026-08-25T12:00:00.000Z",
    });

    expect(meta.asOf).toBe("2026-08-25T12:00:00.000Z");
  });

  it("omits pagination keys entirely unless provided", () => {
    const bare = buildToolMeta({ requestId: "req-3", sources: [] });
    expect(bare).not.toHaveProperty("nextCursor");
    expect(bare).not.toHaveProperty("truncated");

    const paged = buildToolMeta({
      requestId: "req-4",
      sources: [],
      nextCursor: "opaque-cursor",
      truncated: true,
    });
    expect(paged.nextCursor).toBe("opaque-cursor");
    expect(paged.truncated).toBe(true);
  });
});
