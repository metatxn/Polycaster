import { describe, expect, it } from "vitest";
import {
  createOAuthCallbackMessage,
  parseOAuthCallbackMessage,
} from "./mcp-oauth-callback";

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
});
