import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import worker from "../index";
import { FUTURE_X402_SCOPE, MARKETS_READ_SCOPE } from "./scopes";
import { buildWalletLoginMessage } from "./wallet";

const RESOURCE = "https://mcp.knoww.app/mcp";
const ORIGIN = "https://mcp.knoww.app";
const REDIRECT_URI = "https://agent.example/oauth/callback";
const account = privateKeyToAccount(generatePrivateKey());

async function dispatch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function oauthRequest(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      host: "mcp.knoww.app",
      ...init?.headers,
    },
  });
}

async function registerClient(): Promise<string> {
  const response = await dispatch(
    oauthRequest("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Knoww OAuth Test Agent",
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    })
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id: string };
  return body.client_id;
}

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  );
}

function authorizationPath(input: {
  clientId: string;
  codeChallenge: string;
  scope: string;
}): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: REDIRECT_URI,
    scope: input.scope,
    state: "oauth-test-state",
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  });
  return `/authorize?${query.toString()}`;
}

function htmlAttribute(html: string, name: string): string {
  const match = html.match(new RegExp(`${name}="([^"]+)"`));
  if (!match?.[1]) throw new Error(`Missing ${name} in consent HTML`);
  return match[1];
}

describe("MCP OAuth discovery", () => {
  it("challenges unauthenticated MCP requests with protected-resource metadata", async () => {
    const response = await dispatch(
      oauthRequest("/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "oauth-test", version: "1.0.0" },
          },
        }),
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.knoww.app/.well-known/oauth-protected-resource/mcp"'
    );
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("publishes MCP resource and OAuth server metadata with S256 PKCE", async () => {
    const resourceResponse = await dispatch(
      oauthRequest("/.well-known/oauth-protected-resource/mcp")
    );
    expect(resourceResponse.status).toBe(200);
    await expect(resourceResponse.json()).resolves.toMatchObject({
      resource: RESOURCE,
      authorization_servers: [ORIGIN],
      scopes_supported: [MARKETS_READ_SCOPE],
      bearer_methods_supported: ["header"],
    });

    const serverResponse = await dispatch(
      oauthRequest("/.well-known/oauth-authorization-server")
    );
    expect(serverResponse.status).toBe(200);
    await expect(serverResponse.json()).resolves.toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
    });
  });
});

describe("MCP wallet OAuth flow", () => {
  it("exchanges human wallet consent for a scoped MCP access token", async () => {
    const clientId = await registerClient();
    const verifier = "oauth-test-verifier-0123456789abcdefghijklmnopqrstuvwxyz";
    const challenge = await pkceChallenge(verifier);

    const consentResponse = await dispatch(
      oauthRequest(
        authorizationPath({
          clientId,
          codeChallenge: challenge,
          scope: MARKETS_READ_SCOPE,
        })
      )
    );
    expect(consentResponse.status).toBe(200);
    expect(consentResponse.headers.get("content-security-policy")).toContain(
      "default-src 'none'"
    );
    expect(consentResponse.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://agent.example"
    );
    expect(consentResponse.headers.get("cache-control")).toBe("no-store");
    expect(consentResponse.headers.get("referrer-policy")).toBe("same-origin");
    const html = await consentResponse.text();
    expect(html).toContain("eip6963:announceProvider");
    expect(html).toContain("eip6963:requestProvider");
    expect(html).toContain('id="wallet-provider"');
    expect(html).not.toContain('name="decision" id="decision"');
    const challengeId = htmlAttribute(html, "data-challenge-id");
    const issuedAt = htmlAttribute(html, "data-issued-at");
    const expirationTime = htmlAttribute(html, "data-expiration-time");

    const message = buildWalletLoginMessage({
      address: account.address,
      chainId: 137,
      challengeId,
      clientName: "Knoww OAuth Test Agent",
      expirationTime,
      issuedAt,
      resource: RESOURCE,
      scopes: [MARKETS_READ_SCOPE],
    });
    const signature = await account.signMessage({ message });

    const approvalResponse = await dispatch(
      oauthRequest("/authorize", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
        },
        body: new URLSearchParams({
          decision: "allow",
          challenge: challengeId,
          wallet_address: account.address,
          chain_id: "137",
          signature,
        }),
      })
    );
    expect(approvalResponse.status).toBe(302);
    const approvalRedirect = new URL(
      approvalResponse.headers.get("location") ?? ""
    );
    expect(approvalRedirect.origin + approvalRedirect.pathname).toBe(
      REDIRECT_URI
    );
    expect(approvalRedirect.searchParams.get("state")).toBe("oauth-test-state");
    const code = approvalRedirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await dispatch(
      oauthRequest("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code: code ?? "",
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI,
          resource: RESOURCE,
        }),
      })
    );
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      scope: string;
      resource: string;
    };
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.scope).toBe(MARKETS_READ_SCOPE);
    expect(tokens.resource).toBe(RESOURCE);

    const mcpResponse = await dispatch(
      oauthRequest("/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${tokens.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "oauth-test", version: "1.0.0" },
          },
        }),
      })
    );
    expect(mcpResponse.status).toBe(200);
  });

  it("does not grant the reserved x402 scope before paid tools ship", async () => {
    const clientId = await registerClient();
    const response = await dispatch(
      oauthRequest(
        authorizationPath({
          clientId,
          codeChallenge: await pkceChallenge(
            "oauth-test-verifier-x402-0123456789abcdefghijklmnopqrstuvwxyz"
          ),
          scope: `${MARKETS_READ_SCOPE} ${FUTURE_X402_SCOPE}`,
        })
      )
    );

    expect(response.status).toBe(302);
    const redirect = new URL(response.headers.get("location") ?? "");
    expect(redirect.searchParams.get("error")).toBe("invalid_scope");
    expect(redirect.searchParams.get("code")).toBeNull();
  });

  it("returns access_denied without requiring a wallet signature", async () => {
    const clientId = await registerClient();
    const consentResponse = await dispatch(
      oauthRequest(
        authorizationPath({
          clientId,
          codeChallenge: await pkceChallenge(
            "oauth-test-verifier-deny-0123456789abcdefghijklmnopqrstuvwxyz"
          ),
          scope: MARKETS_READ_SCOPE,
        })
      )
    );
    const html = await consentResponse.text();
    const challengeId = htmlAttribute(html, "data-challenge-id");

    const denialResponse = await dispatch(
      oauthRequest("/authorize", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
        },
        body: new URLSearchParams({
          challenge: challengeId,
          decision: "deny",
        }),
      })
    );

    expect(denialResponse.status).toBe(302);
    const redirect = new URL(denialResponse.headers.get("location") ?? "");
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("code")).toBeNull();
  });

  it("returns a safe client error for malformed wallet approval", async () => {
    const clientId = await registerClient();
    const consentResponse = await dispatch(
      oauthRequest(
        authorizationPath({
          clientId,
          codeChallenge: await pkceChallenge(
            "oauth-test-verifier-invalid-0123456789abcdefghijklmnopqrstuvwxyz"
          ),
          scope: MARKETS_READ_SCOPE,
        })
      )
    );
    const html = await consentResponse.text();

    const response = await dispatch(
      oauthRequest("/authorize", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
        },
        body: new URLSearchParams({
          challenge: htmlAttribute(html, "data-challenge-id"),
          decision: "allow",
          wallet_address: "not-an-address",
          chain_id: "137",
          signature: "not-a-signature",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("stack");
  });
});
