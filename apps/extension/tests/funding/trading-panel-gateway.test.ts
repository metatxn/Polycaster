// apps/extension/tests/funding/trading-panel-gateway.test.ts
// Regression coverage for the trading-panel gateway's deposit-address cache:
// bridge deposit addresses are minted FOR a specific proxy, so the cache must
// be keyed by the proxy it was minted for. Before the fix, an account switch
// while the panel stayed open kept serving the PREVIOUS account's bridge
// addresses — money sent there credits the wrong proxy.
import type { DepositAddress } from "@knoww/shared-types/bridge";
import { describe, expect, it, vi } from "vitest";
import {
  createTradingPanelFundingGateway,
  type TradingPanelFundingGatewayDeps,
} from "../../src/funding/gateways/trading-panel-gateway";
import type { FundingBridgeAsset } from "../../src/funding/types";

const PROXY_A = `0x${"a".repeat(40)}`;
const PROXY_B = `0x${"b".repeat(40)}`;

const BRIDGE_ASSET: FundingBridgeAsset = {
  chainId: "1",
  chainName: "Ethereum",
  symbol: "ETH",
  name: "Ether",
  address: `0x${"e".repeat(40)}`,
  decimals: 18,
  minCheckoutUsd: "2",
};

function depositAddressFor(proxy: string): DepositAddress {
  return {
    chainId: "1",
    chainName: "Ethereum",
    tokenAddress: `0x${"e".repeat(40)}`,
    tokenSymbol: "ETH",
    depositAddress: `0xdeposit-for-${proxy.slice(-4)}`,
  };
}

function createGateway(getProxyAddress: () => string | null) {
  const createDepositAddresses = vi.fn(async (proxy: string) => [
    depositAddressFor(proxy),
  ]);
  const deps: TradingPanelFundingGatewayDeps = {
    sendRuntimeMessage: async () => ({ ok: true, data: null }),
    loadWalletTokens: async () => [],
    fetchSupportedAssets: async () => [],
    createDepositAddresses,
    fetchBridgeQuote: async () => {
      throw new Error("not exercised by this test");
    },
    getProxyAddress,
    waitForTxReceipt: async () => "success",
    awaitBalanceCredit: async () => {},
  };
  return {
    gateway: createTradingPanelFundingGateway(deps),
    createDepositAddresses,
  };
}

describe("trading-panel gateway deposit-address cache", () => {
  it("reuses cached deposit addresses while the proxy is unchanged", async () => {
    const { gateway, createDepositAddresses } = createGateway(() => PROXY_A);
    await gateway.resolveBridgeAddress(BRIDGE_ASSET);
    await gateway.resolveBridgeAddress(BRIDGE_ASSET);
    expect(createDepositAddresses).toHaveBeenCalledTimes(1);
    expect(createDepositAddresses).toHaveBeenCalledWith(PROXY_A);
  });

  it("re-mints deposit addresses when the proxy changes instead of serving the previous account's", async () => {
    let proxy = PROXY_A;
    const { gateway, createDepositAddresses } = createGateway(() => proxy);

    const first = await gateway.resolveBridgeAddress(BRIDGE_ASSET);
    expect(first).toBe(depositAddressFor(PROXY_A).depositAddress);

    proxy = PROXY_B;
    const second = await gateway.resolveBridgeAddress(BRIDGE_ASSET);
    expect(second).toBe(depositAddressFor(PROXY_B).depositAddress);
    expect(createDepositAddresses).toHaveBeenCalledTimes(2);
    expect(createDepositAddresses).toHaveBeenLastCalledWith(PROXY_B);
  });
});
