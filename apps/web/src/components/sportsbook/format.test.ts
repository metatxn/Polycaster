import { describe, expect, it } from "vitest";
import { formatPositionPercent, formatSignedUsd, formatUsd } from "./format";

describe("formatSignedUsd", () => {
  it("does not prefix gains with +", () => {
    expect(formatSignedUsd(12.5)).toBe("$12.50");
  });
  it("keeps - on losses", () => {
    expect(formatSignedUsd(-3.2)).toBe("-$3.20");
  });
  it("treats zero as unsigned", () => {
    expect(formatSignedUsd(0)).toBe("$0.00");
  });
});

describe("formatUsd", () => {
  it("formats plain USD", () => {
    expect(formatUsd(7)).toBe("$7.00");
  });
});

describe("formatPositionPercent", () => {
  it("does not prefix gains with +", () => {
    expect(formatPositionPercent(5.2)).toBe("5.2%");
  });
  it("keeps - on losses", () => {
    expect(formatPositionPercent(-3.5)).toBe("-3.5%");
  });
  it("treats zero as unsigned", () => {
    expect(formatPositionPercent(0)).toBe("0.0%");
  });
});
