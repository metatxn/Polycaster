import { describe, expect, it } from "vitest";
import { deriveDepositMinAmount } from "../../src/funding/gateways/shared";

// The machine enforces FundingToken.minAmount in TOKEN units; this helper is
// the gateway-boundary conversion from the USD floor via the token's implied
// price (usdValue / balance). See the Task 4 reviewer Critical: a 1:1 USD
// floor falsely rejected 0.5 WETH (~$1500) as "below $2" while passing
// 3 POL (~$1.20) against the same floor.
describe("deriveDepositMinAmount", () => {
  it("converts a USD floor to token units via the price ratio for non-pegged tokens", () => {
    // $2 floor, 2 WETH worth $4000 → $2000/WETH → 0.001 WETH.
    expect(deriveDepositMinAmount("WETH", "2", "4000", "2")).toBe("0.001");
  });

  it("keeps enough precision for high-priced tokens", () => {
    // $2 floor, 2 WETH worth $6000 → $3000/WETH → 0.000666...
    const minAmount = deriveDepositMinAmount("WETH", "2", "6000", "2");
    expect(minAmount.startsWith("0.00066666")).toBe(true);
  });

  it("maps USD-pegged symbols 1:1 regardless of balance/price", () => {
    expect(deriveDepositMinAmount("USDC.e", "2", "0", "")).toBe("2");
    expect(deriveDepositMinAmount("USDT", "5", "123", "7")).toBe("5");
    expect(deriveDepositMinAmount("DAI", "2", "0", "0")).toBe("2");
  });

  it("returns '0' when no USD floor applies", () => {
    expect(deriveDepositMinAmount("WETH", "0", "4000", "2")).toBe("0");
    expect(deriveDepositMinAmount("USDC.e", "0", "10", "10")).toBe("0");
  });

  it("returns '0' when the price cannot be derived (unknown/zero balance or USD value)", () => {
    expect(deriveDepositMinAmount("WETH", "2", "0", "2")).toBe("0");
    expect(deriveDepositMinAmount("WETH", "2", "4000", "0")).toBe("0");
    expect(deriveDepositMinAmount("WETH", "2", "", "")).toBe("0");
  });
});
