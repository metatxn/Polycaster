import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";

declare const process: { cwd(): string };

const lifecycle = vi.hoisted(() => ({
  bridgeDispose: 0,
  bridgeInit: 0,
  cancel: 0,
  glueDispose: 0,
  glueInit: 0,
  handleDispose: 0,
  hide: 0,
  serviceDispose: 0,
  serviceInstall: 0,
  signingDispose: 0,
  signingInstall: 0,
}));

vi.mock("../../src/content/trading/bridge", () => ({
  delegateSigningRequest: () => false,
  WalletBridge: {
    init: () => {
      lifecycle.bridgeInit += 1;
      return () => {
        lifecycle.bridgeDispose += 1;
      };
    },
  },
  installSigningLifecycle: () => {
    lifecycle.signingInstall += 1;
    return () => {
      lifecycle.signingDispose += 1;
    };
  },
}));

vi.mock("../../src/content/trading/trading-service", () => ({
  installTradingServiceListeners: () => {
    lifecycle.serviceInstall += 1;
    return () => {
      lifecycle.serviceDispose += 1;
    };
  },
}));

vi.mock("../../src/content/trading/trading-glue", () => ({
  cancelWalletConnect: async () => {
    lifecycle.cancel += 1;
  },
  cancelWalletConnectSync: () => {
    lifecycle.cancel += 1;
  },
  disposeTradingGlue: () => {
    lifecycle.glueDispose += 1;
  },
  getWalletConnectStateSync: () => ({
    status: "idle",
    error: null,
    qrSvg: null,
  }),
  handlePortfolioMessage: () => false,
  hideTradingPanel: () => {
    lifecycle.hide += 1;
  },
  hydrateStreamBet: () => ({
    dispose: () => {
      lifecycle.handleDispose += 1;
    },
  }),
  initializeTradingGlue: () => {
    lifecycle.glueInit += 1;
  },
  openTradingPanel: () => {},
}));

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

beforeEach(() => {
  for (const key of Object.keys(lifecycle) as Array<keyof typeof lifecycle>) {
    lifecycle[key] = 0;
  }
});

afterEach(() => {
  vi.resetModules();
});

test("trading-service and bridge expose installers instead of registering listeners at module scope", () => {
  const service = readSource("src/content/trading/trading-service.ts");
  const bridge = readSource("src/content/trading/bridge.ts");
  const glue = readSource("src/content/trading/trading-glue.ts");

  assert.match(service, /export function installTradingServiceListeners\(/);
  assert.match(
    service,
    /removeAccountsChangedListener\s*=\s*WalletBridge\.onAccountsChanged\(\s*handleWalletAccountsChanged\s*\)/
  );
  assert.match(service, /removeAccountsChangedListener\?\.\(\)/);
  assert.doesNotMatch(
    service,
    /\nif \(typeof chrome !== "undefined" && chrome\.runtime\?\.onMessage\) \{[\s\S]*$/
  );
  assert.match(bridge, /export function handleSigningRequest\(/);
  assert.match(bridge, /export function installSigningListener\(/);
  assert.match(bridge, /export function installSigningLifecycle\(/);
  assert.doesNotMatch(
    bridge.match(/function init\(\):[\s\S]*?\n\}/)?.[0] ?? "",
    /chrome\.runtime\.onMessage\.addListener/
  );
  assert.match(
    glue,
    /function disposeTradingGlue\(\): void \{\s*TradingPanel\.closeInlineDeposit\(\);\s*TradingPanel\.hide\(\);/
  );
});

test("createTradingRuntime is cached while alive and installs each lifecycle exactly once", async () => {
  const { createTradingRuntime } = await import(
    "../../src/content/trading/trading-entry"
  );

  assert.deepEqual(lifecycle, {
    bridgeDispose: 0,
    bridgeInit: 0,
    cancel: 0,
    glueDispose: 0,
    glueInit: 0,
    handleDispose: 0,
    hide: 0,
    serviceDispose: 0,
    serviceInstall: 0,
    signingDispose: 0,
    signingInstall: 0,
  });

  const first = createTradingRuntime();
  const second = createTradingRuntime();

  assert.equal(second, first);
  assert.equal(lifecycle.bridgeInit, 1);
  assert.equal(lifecycle.serviceInstall, 1);
  assert.equal(lifecycle.signingInstall, 1);
  assert.equal(lifecycle.glueInit, 1);
});

test("dispose is idempotent, tears down hydrated widgets, and allows sound recreation", async () => {
  const { createTradingRuntime } = await import(
    "../../src/content/trading/trading-entry"
  );
  const runtime = createTradingRuntime();
  const host = {} as HTMLElement;
  const market = { id: "market-1", title: "Market" } as never;

  const handle = runtime.hydrateStreamBet(host, {
    market,
    ui: { setInlineDepositActive: () => {}, showToast: () => {} },
  });
  handle.dispose();
  handle.dispose();
  runtime.hideTradingPanel();
  runtime.cancelWalletConnectSync();
  runtime.dispose();
  runtime.dispose();

  assert.equal(lifecycle.handleDispose, 1);
  assert.equal(lifecycle.hide, 1);
  assert.equal(lifecycle.cancel, 1);
  assert.equal(lifecycle.glueDispose, 1);
  assert.equal(lifecycle.serviceDispose, 1);
  assert.equal(lifecycle.signingDispose, 1);
  assert.equal(lifecycle.bridgeDispose, 1);

  const recreated = createTradingRuntime();
  assert.notEqual(recreated, runtime);
  assert.equal(lifecycle.bridgeInit, 2);
  assert.equal(lifecycle.serviceInstall, 2);
  assert.equal(lifecycle.signingInstall, 2);
  assert.equal(lifecycle.glueInit, 2);

  recreated.dispose();
});

test("the core-safe runtime contract has only type imports from trading-free leaves", () => {
  const source = readSource("src/content/trading-runtime-types.ts");
  const imports = [
    ...source.matchAll(/^import\s+(.+?)\s+from\s+["'](.+?)["'];?$/gm),
  ];

  assert.ok(imports.length > 0, "expected the Market type dependency");
  for (const [, clause, specifier] of imports) {
    assert.match(clause, /^type\b|^\{\s*type\b/);
    assert.equal(specifier.includes("/trading/"), false);
  }
  assert.match(source, /interface TradingRuntime/);
  assert.match(source, /hydrateStreamBet\(/);
  assert.match(source, /dispose\(\): void/);
});
