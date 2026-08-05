import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import type { TradingRuntime } from "../../src/content/trading-runtime-types";

declare const process: { cwd(): string };

function runtime(label: string): TradingRuntime {
  return {
    openTradingPanel: () => {},
    hideTradingPanel: () => {},
    hydrateStreamBet: () => ({ dispose: () => {} }),
    handlePortfolioMessage: () => false,
    handleSigningRequest: () => false,
    getWalletConnectStateSync: () => ({
      status: label,
      error: null,
      qrSvg: null,
    }),
    cancelWalletConnect: async () => {},
    cancelWalletConnectSync: () => {},
    dispose: () => {},
  };
}

async function freshLoader() {
  vi.resetModules();
  return import("../../src/content/trading-loader");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test("loadTradingRuntime shares one in-flight import and caches its runtime", async () => {
  const loader = await freshLoader();
  const expected = runtime("loaded");
  let resolveImport!: (entry: {
    createTradingRuntime(): TradingRuntime;
  }) => void;
  const importEntry = vi.fn(
    () =>
      new Promise<{ createTradingRuntime(): TradingRuntime }>((resolve) => {
        resolveImport = resolve;
      })
  );

  const first = loader.loadTradingRuntime(importEntry);
  const second = loader.loadTradingRuntime(importEntry);
  assert.equal(first, second);
  assert.equal(importEntry.mock.calls.length, 1);
  assert.equal(loader.getLoadedRuntime(), null);

  resolveImport({ createTradingRuntime: () => expected });
  assert.equal(await first, expected);
  assert.equal(loader.getLoadedRuntime(), expected);
  assert.equal(await loader.loadTradingRuntime(importEntry), expected);
  assert.equal(importEntry.mock.calls.length, 1);
});

test("a failed import clears the in-flight slot so a later call can retry", async () => {
  const loader = await freshLoader();
  const expected = runtime("retry");
  const importEntry = vi
    .fn<() => Promise<{ createTradingRuntime(): TradingRuntime }>>()
    .mockRejectedValueOnce(new Error("chunk unavailable"))
    .mockResolvedValueOnce({ createTradingRuntime: () => expected });

  await assert.rejects(
    loader.loadTradingRuntime(importEntry),
    /chunk unavailable/
  );
  assert.equal(loader.getLoadedRuntime(), null);
  assert.equal(await loader.loadTradingRuntime(importEntry), expected);
  assert.equal(importEntry.mock.calls.length, 2);
});

test("adoptLoadedTradingRuntime installs the eager runtime and rejects conflicts", async () => {
  const loader = await freshLoader();
  const eager = runtime("eager");
  const other = runtime("other");
  const importEntry = vi.fn();

  assert.equal(loader.adoptLoadedTradingRuntime(eager), eager);
  assert.equal(loader.adoptLoadedTradingRuntime(eager), eager);
  assert.equal(loader.getLoadedRuntime(), eager);
  assert.equal(await loader.loadTradingRuntime(importEntry), eager);
  assert.equal(importEntry.mock.calls.length, 0);
  assert.throws(
    () => loader.adoptLoadedTradingRuntime(other),
    /different trading runtime/i
  );
});

test("adoption is rejected while a dynamic import is in flight", async () => {
  const loader = await freshLoader();
  const imported = runtime("imported");
  let resolveImport!: (entry: {
    createTradingRuntime(): TradingRuntime;
  }) => void;
  const loading = loader.loadTradingRuntime(
    () =>
      new Promise((resolve) => {
        resolveImport = resolve;
      })
  );

  assert.throws(
    () => loader.adoptLoadedTradingRuntime(runtime("eager")),
    /in flight/i
  );
  resolveImport({ createTradingRuntime: () => imported });
  assert.equal(await loading, imported);
});

test.each([
  [true, 1],
  [false, 0],
  [undefined, 0],
  ["true", 0],
] as const)(
  "prefetchTradingRuntime loads only when the shared warm flag is exactly true (%j)",
  async (storedValue, expectedImports) => {
    const storageGet = vi.fn().mockResolvedValue({
      knowwTradingWarmEligible: storedValue,
    });
    vi.stubGlobal("chrome", {
      storage: { local: { get: storageGet } },
      runtime: { getURL: (path: string) => path },
    });
    const loader = await freshLoader();
    const importEntry = vi.fn().mockResolvedValue({
      createTradingRuntime: () => runtime("prefetched"),
    });

    loader.prefetchTradingRuntime(importEntry);
    await vi.waitFor(() => {
      assert.equal(importEntry.mock.calls.length, expectedImports);
    });
    assert.deepEqual(storageGet.mock.calls[0], ["knowwTradingWarmEligible"]);
  }
);

test("the default loader keeps webpack from bundling the runtime import", () => {
  const source = readFileSync(
    join(process.cwd(), "src/content/trading-loader.ts"),
    "utf8"
  );
  assert.match(
    source,
    /import\(\/\* webpackIgnore: true \*\/ chrome\.runtime\.getURL\(RUNTIME_ASSET\)\)/
  );
  assert.match(
    source,
    /const RUNTIME_ASSET = __STORE_BUILD__\s*\?\s*"content-wallet\.js"\s*:\s*"content-trading\.js";/
  );
  assert.doesNotMatch(source, /loadTradingRuntime\(\);/);
});
