import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  fetchCalls: 0,
  shownOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../src/content/trading/trading-panel", () => ({
  TradingPanel: {
    show: (options: Record<string, unknown>) =>
      runtime.shownOptions.push(options),
  },
}));

vi.mock("../../src/content/trading/trading-service", () => ({
  TradingService: {
    getContext: () => ({}),
  },
}));

vi.mock("../../src/content/trading/bridge", () => ({
  WALLETCONNECT_WALLET_UUID: "walletconnect",
  WalletBridge: {},
}));

vi.mock("../../src/content/trading/extension-session", () => ({
  ExtensionSession: {},
}));

vi.mock("../../src/content/trading/setup-gates", () => ({
  isTradingWalletDeploymentRequired: () => false,
}));

vi.mock("../../src/content/ui/stream-bet-ui", () => ({
  buildStreamBetting: () => ({}),
  configureStreamTradingPort: () => undefined,
  disposeStreamBetting: () => undefined,
  resetStreamTradingPort: () => undefined,
}));

vi.mock("../../src/content/trading/walletconnect-qr", () => ({
  renderWalletConnectQrSvg: () => "",
}));

beforeEach(() => {
  runtime.fetchCalls = 0;
  runtime.shownOptions.length = 0;
  vi.stubGlobal("window", {
    KNOWW_API: {
      fetchClobTokenIds: async () => {
        runtime.fetchCalls += 1;
        return "live-england-yes";
      },
    },
    KNOWW_ANALYTICS: { track: async () => undefined },
    KNOWW_UTILS: {
      log: () => undefined,
      safeSendMessage: async () => ({ ok: true }),
    },
  });
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

test("refreshes a present Polymarket token before opening the trading panel", async () => {
  const { openTradingPanel } = await import(
    "../../src/content/trading/trading-glue"
  );
  const anchor = {
    closest: () => null,
    style: { opacity: "", pointerEvents: "" },
  } as unknown as HTMLElement;

  openTradingPanel({
    market: {
      id: "30615",
      title: "World Cup Winner",
      slug: "world-cup-winner",
      source: "polymarket",
      markets: [
        {
          conditionId: "condition-england",
          clobTokenIds: '["stale-england-yes","stale-england-no"]',
        },
      ],
    },
    outcomeName: "England",
    outcomeIndex: 0,
    price: 0.21,
    anchorElement: anchor,
    isMultiOutcome: true,
    marketIndex: 0,
  });

  await vi.waitFor(() => assert.equal(runtime.shownOptions.length, 1));

  assert.equal(runtime.fetchCalls, 1);
  assert.equal(runtime.shownOptions[0]?.tokenId, "live-england-yes");
});
