import { describe, expect, it } from "vitest";
import {
  clampedInt,
  nonNegativeFloatParam,
  orAbsent,
  tokenIdSchema,
} from "./api-query";

describe("api-query schemas", () => {
  it("tokenIdSchema accepts long numeric ids and rejects junk", () => {
    expect(tokenIdSchema.safeParse("12345678901").success).toBe(true);
    expect(tokenIdSchema.safeParse("abc").success).toBe(false);
    expect(tokenIdSchema.safeParse("123").success).toBe(false);
  });
  it("clampedInt coerces, clamps and defaults", () => {
    const limit = clampedInt(1, 100, 20);
    expect(limit.parse("50")).toBe(50);
    expect(limit.parse("9999")).toBe(100);
    expect(limit.parse(undefined)).toBe(20);
    expect(limit.parse("-3")).toBe(1);
    expect(limit.parse("abc")).toBe(20);
  });
  it("orAbsent maps null/empty query values to undefined so defaults apply", () => {
    const limit = clampedInt(1, 100, 20);
    expect(orAbsent(null)).toBeUndefined();
    expect(orAbsent("")).toBeUndefined();
    expect(orAbsent("7")).toBe("7");
    // `?limit=` must behave like an absent param, not coerce "" -> 0 -> min.
    expect(limit.parse(orAbsent(""))).toBe(20);
  });
  it("nonNegativeFloatParam defaults invalid values and clamps negatives", () => {
    expect(nonNegativeFloatParam("123.45", 10)).toBe(123.45);
    expect(nonNegativeFloatParam("abc", 10)).toBe(10);
    expect(nonNegativeFloatParam("Infinity", 10)).toBe(10);
    expect(nonNegativeFloatParam("-5", 10)).toBe(0);
    expect(nonNegativeFloatParam("", 10)).toBe(10);
    expect(nonNegativeFloatParam(null, 10)).toBe(10);
  });
});
