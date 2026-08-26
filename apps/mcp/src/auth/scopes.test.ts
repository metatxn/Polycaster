import { describe, expect, it } from "vitest";
import {
  ACTIVE_MCP_SCOPES,
  FUTURE_X402_SCOPE,
  MARKETS_READ_SCOPE,
  resolveRequestedScopes,
  validateMcpAuthProps,
} from "./scopes";

describe("MCP OAuth scopes", () => {
  it("advertises only implemented read access", () => {
    expect(ACTIVE_MCP_SCOPES).toEqual([MARKETS_READ_SCOPE]);
    expect(ACTIVE_MCP_SCOPES).not.toContain(FUTURE_X402_SCOPE);
  });

  it("uses markets:read when the client omits scope", () => {
    expect(resolveRequestedScopes([])).toEqual([MARKETS_READ_SCOPE]);
  });

  it("rejects unknown and not-yet-active scopes", () => {
    expect(() => resolveRequestedScopes(["admin"])).toThrow(
      "Unsupported OAuth scope"
    );
    expect(() => resolveRequestedScopes([FUTURE_X402_SCOPE])).toThrow(
      "Unsupported OAuth scope"
    );
  });

  it("accepts only provider-issued wallet props with active scopes", () => {
    expect(
      validateMcpAuthProps({
        authMethod: "wallet-signature",
        principalId: "wallet-0x0000000000000000000000000000000000000001",
        walletAddress: "0x0000000000000000000000000000000000000001",
        plan: "free",
        scopes: [MARKETS_READ_SCOPE],
      })
    ).toEqual({
      authMethod: "wallet-signature",
      principalId: "wallet-0x0000000000000000000000000000000000000001",
      walletAddress: "0x0000000000000000000000000000000000000001",
      plan: "free",
      scopes: [MARKETS_READ_SCOPE],
    });

    expect(
      validateMcpAuthProps({
        authMethod: "wallet-signature",
        principalId: "wallet-0x0000000000000000000000000000000000000001",
        walletAddress: "0x0000000000000000000000000000000000000001",
        plan: "free",
        scopes: [MARKETS_READ_SCOPE, "admin"],
      })
    ).toBeNull();

    expect(
      validateMcpAuthProps({
        authMethod: "wallet-signature",
        principalId: "wallet-0x0000000000000000000000000000000000000001",
        walletAddress: "0x0000000000000000000000000000000000000001",
        plan: "free",
        scopes: [],
      })?.scopes
    ).toEqual([]);
  });

  it("rejects unknown plans in provider-issued token properties", () => {
    expect(
      validateMcpAuthProps({
        authMethod: "wallet-signature",
        principalId: "wallet-0x0000000000000000000000000000000000000001",
        walletAddress: "0x0000000000000000000000000000000000000001",
        plan: "unlimited",
        scopes: [MARKETS_READ_SCOPE],
      })
    ).toBeNull();
  });
});
