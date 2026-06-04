import assert from "node:assert/strict";
import test from "node:test";
import { PUSD_ADDRESS } from "@knoww/shared-types/contracts";
import {
  buildPortfolioWithdrawQuoteRequest,
  formatPortfolioTokenBaseUnitAmount,
  summarizePortfolioBridgeStatus,
  validatePortfolioWithdrawBridgeAddress,
} from "../../src/background/portfolio-withdraw-flow";

const POLYGON_USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const POLYGON_USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const RECIPIENT = "0x94F315e36B3D0428e24aF71B5CAfb82A7bd77ed0";

test("buildPortfolioWithdrawQuoteRequest unwraps pUSD to selected Polygon USDC", () => {
  const quote = buildPortfolioWithdrawQuoteRequest({
    amount: "2.897626",
    chainKey: "polygon",
    tokenId: "usdc",
    recipientAddress: RECIPIENT,
    supportedAssets: [
      {
        chainId: "137",
        chainName: "Polygon",
        token: {
          name: "Polymarket USD",
          symbol: "pUSD",
          address: PUSD_ADDRESS,
          decimals: 6,
        },
        minCheckoutUsd: 2,
      },
      {
        chainId: "137",
        chainName: "Polygon",
        token: {
          name: "USD Coin",
          symbol: "USDC",
          address: POLYGON_USDC_ADDRESS,
          decimals: 6,
        },
        minCheckoutUsd: 2,
      },
      {
        chainId: "137",
        chainName: "Polygon",
        token: {
          name: "Bridged USDC",
          symbol: "USDC.e",
          address: POLYGON_USDC_E_ADDRESS,
          decimals: 6,
        },
        minCheckoutUsd: 2,
      },
    ],
  });

  assert.deepEqual(quote.request, {
    fromAmountBaseUnit: "2897626",
    fromChainId: "137",
    fromTokenAddress: PUSD_ADDRESS,
    recipientAddress: RECIPIENT,
    toChainId: "137",
    toTokenAddress: POLYGON_USDC_ADDRESS,
  });
  assert.equal(quote.destination.tokenSymbol, "USDC");
  assert.equal(quote.destination.tokenDecimals, 6);
});

test("formatPortfolioTokenBaseUnitAmount preserves whole-number trailing zeros", () => {
  assert.equal(formatPortfolioTokenBaseUnitAmount("100000000", 6), "100");
  assert.equal(formatPortfolioTokenBaseUnitAmount("20000000", 6), "20");
  assert.equal(formatPortfolioTokenBaseUnitAmount("100500000", 6), "100.5");
  assert.equal(formatPortfolioTokenBaseUnitAmount("100000", 6), "0.1");
});

test("buildPortfolioWithdrawQuoteRequest falls back to Polygon config address only when live data lacks the token", () => {
  const quote = buildPortfolioWithdrawQuoteRequest({
    amount: "1",
    chainKey: "polygon",
    tokenId: "usdc-e",
    recipientAddress: RECIPIENT,
    supportedAssets: [],
  });

  assert.equal(quote.request.toTokenAddress, POLYGON_USDC_E_ADDRESS);
});

test("buildPortfolioWithdrawQuoteRequest rejects pUSD as a destination token address", () => {
  let error: unknown;
  try {
    buildPortfolioWithdrawQuoteRequest({
      amount: "1",
      chainKey: "polygon",
      tokenId: "usdc",
      recipientAddress: RECIPIENT,
      supportedAssets: [
        {
          chainId: "137",
          chainName: "Polygon",
          token: {
            name: "Incorrect USDC mapping",
            symbol: "USDC",
            address: PUSD_ADDRESS,
            decimals: 6,
          },
          minCheckoutUsd: 2,
        },
      ],
    });
  } catch (err) {
    error = err;
  }

  if (!(error instanceof Error)) {
    assert.ok(false, "Expected pUSD destination guard to throw");
    return;
  }
  assert.ok(/Resolved withdrawal destination is pUSD/.test(error.message));
});

test("validatePortfolioWithdrawBridgeAddress rejects direct recipient transfers", () => {
  let error: unknown;
  try {
    validatePortfolioWithdrawBridgeAddress({
      bridgeAddress: RECIPIENT,
      recipientAddress: RECIPIENT,
      sourceAddress: "0xeeE50c8C6E3b28F197B6904B1653Dd7933B8821c",
    });
  } catch (err) {
    error = err;
  }

  if (!(error instanceof Error)) {
    assert.ok(false, "Expected recipient bridge address guard to throw");
    return;
  }
  assert.ok(/Bridge returned the recipient address/.test(error.message));
});

test("summarizePortfolioBridgeStatus reports latest transaction state", () => {
  const summary = summarizePortfolioBridgeStatus([
    {
      fromChainId: "137",
      fromTokenAddress: PUSD_ADDRESS,
      fromAmountBaseUnit: "1000000",
      toChainId: "137",
      toTokenAddress: POLYGON_USDC_ADDRESS,
      status: "SUBMITTED",
      createdTimeMs: 100,
    },
    {
      fromChainId: "137",
      fromTokenAddress: PUSD_ADDRESS,
      fromAmountBaseUnit: "1000000",
      toChainId: "137",
      toTokenAddress: POLYGON_USDC_ADDRESS,
      status: "COMPLETED",
      txHash: "0xabc",
      createdTimeMs: 200,
    },
  ]);

  assert.deepEqual(summary, {
    status: "COMPLETED",
    text: "Completed",
    tone: "success",
    completed: true,
    failed: false,
    txHash: "0xabc",
    fromTokenAddress: PUSD_ADDRESS,
    fromAmountBaseUnit: "1000000",
    toChainId: "137",
    toTokenAddress: POLYGON_USDC_ADDRESS,
  });
});

test("summarizePortfolioBridgeStatus reports waiting when bridge has no transactions yet", () => {
  assert.deepEqual(summarizePortfolioBridgeStatus([]), {
    status: "WAITING",
    text: "Waiting for bridge",
    tone: "info",
    completed: false,
    failed: false,
  });
});
