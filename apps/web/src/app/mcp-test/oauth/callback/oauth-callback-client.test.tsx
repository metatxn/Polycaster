import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthCallbackClient } from "./oauth-callback-client";

class TestBroadcastChannel extends EventTarget {
  static instances: TestBroadcastChannel[] = [];

  readonly close = vi.fn();
  readonly postMessage = vi.fn();

  constructor(readonly name: string) {
    super();
    TestBroadcastChannel.instances.push(this);
  }
}

afterEach(() => {
  TestBroadcastChannel.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("OAuthCallbackClient", () => {
  it("returns the OAuth response when the browser removes window.opener", async () => {
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: null,
    });
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    window.history.replaceState(
      {},
      "",
      "/mcp-test/oauth/callback?code=authorization-code&state=expected-state"
    );

    render(<OAuthCallbackClient />);

    await waitFor(() => {
      expect(TestBroadcastChannel.instances).toHaveLength(1);
      expect(
        TestBroadcastChannel.instances[0]?.postMessage
      ).toHaveBeenCalledWith({
        type: "knoww-mcp-oauth-callback",
        params: {
          code: "authorization-code",
          state: "expected-state",
        },
      });
    });
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});
