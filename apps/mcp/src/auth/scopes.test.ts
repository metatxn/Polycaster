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

  it("accepts only provider-issued Google props with active scopes", () => {
    expect(
      validateMcpAuthProps({
        authMethod: "google-oidc",
        googleSubject: "102030405060708090",
        principalId: "google-102030405060708090",
        plan: "free",
        scopes: [MARKETS_READ_SCOPE],
      })
    ).toEqual({
      authMethod: "google-oidc",
      googleSubject: "102030405060708090",
      principalId: "google-102030405060708090",
      plan: "free",
      scopes: [MARKETS_READ_SCOPE],
    });

    expect(
      validateMcpAuthProps({
        authMethod: "google-oidc",
        googleSubject: "102030405060708090",
        principalId: "google-102030405060708090",
        plan: "free",
        scopes: [MARKETS_READ_SCOPE, "admin"],
      })
    ).toBeNull();

    expect(
      validateMcpAuthProps({
        authMethod: "google-oidc",
        googleSubject: "102030405060708090",
        principalId: "google-102030405060708090",
        plan: "free",
        scopes: [],
      })?.scopes
    ).toEqual([]);
  });

  it("rejects unknown plans in provider-issued token properties", () => {
    expect(
      validateMcpAuthProps({
        authMethod: "google-oidc",
        googleSubject: "102030405060708090",
        principalId: "google-102030405060708090",
        plan: "unlimited",
        scopes: [MARKETS_READ_SCOPE],
      })
    ).toBeNull();
  });
});
