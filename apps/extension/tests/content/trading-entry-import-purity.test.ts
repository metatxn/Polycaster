import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const observations = {
  chromeCalls: 0,
  domMutations: 0,
  storageCalls: 0,
  timers: 0,
  windowListeners: 0,
};
const WALLETCONNECT_STATE_KEY = "__KNOWW_WALLETCONNECT_BRIDGE_STATE__";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>)[WALLETCONNECT_STATE_KEY];
  for (const key of Object.keys(observations) as Array<
    keyof typeof observations
  >) {
    observations[key] = 0;
  }

  vi.stubGlobal("__DEV_MODE__", false);
  vi.stubGlobal("window", {
    addEventListener: () => {
      observations.windowListeners += 1;
    },
    location: { origin: "https://example.test" },
  });
  vi.stubGlobal("document", {
    addEventListener: () => {
      observations.windowListeners += 1;
    },
    body: {
      appendChild: () => {
        observations.domMutations += 1;
      },
    },
    createElement: () => {
      observations.domMutations += 1;
      return {};
    },
  });
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: () => {
          observations.chromeCalls += 1;
        },
      },
      sendMessage: () => {
        observations.chromeCalls += 1;
        return Promise.resolve();
      },
    },
    storage: {
      local: {
        get: () => {
          observations.storageCalls += 1;
          return Promise.resolve({});
        },
        set: () => {
          observations.storageCalls += 1;
          return Promise.resolve();
        },
      },
    },
  });
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[WALLETCONNECT_STATE_KEY];
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("importing the real trading entry does not install browser side effects", async () => {
  const nativeSetTimeout = globalThis.setTimeout;
  const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    ...args: Parameters<typeof setTimeout>
  ) => {
    observations.timers += 1;
    return nativeSetTimeout(...args);
  }) as typeof setTimeout);

  assert.equal(WALLETCONNECT_STATE_KEY in globalThis, false);
  const entry = await import("../../src/content/trading/trading-entry");
  await Promise.resolve();

  assert.equal(typeof entry.createTradingRuntime, "function");
  assert.equal(WALLETCONNECT_STATE_KEY in globalThis, false);
  assert.deepEqual(observations, {
    chromeCalls: 0,
    domMutations: 0,
    storageCalls: 0,
    timers: 0,
    windowListeners: 0,
  });
  timeoutSpy.mockRestore();
});
