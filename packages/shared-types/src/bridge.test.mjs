import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBridgeTokenIndex,
  getMinDepositForToken,
  resolveDestTokenAddress,
  resolveWalletDepositRoute,
  validateWithdrawBridgeDestination,
} from "./bridge.ts";
import { PUSD_ADDRESS } from "./contracts.ts";

const POLYGON_DEPOSIT_ADDRESS = "0x1111111111111111111111111111111111111111";
const PROXY_ADDRESS = "0x2222222222222222222222222222222222222222";
const POLYGON_USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const POLYGON_USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

test("resolveWalletDepositRoute deposits Polygon pUSD directly to the recipient wallet", () => {
  const route = resolveWalletDepositRoute({
    chainId: "137",
    tokenSymbol: "pUSD",
    tokenAddress: PUSD_ADDRESS,
    recipientAddress: PROXY_ADDRESS,
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
    ],
    depositAddresses: [
      {
        chainId: "137",
        chainName: "Polygon",
        tokenAddress: POLYGON_USDC_ADDRESS,
        tokenSymbol: "USDC",
        depositAddress: POLYGON_DEPOSIT_ADDRESS,
      },
    ],
  });

  assert.deepEqual(route, {
    kind: "direct",
    depositAddress: PROXY_ADDRESS,
    minUsd: 0,
  });
});

test("resolveWalletDepositRoute deposits Polygon pUSD directly without bridge support", () => {
  const route = resolveWalletDepositRoute({
    chainId: "137",
    tokenSymbol: "pUSD",
    tokenAddress: PUSD_ADDRESS,
    recipientAddress: PROXY_ADDRESS,
    supportedAssets: [],
    depositAddresses: [
      {
        chainId: "137",
        chainName: "Polygon",
        tokenAddress: POLYGON_USDC_ADDRESS,
        tokenSymbol: "USDC",
        depositAddress: POLYGON_DEPOSIT_ADDRESS,
      },
    ],
  });

  assert.deepEqual(route, {
    kind: "direct",
    depositAddress: PROXY_ADDRESS,
    minUsd: 0,
  });
});

test("resolveWalletDepositRoute rejects non-pUSD tokens that are not bridge supported", () => {
  const route = resolveWalletDepositRoute({
    chainId: "137",
    tokenSymbol: "DOGE",
    tokenAddress: "0x3333333333333333333333333333333333333333",
    recipientAddress: PROXY_ADDRESS,
    supportedAssets: [],
    depositAddresses: [
      {
        chainId: "137",
        chainName: "Polygon",
        tokenAddress: POLYGON_USDC_ADDRESS,
        tokenSymbol: "USDC",
        depositAddress: POLYGON_DEPOSIT_ADDRESS,
      },
    ],
  });

  assert.equal(route, null);
});

test("getMinDepositForToken has no bridge minimum for direct pUSD deposits", () => {
  assert.equal(getMinDepositForToken([], "pUSD"), 0);
});

test("resolveDestTokenAddress resolves Polygon USDC and ignores pUSD", () => {
  const index = buildBridgeTokenIndex([
    {
      chainId: "137",
      token: {
        symbol: "pUSD",
        address: PUSD_ADDRESS,
      },
    },
    {
      chainId: "137",
      token: {
        symbol: "USDC",
        address: POLYGON_USDC_ADDRESS,
      },
    },
    {
      chainId: "137",
      token: {
        symbol: "USDC.e",
        address: POLYGON_USDC_E_ADDRESS,
      },
    },
  ]);

  assert.equal(
    resolveDestTokenAddress(index, "137", "usdc"),
    POLYGON_USDC_ADDRESS
  );
  assert.equal(
    resolveDestTokenAddress(index, "137", "usdc-e"),
    POLYGON_USDC_E_ADDRESS
  );
});

test("validateWithdrawBridgeDestination rejects pUSD as the receive token", () => {
  assert.throws(
    () => validateWithdrawBridgeDestination({ toTokenAddress: PUSD_ADDRESS }),
    /Resolved withdrawal destination is pUSD/
  );
});

test("validateWithdrawBridgeDestination rejects direct recipient pUSD transfers", () => {
  assert.throws(
    () =>
      validateWithdrawBridgeDestination({
        bridgeAddress: POLYGON_DEPOSIT_ADDRESS,
        recipientAddress: POLYGON_DEPOSIT_ADDRESS,
        sourceAddress: PROXY_ADDRESS,
      }),
    /Bridge returned the recipient address/
  );
});

test("validateWithdrawBridgeDestination allows a bridge address for USDC", () => {
  assert.doesNotThrow(() =>
    validateWithdrawBridgeDestination({
      toTokenAddress: POLYGON_USDC_ADDRESS,
      bridgeAddress: POLYGON_DEPOSIT_ADDRESS,
      recipientAddress: "0x3333333333333333333333333333333333333333",
      sourceAddress: PROXY_ADDRESS,
    })
  );
});
