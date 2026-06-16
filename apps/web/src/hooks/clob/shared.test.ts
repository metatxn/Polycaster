import { describe, expect, it } from "vitest";
import { isBalanceAllowanceError, parseRawUnits } from "./shared";

describe("parseRawUnits", () => {
  it("passes bigints through", () => {
    expect(parseRawUnits(BigInt(123))).toBe(BigInt(123));
  });
  it("parses integer strings", () => {
    expect(parseRawUnits("1000000")).toBe(BigInt(1000000));
  });
  it("returns 0n for garbage", () => {
    expect(parseRawUnits("not-a-number")).toBe(BigInt(0));
  });
  it("truncates fractional numbers (1.9 → 1n)", () => {
    expect(parseRawUnits(1.9)).toBe(BigInt(1));
  });
  it("returns 0n for negative numbers", () => {
    expect(parseRawUnits(-1)).toBe(BigInt(0));
  });
  it("returns 0n for NaN", () => {
    expect(parseRawUnits(Number.NaN)).toBe(BigInt(0));
  });
  it("returns 0n for undefined", () => {
    expect(parseRawUnits(undefined)).toBe(BigInt(0));
  });
  it("returns 0n for decimal strings (not pure digits)", () => {
    expect(parseRawUnits("1.5")).toBe(BigInt(0));
  });
  it("returns 0n for negative strings", () => {
    expect(parseRawUnits("-5")).toBe(BigInt(0));
  });
});

describe("isBalanceAllowanceError", () => {
  it("detects balance/allowance failure messages", () => {
    expect(
      isBalanceAllowanceError(new Error("not enough balance / allowance"))
    ).toBe(true);
  });
  it("detects the second regex alternative: 'balance is not enough'", () => {
    expect(isBalanceAllowanceError(new Error("balance is not enough"))).toBe(
      true
    );
  });
  it("is case-insensitive", () => {
    expect(
      isBalanceAllowanceError(new Error("NOT ENOUGH BALANCE / ALLOWANCE"))
    ).toBe(true);
  });
  it("accepts a plain string input", () => {
    expect(isBalanceAllowanceError("not enough balance / allowance")).toBe(
      true
    );
  });
  it("ignores unrelated errors", () => {
    expect(isBalanceAllowanceError(new Error("network timeout"))).toBe(false);
  });
});
