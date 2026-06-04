import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBridgeTokenIndex,
  DEFAULT_BUILDER_CODE,
  getAvailableTokensForChain,
  getBridgeHeaders,
  getMinDepositForToken,
  getMinWithdrawalForToken,
  getWithdrawExecutionRoute,
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

test("resolveWalletDepositRoute rejects a token-specific deposit address for a different token", () => {
  const route = resolveWalletDepositRoute({
    chainId: "137",
    tokenSymbol: "USDC.e",
    tokenAddress: POLYGON_USDC_E_ADDRESS,
    recipientAddress: PROXY_ADDRESS,
    supportedAssets: [
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

test("getBridgeHeaders falls back to the default builder code when none is provided", () => {
  assert.equal(getBridgeHeaders()["X-Builder-Code"], DEFAULT_BUILDER_CODE);
  assert.equal(getBridgeHeaders({})["X-Builder-Code"], DEFAULT_BUILDER_CODE);
  assert.equal(
    getBridgeHeaders({ builderCode: "" })["X-Builder-Code"],
    DEFAULT_BUILDER_CODE
  );
});

test("getBridgeHeaders prefers an explicit builder code over the default", () => {
  const headers = getBridgeHeaders({ builderCode: "0xcustom" });
  assert.equal(headers["X-Builder-Code"], "0xcustom");
});

test("getBridgeHeaders merges caller headers and always sets the builder code", () => {
  const headers = getBridgeHeaders(
    { headers: { Authorization: "Bearer t" } },
    { "Content-Type": "application/json" }
  );
  assert.equal(headers.Authorization, "Bearer t");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["X-Builder-Code"], DEFAULT_BUILDER_CODE);
});

test("getMinDepositForToken has no bridge minimum for direct pUSD deposits", () => {
  assert.equal(getMinDepositForToken([], "pUSD"), 0);
});

test("getMinWithdrawalForToken reads the live minimum for the selected destination token", () => {
  assert.equal(
    getMinWithdrawalForToken(
      [
        {
          chainId: "137",
          chainName: "Polygon",
          token: {
            name: "USD Coin",
            symbol: "USDC",
            address: POLYGON_USDC_ADDRESS,
            decimals: 6,
          },
          minCheckoutUsd: 3,
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
          minCheckoutUsd: 7,
        },
      ],
      "137",
      "usdc-e"
    ),
    7
  );
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

test("buildBridgeTokenIndex exposes pUSD when the bridge supports it", () => {
  const index = buildBridgeTokenIndex([
    {
      chainId: "137",
      token: {
        symbol: "pUSD",
        address: PUSD_ADDRESS,
      },
    },
  ]);

  assert.equal(resolveDestTokenAddress(index, "137", "pusd"), PUSD_ADDRESS);
  assert.deepEqual(getAvailableTokensForChain(index, "polygon"), [
    "usdc",
    "usdc-e",
    "pusd",
  ]);
});

test("validateWithdrawBridgeDestination allows explicit pUSD bridge routes", () => {
  assert.doesNotThrow(() =>
    validateWithdrawBridgeDestination({
      routeKind: "bridge",
      toTokenAddress: PUSD_ADDRESS,
      bridgeAddress: POLYGON_DEPOSIT_ADDRESS,
      recipientAddress: "0x3333333333333333333333333333333333333333",
      sourceAddress: PROXY_ADDRESS,
    })
  );
});

test("getWithdrawExecutionRoute sends Polygon USDC.e directly to the EOA", () => {
  const index = buildBridgeTokenIndex([
    {
      chainId: "137",
      token: {
        symbol: "USDC.e",
        address: POLYGON_USDC_E_ADDRESS,
      },
    },
  ]);

  assert.deepEqual(
    getWithdrawExecutionRoute({
      bridgeTokenIndex: index,
      chainKey: "polygon",
      tokenId: "usdc-e",
    }),
    {
      kind: "direct",
      chainKey: "polygon",
      tokenId: "usdc-e",
      toChainId: "137",
      tokenAddress: POLYGON_USDC_E_ADDRESS,
      tokenSymbol: "USDC.e",
      tokenDecimals: 6,
    }
  );
});

test("getWithdrawExecutionRoute sends pUSD through the bridge", () => {
  const index = buildBridgeTokenIndex([
    {
      chainId: "137",
      token: {
        symbol: "pUSD",
        address: PUSD_ADDRESS,
      },
    },
  ]);

  assert.deepEqual(
    getWithdrawExecutionRoute({
      bridgeTokenIndex: index,
      chainKey: "polygon",
      tokenId: "pusd",
    }),
    {
      kind: "bridge",
      chainKey: "polygon",
      tokenId: "pusd",
      toChainId: "137",
      tokenAddress: PUSD_ADDRESS,
      tokenSymbol: "pUSD",
      tokenDecimals: 6,
    }
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
