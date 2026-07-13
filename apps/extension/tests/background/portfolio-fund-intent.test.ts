import assert from "node:assert/strict";
import { test } from "vitest";
import { fingerprintPortfolioFundIntent } from "../../src/types/portfolio-fund-intent";

const depositIntent = {
  action: "deposit" as const,
  address: "0x000000000000000000000000000000000000dEaD",
  walletMode: "deposit",
  amount: "10.000",
  chainId: "137",
  tokenSymbol: "USDC.e",
  tokenAddress: "0x000000000000000000000000000000000000bEEF",
  tokenDecimals: 6,
};

test("normalizes fund fingerprints without floating-point amount conversion", () => {
  assert.equal(
    fingerprintPortfolioFundIntent(depositIntent),
    fingerprintPortfolioFundIntent({ ...depositIntent, amount: "10" })
  );
});
