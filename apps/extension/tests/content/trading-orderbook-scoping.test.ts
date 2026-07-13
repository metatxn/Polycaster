import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { PanelOptions } from "../../src/content/trading/panel/panel-state";

const bridge = vi.hoisted(() => ({
  accountsAdded: [] as Array<(accounts: string[]) => void>,
}));

vi.mock("../../src/content/trading/bridge", () => ({
  WalletBridge: {
    onAccountsChanged: (listener: (accounts: string[]) => void) => {
      bridge.accountsAdded.push(listener);
      return () => undefined;
    },
    resetAfterDisconnect: () => undefined,
  },
}));

type RuntimeResponse = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

type PendingMessage = {
  message: Record<string, unknown>;
  respond(response: RuntimeResponse): void;
};

const pendingMessages: PendingMessage[] = [];

beforeEach(() => {
  pendingMessages.length = 0;
  bridge.accountsAdded.length = 0;
  vi.stubGlobal("__DEV_MODE__", false);
  vi.stubGlobal("window", {});
  vi.stubGlobal("chrome", {
    runtime: {
      lastError: undefined,
      onMessage: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
      sendMessage: (
        message: Record<string, unknown>,
        callback: (response: RuntimeResponse) => void
      ) => {
        pendingMessages.push({ message, respond: callback });
      },
    },
  });
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

test("late order-book responses cannot replace the selected token's book", async () => {
  const { TradingService } = await import(
    "../../src/content/trading/trading-service"
  );

  const staleRequest = TradingService.fetchOrderBook("eliminated-team-token");
  const selectedRequest = TradingService.fetchOrderBook("france-token");

  assert.equal(pendingMessages.length, 2);
  assert.equal(TradingService.getContext().orderBookTokenId, "france-token");
  assert.equal(TradingService.getContext().orderBook, null);

  pendingMessages[1].respond({
    ok: true,
    data: {
      bids: [{ price: "0.392", size: "100" }],
      asks: [{ price: "0.393", size: "100" }],
      min_order_size: "5",
      tick_size: "0.001",
    },
  });
  await selectedRequest;

  pendingMessages[0].respond({
    ok: true,
    data: {
      bids: [{ price: "0.001", size: "100000" }],
      asks: [{ price: "0.001", size: "100000" }],
      min_order_size: "5",
      tick_size: "0.001",
    },
  });
  await staleRequest;

  const context = TradingService.getContext();
  assert.equal(context.orderBookTokenId, "france-token");
  assert.equal(context.orderBook?.asks[0]?.price, "0.393");
});

test("a completed refresh is rejected after the panel identity changes", async () => {
  const {
    capturePanelOrderBookRequest,
    isPanelOrderBookRequestCurrent,
    panelState,
  } = await import("../../src/content/trading/panel/panel-state");

  const firstPanel = {} as HTMLElement;
  const secondPanel = {} as HTMLElement;
  const firstOptions = {
    tokenId: "eliminated-team-token",
    yesTokenId: "eliminated-team-token",
    noTokenId: "eliminated-team-no-token",
  } as PanelOptions;
  const secondOptions = {
    tokenId: "france-token",
    yesTokenId: "france-token",
    noTokenId: "france-no-token",
  } as PanelOptions;

  panelState.activePanel = firstPanel;
  panelState.panelOpts = firstOptions;
  panelState.selectedOutcome = "yes";
  const request = capturePanelOrderBookRequest();
  assert.ok(request);

  panelState.activePanel = secondPanel;
  panelState.panelOpts = secondOptions;

  assert.equal(isPanelOrderBookRequestCurrent(request), false);
});

test("market panels distinguish a pending order book from empty liquidity", async () => {
  const { getMarketOrderBookStatus } = await import(
    "../../src/content/trading/panel/order-view"
  );
  const options = { tokenId: "selected-token" } as PanelOptions;

  assert.equal(
    getMarketOrderBookStatus(
      {
        orderBookTokenId: "previous-token",
        orderBook: { bids: [], asks: [] },
        orderBookError: null,
      },
      options
    ),
    "loading"
  );
  assert.equal(
    getMarketOrderBookStatus(
      {
        orderBookTokenId: "selected-token",
        orderBook: null,
        orderBookError: null,
      },
      options
    ),
    "loading"
  );
  assert.equal(
    getMarketOrderBookStatus(
      {
        orderBookTokenId: "selected-token",
        orderBook: { bids: [], asks: [] },
        orderBookError: null,
      },
      options
    ),
    "ready"
  );
  assert.equal(
    getMarketOrderBookStatus(
      {
        orderBookTokenId: "selected-token",
        orderBook: { bids: [], asks: [] },
        orderBookError: "No orderbook exists for the requested token id",
      },
      options
    ),
    "unavailable"
  );
});
