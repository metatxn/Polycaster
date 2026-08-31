import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOAuthCallbackMessage,
  listenForOAuthCallbackBroadcast,
  parseOAuthCallbackMessage,
} from "./mcp-oauth-callback";

class TestBroadcastChannel extends EventTarget {
  static instances: TestBroadcastChannel[] = [];

  readonly close = vi.fn();

  constructor(readonly name: string) {
    super();
    TestBroadcastChannel.instances.push(this);
  }
}

afterEach(() => {
  TestBroadcastChannel.instances = [];
  vi.unstubAllGlobals();
});

describe("MCP OAuth callback messages", () => {
  it("forwards only the OAuth response fields used by the explorer", () => {
    const message = createOAuthCallbackMessage(
      "?code=authorization-code&state=state-value&iss=https%3A%2F%2Fmcp.knoww.app&token=do-not-forward"
    );

    expect(message).toEqual({
      type: "knoww-mcp-oauth-callback",
      params: {
        code: "authorization-code",
        state: "state-value",
        iss: "https://mcp.knoww.app",
      },
    });
    expect(parseOAuthCallbackMessage(message)?.get("code")).toBe(
      "authorization-code"
    );
  });

  it("ignores unrelated window messages", () => {
    expect(parseOAuthCallbackMessage({ type: "unrelated" })).toBeNull();
  });

  it("receives a callback when the browser removes the popup opener", () => {
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    const listener = vi.fn();
    const stop = listenForOAuthCallbackBroadcast(listener);

    expect(TestBroadcastChannel.instances[0]?.name).toBe("knoww-mcp-oauth");
    const message = createOAuthCallbackMessage(
      "?code=authorization-code&state=expected-state"
    );
    TestBroadcastChannel.instances[0]?.dispatchEvent(
      new MessageEvent("message", { data: message })
    );

    expect(listener).toHaveBeenCalledWith(message);
    stop();
    expect(TestBroadcastChannel.instances[0]?.close).toHaveBeenCalled();
  });
});
