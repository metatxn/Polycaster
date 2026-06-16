import { describe, expect, it } from "vitest";
import {
  formatCents,
  formatProfitLabel,
  formatVolume,
  relativeTime,
} from "./formatters";

describe("formatVolume", () => {
  it("renders a billions tier", () => {
    expect(formatVolume(2_048_910_000)).toBe("$2.05B");
  });
  it("keeps millions under 1B", () => {
    expect(formatVolume(999_000_000)).toBe("$999.00M");
  });
});

describe("formatCents", () => {
  it("strips the decimal when the value is whole cents", () => {
    expect(formatCents(0.75)).toBe("75¢");
    expect(formatCents("0.75")).toBe("75¢");
  });
  it("keeps one decimal of sub-cent precision when present", () => {
    expect(formatCents(0.753)).toBe("75.3¢");
    expect(formatCents(0.005)).toBe("0.5¢");
  });
  it("rounds half-up at one decimal", () => {
    expect(formatCents(0.7535)).toBe("75.4¢"); // 75.35 -> 75.4 half-up
  });
  it("handles garbage", () => {
    expect(formatCents(Number.NaN)).toBe("0¢");
    expect(formatCents("not-a-number")).toBe("0¢");
  });
});

describe("relativeTime", () => {
  const now = Date.now();
  it("compact style", () => {
    expect(relativeTime(now - 5 * 60_000, "compact", now)).toBe("5m");
    expect(relativeTime(now - 3 * 3_600_000, "compact", now)).toBe("3h");
  });
  it("verbose style", () => {
    expect(relativeTime(now - 5 * 60_000, "verbose", now)).toBe("5m ago");
    expect(relativeTime(now - 30_000, "verbose", now)).toBe("just now");
  });
});

describe("formatProfitLabel", () => {
  it("renders gains without a plus sign", () => {
    expect(formatProfitLabel(5.5, 2.25)).toBe("$3.25");
  });
  it("renders losses with the sign before the dollar", () => {
    expect(formatProfitLabel(1, 2.5)).toBe("-$1.50");
  });
  it("never shows -$0.00 for a sub-cent loss", () => {
    expect(formatProfitLabel(1, 1.004)).toBe("$0.00");
  });
  it("renders break-even as $0.00", () => {
    expect(formatProfitLabel(1, 1)).toBe("$0.00");
  });
  it("subtracts in decimal, not float (2.005 - 1 rounds to 1.01)", () => {
    // Float math yields 1.0049999999999999, which toFixed(2) shows as $1.00.
    expect(formatProfitLabel(2.005, 1)).toBe("$1.01");
  });
});
