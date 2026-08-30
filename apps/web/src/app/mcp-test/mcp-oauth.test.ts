import { describe, expect, it, vi } from "vitest";
import {
  beginOAuthAuthorization,
  finishOAuthAuthorization,
  protectedResourceMetadataUrl,
} from "./mcp-oauth";

const ENDPOINT = "https://mcp.knoww.app/mcp";
const REDIRECT_URI = "https://knoww.app/mcp-test/oauth/callback";

describe("protectedResourceMetadataUrl", () => {
  it("preserves the MCP path in the RFC 9728 discovery URL", () => {
    expect(protectedResourceMetadataUrl(ENDPOINT)).toBe(
      "https://mcp.knoww.app/.well-known/oauth-protected-resource/mcp"
    );
  });
});

describe("beginOAuthAuthorization", () => {
  it("discovers OAuth, registers a public client, and builds an S256 request", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          resource: ENDPOINT,
          authorization_servers: ["https://mcp.knoww.app"],
          scopes_supported: ["markets:read"],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          issuer: "https://mcp.knoww.app",
          authorization_endpoint: "https://mcp.knoww.app/authorize",
          token_endpoint: "https://mcp.knoww.app/oauth/token",
          registration_endpoint: "https://mcp.knoww.app/oauth/register",
          code_challenge_methods_supported: ["S256"],
          authorization_response_iss_parameter_supported: true,
        })
      )
      .mockResolvedValueOnce(Response.json({ client_id: "browser-client" }));

    const authorization = await beginOAuthAuthorization(
      ENDPOINT,
      REDIRECT_URI,
      fetchImpl
    );
    const url = new URL(authorization.authorizationUrl);

    expect(url.origin + url.pathname).toBe("https://mcp.knoww.app/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("browser-client");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe("markets:read");
    expect(url.searchParams.get("resource")).toBe(ENDPOINT);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/
    );
    expect(
      authorization.transaction.codeVerifier.length
    ).toBeGreaterThanOrEqual(43);

    const registration = JSON.parse(
      String(fetchImpl.mock.calls[2]?.[1]?.body)
    ) as Record<string, unknown>;
    expect(registration).toMatchObject({
      client_name: "Knoww MCP explorer",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("rejects authorization servers that do not advertise S256", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          resource: ENDPOINT,
          authorization_servers: ["https://mcp.knoww.app"],
          scopes_supported: ["markets:read"],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          issuer: "https://mcp.knoww.app",
          authorization_endpoint: "https://mcp.knoww.app/authorize",
          token_endpoint: "https://mcp.knoww.app/oauth/token",
          registration_endpoint: "https://mcp.knoww.app/oauth/register",
          code_challenge_methods_supported: ["plain"],
        })
      );

    await expect(
      beginOAuthAuthorization(ENDPOINT, REDIRECT_URI, fetchImpl)
    ).rejects.toThrow("The authorization server does not support S256 PKCE.");
  });
});

describe("finishOAuthAuthorization", () => {
  it("validates state and issuer, then exchanges the code for a bearer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "private-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "markets:read",
      })
    );
    const transaction = {
      clientId: "browser-client",
      codeVerifier: "verifier",
      issuer: "https://mcp.knoww.app",
      issuerRequired: true,
      redirectUri: REDIRECT_URI,
      resource: ENDPOINT,
      state: "expected-state",
      tokenEndpoint: "https://mcp.knoww.app/oauth/token",
    };

    const session = await finishOAuthAuthorization(
      transaction,
      new URLSearchParams({
        code: "authorization-code",
        state: "expected-state",
        iss: "https://mcp.knoww.app",
      }),
      fetchImpl
    );

    expect(session).toMatchObject({
      accessToken: "private-access-token",
      scope: ["markets:read"],
    });
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).toContain(
      `resource=${encodeURIComponent(ENDPOINT)}`
    );
  });

  it("rejects a callback with the wrong state before token exchange", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      finishOAuthAuthorization(
        {
          clientId: "browser-client",
          codeVerifier: "verifier",
          issuer: "https://mcp.knoww.app",
          issuerRequired: true,
          redirectUri: REDIRECT_URI,
          resource: ENDPOINT,
          state: "expected-state",
          tokenEndpoint: "https://mcp.knoww.app/oauth/token",
        },
        new URLSearchParams({
          code: "authorization-code",
          state: "wrong-state",
          iss: "https://mcp.knoww.app",
        }),
        fetchImpl
      )
    ).rejects.toThrow("OAuth state validation failed.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
