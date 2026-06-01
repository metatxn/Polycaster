import { describe, expect, it } from "vitest";

import { parseEventsQuery } from "./events-query";

function parse(qs: string) {
  return parseEventsQuery(new URLSearchParams(qs));
}

describe("parseEventsQuery", () => {
  it("applies defaults when no params are supplied", () => {
    const result = parse("");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.limit).toBe("15");
    expect(result.data.closed).toBe("false");
    expect(result.data.fullMarkets).toBe(false);
    expect(result.data.afterCursor).toBeUndefined();
  });

  it("accepts and normalizes valid bounded params", () => {
    const result = parse(
      "limit=25&closed=true&volume24hr_min=100&liquidity_min=50&tag_slug=nba&markets=full"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.limit).toBe("25");
    expect(result.data.closed).toBe("true");
    expect(result.data.volume24hrMin).toBe("100");
    expect(result.data.liquidityMin).toBe("50");
    expect(result.data.tagSlug).toBe("nba");
    expect(result.data.fullMarkets).toBe(true);
  });

  it("rejects offset with a 400 and a clear message", () => {
    const result = parse("offset=20");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/offset/i);
  });

  it("rejects a non-numeric limit", () => {
    const result = parse("limit=abc");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("rejects a limit above the maximum", () => {
    const result = parse("limit=10000");
    expect(result.ok).toBe(false);
  });

  it("rejects a limit below 1", () => {
    expect(parse("limit=0").ok).toBe(false);
    expect(parse("limit=-5").ok).toBe(false);
  });

  it("rejects a non-boolean closed value", () => {
    expect(parse("closed=maybe").ok).toBe(false);
  });

  it("rejects negative numeric minimums", () => {
    expect(parse("volume24hr_min=-1").ok).toBe(false);
    expect(parse("liquidity_min=-0.5").ok).toBe(false);
  });

  it("rejects an over-long tag_slug and after_cursor", () => {
    expect(parse(`tag_slug=${"x".repeat(200)}`).ok).toBe(false);
    expect(parse(`after_cursor=${"y".repeat(1000)}`).ok).toBe(false);
  });

  it("treats empty-string params as absent rather than coercing to 0", () => {
    const result = parse("limit=&volume24hr_min=&closed=");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.limit).toBe("15");
    expect(result.data.closed).toBe("false");
    expect(result.data.volume24hrMin).toBeUndefined();
  });
});
