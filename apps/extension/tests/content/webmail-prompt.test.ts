// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://outlook.live.com/mail/"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installUnsupportedSitePrompt,
  mountUnsupportedSitePrompt,
} from "../../src/content/unsupported-site-prompt";
import { OPEN_SITE_SUPPORT_PROMPT_MESSAGE } from "../../src/site-support";

const root = () => document.getElementById("knoww-site-support-prompt-root");
const storage = {
  get: vi.fn(
    (_key: string, callback: (result: Record<string, unknown>) => void) =>
      callback({})
  ),
  set: vi.fn(),
};
const send = vi.fn();
let dispose: (() => void) | undefined;

beforeEach(() => {
  window.history.replaceState(null, "", "/mail/");
  document.body.replaceChildren();
  root()?.remove();
  vi.clearAllMocks();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  root()?.remove();
  vi.unstubAllGlobals();
});

describe("webmail prompt lifecycle", () => {
  it("does not read storage, send messages, or render on mail routes", async () => {
    expect(await mountUnsupportedSitePrompt({ storage, send })).toBeNull();
    expect(storage.get).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(root()).toBeNull();
  });

  it("cannot be revealed by a toolbar message while in mail", async () => {
    const runtimeMessages = { addListener: vi.fn() };
    dispose = installUnsupportedSitePrompt({ storage, send, runtimeMessages });
    const listener = runtimeMessages.addListener.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf("function");
    listener({ type: OPEN_SITE_SUPPORT_PROMPT_MESSAGE, reveal: true }, vi.fn());
    await Promise.resolve();
    expect(root()).toBeNull();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("removes an existing prompt on SPA entry and restores it after leaving mail", async () => {
    window.history.replaceState(null, "", "/calendar");
    const navigation = new EventTarget();
    vi.stubGlobal("navigation", navigation);
    dispose = installUnsupportedSitePrompt({
      storage,
      send,
      runtimeMessages: { addListener: vi.fn() },
    });
    await Promise.resolve();
    expect(root()).not.toBeNull();

    window.history.pushState(null, "", "/mail/inbox");
    navigation.dispatchEvent(new Event("currententrychange"));
    expect(root()).toBeNull();
    window.history.replaceState(null, "", "/mail/sent");
    navigation.dispatchEvent(new Event("currententrychange"));
    await Promise.resolve();
    expect(root()).toBeNull();

    window.history.pushState(null, "", "/calendar");
    navigation.dispatchEvent(new Event("currententrychange"));
    await Promise.resolve();
    expect(root()).not.toBeNull();
  });

  it("checks the URL again after a delayed storage read", async () => {
    window.history.replaceState(null, "", "/calendar");
    let resolveStorage!: (result: Record<string, unknown>) => void;
    const pending = mountUnsupportedSitePrompt({
      send,
      storage: {
        ...storage,
        get: (_key, callback) => {
          resolveStorage = callback;
        },
      },
    });
    window.history.pushState(null, "", "/mail/inbox");
    resolveStorage({});
    expect(await pending).toBeNull();
    expect(root()).toBeNull();
  });

  it("handles back/forward and the DOM fallback without patching page history", async () => {
    window.history.replaceState(null, "", "/calendar");
    vi.stubGlobal("navigation", undefined);
    dispose = installUnsupportedSitePrompt({
      storage,
      send,
      runtimeMessages: { addListener: vi.fn() },
    });
    await Promise.resolve();
    expect(root()).not.toBeNull();
    window.history.pushState(null, "", "/mail/inbox");
    document.body.append(document.createElement("main"));
    await Promise.resolve();
    expect(root()).toBeNull();
    window.history.replaceState(null, "", "/calendar");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await Promise.resolve();
    expect(root()).not.toBeNull();
  });
});
