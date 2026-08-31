import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workerConfigFromEnv } from "../config";
import worker from "../index";
import type { GoogleAuthenticator } from "./google";
import { createOAuthProvider } from "./provider";
import { FUTURE_X402_SCOPE, MARKETS_READ_SCOPE } from "./scopes";
import type { McpOAuthEnv } from "./types";

const RESOURCE = "https://mcp.knoww.app/mcp";
const ORIGIN = "https://mcp.knoww.app";
const REDIRECT_URI = "https://agent.example/oauth/callback";
const GOOGLE_SUBJECT = "102030405060708090";

const googleAuthenticator = vi.fn<GoogleAuthenticator>(async () => ({
  subject: GOOGLE_SUBJECT,
}));
const googleProvider = createOAuthProvider(
  workerConfigFromEnv(env),
  googleAuthenticator
);

async function dispatch(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function dispatchGoogleFlow(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await googleProvider.fetch(request, env as McpOAuthEnv, ctx);
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
  const response = await dispatchGoogleFlow(
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
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
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

function hiddenInputValue(html: string, name: string): string {
  const pattern = new RegExp(`name="${name}" value="([^"]+)"`);
  const match = html.match(pattern);
  if (!match?.[1]) throw new Error(`Missing ${name} in consent HTML`);
  return match[1];
}

async function beginAuthorization(scope = MARKETS_READ_SCOPE): Promise<{
  clientId: string;
  consentResponse: Response;
  transactionId: string;
}> {
  const clientId = await registerClient();
  const consentResponse = await dispatchGoogleFlow(
    oauthRequest(
      authorizationPath({
        clientId,
        codeChallenge: await pkceChallenge(
          "oauth-test-verifier-0123456789abcdefghijklmnopqrstuvwxyz"
        ),
        scope,
      })
    )
  );
  const html = await consentResponse.clone().text();
  return {
    clientId,
    consentResponse,
    transactionId: hiddenInputValue(html, "transaction"),
  };
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

describe("MCP Google OAuth flow", () => {
  beforeEach(() => {
    googleAuthenticator.mockClear();
  });

  it("exchanges Google sign-in for a scoped MCP access token", async () => {
    const verifier = "oauth-test-verifier-0123456789abcdefghijklmnopqrstuvwxyz";
    const { clientId, consentResponse, transactionId } =
      await beginAuthorization();

    expect(consentResponse.status).toBe(200);
    expect(consentResponse.headers.get("content-security-policy")).toContain(
      "default-src 'none'"
    );
    expect(consentResponse.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://accounts.google.com https://agent.example"
    );
    expect(consentResponse.headers.get("cache-control")).toBe("no-store");
    expect(consentResponse.headers.get("referrer-policy")).toBe("same-origin");
    const html = await consentResponse.text();
    expect(html).toContain("Continue with Google");
    expect(html).not.toContain("window.ethereum");
    expect(html).not.toContain("<script");

    const approvalResponse = await dispatchGoogleFlow(
      oauthRequest("/authorize", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
        },
        body: new URLSearchParams({
          decision: "allow",
          transaction: transactionId,
        }),
      })
    );
    expect(approvalResponse.status).toBe(302);
    const googleRedirect = new URL(
      approvalResponse.headers.get("location") ?? ""
    );
    expect(googleRedirect.origin + googleRedirect.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(googleRedirect.searchParams.get("state")).toBe(transactionId);
    expect(googleRedirect.searchParams.get("nonce")).toBeTruthy();
    expect(googleRedirect.searchParams.get("code_challenge_method")).toBe(
      "S256"
    );
    expect(googleRedirect.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/auth/google/callback`
    );

    const callbackResponse = await dispatchGoogleFlow(
      oauthRequest(
        `/auth/google/callback?${new URLSearchParams({ code: "google-code", state: transactionId })}`
      )
    );
    expect(callbackResponse.status).toBe(302);
    expect(googleAuthenticator).toHaveBeenCalledOnce();
    expect(googleAuthenticator).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "google-test-client.apps.googleusercontent.com",
        clientSecret: "google-test-secret",
        code: "google-code",
        redirectUri: `${ORIGIN}/auth/google/callback`,
      })
    );
    const clientRedirect = new URL(
      callbackResponse.headers.get("location") ?? ""
    );
    expect(clientRedirect.origin + clientRedirect.pathname).toBe(REDIRECT_URI);
    expect(clientRedirect.searchParams.get("state")).toBe("oauth-test-state");
    const code = clientRedirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await dispatchGoogleFlow(
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

    const mcpResponse = await dispatchGoogleFlow(
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
    const response = await dispatchGoogleFlow(
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

  it("returns access_denied when Google sign-in is canceled", async () => {
    const { transactionId } = await beginAuthorization();
    const response = await dispatchGoogleFlow(
      oauthRequest(
        `/auth/google/callback?${new URLSearchParams({ error: "access_denied", state: transactionId })}`
      )
    );

    expect(response.status).toBe(302);
    const redirect = new URL(response.headers.get("location") ?? "");
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("code")).toBeNull();
    expect(googleAuthenticator).not.toHaveBeenCalled();
  });

  it("rejects an invalid subject returned by the identity boundary", async () => {
    googleAuthenticator.mockResolvedValueOnce({ subject: "invalid subject" });
    const { transactionId } = await beginAuthorization();
    const response = await dispatchGoogleFlow(
      oauthRequest(
        `/auth/google/callback?${new URLSearchParams({ code: "google-code", state: transactionId })}`
      )
    );

    expect(response.status).toBe(302);
    const redirect = new URL(response.headers.get("location") ?? "");
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("code")).toBeNull();
  });

  it("rejects missing, cross-origin, and replayed authorization state", async () => {
    const missingState = await dispatchGoogleFlow(
      oauthRequest("/auth/google/callback?code=google-code")
    );
    expect(missingState.status).toBe(401);

    const { transactionId } = await beginAuthorization();
    const crossOrigin = await dispatchGoogleFlow(
      oauthRequest("/authorize", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://attacker.example",
        },
        body: new URLSearchParams({
          decision: "allow",
          transaction: transactionId,
        }),
      })
    );
    expect(crossOrigin.status).toBe(403);

    const callbackPath = `/auth/google/callback?${new URLSearchParams({ code: "google-code", state: transactionId })}`;
    const first = await dispatchGoogleFlow(oauthRequest(callbackPath));
    expect(first.status).toBe(302);
    const replay = await dispatchGoogleFlow(oauthRequest(callbackPath));
    expect(replay.status).toBe(401);
    expect(await replay.text()).not.toContain("stack");
    expect(googleAuthenticator).toHaveBeenCalledOnce();
  });
});
