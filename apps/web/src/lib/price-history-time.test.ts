import { describe, expect, it } from "vitest";
import { alignPriceHistoryStartTs } from "./price-history-time";

describe("alignPriceHistoryStartTs", () => {
  it("aligns a moving start time to its fidelity boundary", () => {
    expect(alignPriceHistoryStartTs(3_661, 60)).toBe(3_600);
    expect(alignPriceHistoryStartTs(3_661, 5)).toBe(3_600);
    expect(alignPriceHistoryStartTs(3_661, 1)).toBe(3_660);
  });

  it("uses a one-minute boundary when fidelity is invalid", () => {
    expect(alignPriceHistoryStartTs(121, 0)).toBe(120);
    expect(alignPriceHistoryStartTs(121, Number.NaN)).toBe(120);
  });
});
