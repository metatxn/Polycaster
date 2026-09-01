import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildOffsetPage,
  decodeOffsetCursor,
  decodeStateCursor,
  encodeOffsetCursor,
  encodeStateCursor,
  paginationFingerprint,
  resolveOffset,
} from "./pagination";

describe("opaque tool pagination", () => {
  const fingerprint = paginationFingerprint([
    "wallet-positions",
    "0xabc",
    "CURRENT",
    "DESC",
  ]);

  it("round-trips an opaque offset cursor bound to one tool and filter set", () => {
    const cursor = encodeOffsetCursor({
      namespace: "get_wallet_positions",
      offset: 50,
      fingerprint,
    });

    expect(cursor).not.toContain("wallet");
    expect(
      decodeOffsetCursor(cursor, {
        namespace: "get_wallet_positions",
        fingerprint,
        maxOffset: 10_000,
      })
    ).toBe(50);
  });

  it("rejects a cursor reused with different filters", () => {
    const cursor = encodeOffsetCursor({
      namespace: "get_wallet_positions",
      offset: 50,
      fingerprint,
    });

    expect(() =>
      decodeOffsetCursor(cursor, {
        namespace: "get_wallet_positions",
        fingerprint: paginationFingerprint(["different-wallet"]),
        maxOffset: 10_000,
      })
    ).toThrow("cursor is invalid or does not match this request");
  });

  it("accepts the legacy search cursor shape during migration", () => {
    const legacyCursor = btoa(
      JSON.stringify({ v: 1, offset: 20, fingerprint })
    ).replace(/=+$/g, "");

    expect(
      decodeOffsetCursor(legacyCursor, {
        namespace: "search_markets",
        fingerprint,
        maxOffset: 100,
      })
    ).toBe(20);
  });

  it("rejects a cursor combined with a non-zero legacy offset", () => {
    const cursor = encodeOffsetCursor({
      namespace: "get_market_trades",
      offset: 25,
      fingerprint,
    });

    expect(() =>
      resolveOffset({
        cursor,
        legacyOffset: 10,
        namespace: "get_market_trades",
        fingerprint,
        maxOffset: 10_000,
      })
    ).toThrow("Do not combine cursor with a non-zero offset");
  });

  it("returns a next cursor for a full offset-backed page", () => {
    const result = buildOffsetPage({
      namespace: "list_tags",
      fingerprint,
      offset: 100,
      limit: 50,
      returnedResults: 50,
      maxOffset: 10_000,
    });

    expect(result.page).toEqual({ returnedResults: 50, hasMore: true });
    expect(
      decodeOffsetCursor(result.nextCursor as string, {
        namespace: "list_tags",
        fingerprint,
        maxOffset: 10_000,
      })
    ).toBe(150);
  });

  it("uses an exact total when the complete collection is already loaded", () => {
    const result = buildOffsetPage({
      namespace: "get_event",
      fingerprint,
      offset: 20,
      limit: 20,
      returnedResults: 7,
      totalResults: 27,
      maxOffset: 10_000,
    });

    expect(result).toEqual({
      page: { returnedResults: 7, totalResults: 27, hasMore: false },
    });
  });

  it("round-trips a typed composite keyset cursor", () => {
    const stateSchema = z.object({
      marketCursor: z.string().nullable(),
      teamOffset: z.number().int().nullable(),
    });
    const cursor = encodeStateCursor({
      namespace: "list_sports_markets",
      fingerprint,
      state: { marketCursor: "upstream-next", teamOffset: 20 },
    });

    expect(
      decodeStateCursor(cursor, {
        namespace: "list_sports_markets",
        fingerprint,
        stateSchema,
      })
    ).toEqual({ marketCursor: "upstream-next", teamOffset: 20 });
  });
});
