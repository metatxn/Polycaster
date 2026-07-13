// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@knoww/logger", () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

beforeEach(() => {
  vi.resetModules();
  document.documentElement.replaceChildren(document.head, document.body);
  document.head.replaceChildren();
  document.body.replaceChildren();
  Reflect.deleteProperty(window, "__KNOWW_BRIDGE_NONCE__");
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("page-bridge load requests wallet discovery once with the installed nonce", async () => {
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
    "00000000-0000-4000-8000-000000000123"
  );
  const postMessage = vi.spyOn(window, "postMessage");
  const { KNOWW_STYLES } = await import("../../src/content/styles");

  KNOWW_STYLES.injectMetamaskBridge();
  const script =
    document.querySelector<HTMLScriptElement>("#knoww-page-bridge");
  expect(script).not.toBeNull();
  expect(script?.dataset.knowwNonce).toBe(
    "00000000-0000-4000-8000-000000000123"
  );
  expect(window.__KNOWW_BRIDGE_NONCE__).toBe(script?.dataset.knowwNonce);

  script?.dispatchEvent(new Event("load"));
  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(postMessage).toHaveBeenCalledWith(
    {
      type: "KNOWW_LIST_WALLETS",
      _n: "00000000-0000-4000-8000-000000000123",
    },
    window.location.origin
  );
  script?.dispatchEvent(new Event("load"));
  expect(postMessage).toHaveBeenCalledTimes(1);
});
