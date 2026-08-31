import {
  AuthorizationError,
  type AuthRequest,
} from "@cloudflare/workers-oauth-provider";
import { createLogger } from "@knoww/logger";
import type { WorkerConfig } from "../config";
import { currentRequestId } from "../context";
import {
  type AuthorizationTransaction,
  consumeAuthorizationTransaction,
  createAuthorizationTransaction,
  readAuthorizationTransaction,
} from "./challenge-store";
import {
  authenticateWithGoogle,
  buildGoogleAuthorizationUrl,
  createGooglePkce,
  type GoogleAuthenticator,
} from "./google";
import {
  FREE_MCP_PLAN,
  resolveRequestedScopes,
  validateMcpAuthProps,
} from "./scopes";
import type { McpOAuthEnv } from "./types";

const TRANSACTION_TTL_MS = 5 * 60 * 1000;
const MAX_FORM_BYTES = 16 * 1024;
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_GOOGLE_CODE_LENGTH = 4096;
const log = createLogger("mcp.oauth.google");

class FormError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    message: string
  ) {
    super(message);
  }
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function randomId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function normalizeClientName(value: string | undefined): string {
  const withoutControls = Array.from(value ?? "Unnamed MCP client", (char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : char;
  }).join("");
  const normalized = withoutControls.replace(/\s+/gu, " ").trim().slice(0, 100);
  return normalized || "Unnamed MCP client";
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { "cache-control": "no-store", location },
  });
}

function oauthErrorRedirect(
  request: AuthRequest,
  code: "access_denied" | "invalid_scope",
  description: string
): Response {
  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("error", code);
  redirect.searchParams.set("error_description", description);
  if (request.state) redirect.searchParams.set("state", request.state);
  if (request.issuer) redirect.searchParams.set("iss", request.issuer);
  return redirectResponse(redirect.toString());
}

function authorizationErrorResponse(error: AuthorizationError): Response {
  if (!error.redirectUri) {
    return new Response("Invalid OAuth authorization request.", {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return redirectResponse(redirect.toString());
}

async function readForm(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")
  ) {
    throw new FormError(415, "Form content type required.");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FORM_BYTES) {
    throw new FormError(413, "Request body too large.");
  }
  if (!request.body) throw new FormError(400, "Request body required.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FORM_BYTES) {
      await reader.cancel();
      throw new FormError(413, "Request body too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

function isSameOriginPost(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function oauthRedirectOrigin(redirectUri: string): string {
  const origin = new URL(redirectUri).origin;
  if (origin === "null") throw new Error("Unsupported OAuth redirect URI.");
  return origin;
}

function consentHeaders(nonce: string, redirectUri: string): HeadersInit {
  const redirectOrigin = oauthRedirectOrigin(redirectUri);
  return {
    "cache-control": "no-store",
    "content-security-policy": [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      `form-action 'self' https://accounts.google.com ${redirectOrigin}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function consentPage(transaction: AuthorizationTransaction): Response {
  const nonce = randomId();
  const scopes = transaction.scopes.join(" ");
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Knoww MCP</title><style nonce="${nonce}">
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#09090b;color:#fafafa;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(540px,calc(100% - 32px));background:#18181b;border:1px solid #3f3f46;border-radius:18px;padding:36px;box-shadow:0 24px 72px #0009}h1{font-size:clamp(1.7rem,5vw,2.25rem);line-height:1.15;margin:0 0 18px}p{color:#d4d4d8;margin:14px 0}.client{color:#fff;font-weight:700}.scope{background:#27272a;border:1px solid #3f3f46;border-radius:10px;padding:11px 13px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.privacy{font-size:.9rem;color:#a1a1aa}.actions{display:flex;gap:12px;justify-content:flex-end;margin-top:30px}.button{min-height:48px;border:1px solid transparent;border-radius:9px;padding:11px 16px;font:inherit;font-weight:650;cursor:pointer}.deny{background:#3f3f46;color:#fff}.google{display:inline-flex;align-items:center;gap:12px;background:#fff;border-color:#dadce0;color:#1f1f1f}.google svg{flex:none}.button:focus-visible{outline:3px solid #bef264;outline-offset:3px}@media(max-width:520px){.card{padding:26px 22px}.actions{align-items:stretch;flex-direction:column-reverse}.button{justify-content:center;width:100%}}
</style></head><body><main class="card">
<h1>Authorize Knoww MCP</h1><p><span class="client">${htmlEscape(transaction.clientName)}</span> is requesting access to your Knoww MCP connection.</p><p>Requested permission:</p><div class="scope">${htmlEscape(scopes)}</div><p>Sign in with Google to confirm who is approving this connection. Knoww will not share your Google password or Google access token with the MCP client.</p><p class="privacy">Your sign-in identifies your Knoww MCP principal. The requested permission still limits what the client can access.</p>
<form method="post" action="/authorize"><input type="hidden" name="transaction" value="${htmlEscape(transaction.id)}"><div class="actions"><button class="button deny" type="submit" name="decision" value="deny">Cancel</button><button class="button google" type="submit" name="decision" value="allow"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 18 18"><path fill="#EA4335" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.715v2.259h2.909c1.702-1.568 2.684-3.878 2.684-6.614Z"/><path fill="#4285F4" d="M9 18c2.43 0 4.468-.806 5.956-2.181l-2.909-2.259c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.963 10.705A5.42 5.42 0 0 1 3.681 9c0-.592.102-1.168.282-1.705V4.963H.956A9 9 0 0 0 0 9c0 1.45.347 2.824.956 4.037l3.007-2.332Z"/><path fill="#34A853" d="M9 3.581c1.321 0 2.507.454 3.44 1.346l2.581-2.581C13.464.896 11.426 0 9 0A9 9 0 0 0 .956 4.963l3.007 2.332C4.672 5.166 6.656 3.581 9 3.581Z"/></svg>Continue with Google</button></div></form>
</main></body></html>`;
  return new Response(body, {
    status: 200,
    headers: consentHeaders(nonce, transaction.oauthRequest.redirectUri),
  });
}

function localError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "cache-control": "no-store", "content-type": "text/plain" },
  });
}

function googleRedirectUri(request: Request): string {
  return new URL("/auth/google/callback", request.url).toString();
}

function assertGoogleConfiguration(env: McpOAuthEnv): void {
  if (
    typeof env.GOOGLE_CLIENT_ID !== "string" ||
    env.GOOGLE_CLIENT_ID.length < 10 ||
    env.GOOGLE_CLIENT_ID.length > 512 ||
    typeof env.GOOGLE_CLIENT_SECRET !== "string" ||
    env.GOOGLE_CLIENT_SECRET.length < 1 ||
    env.GOOGLE_CLIENT_SECRET.length > 4096
  ) {
    throw new Error("Google authentication is not configured.");
  }
}

async function handleConsentGet(
  request: Request,
  env: McpOAuthEnv,
  config: WorkerConfig
): Promise<Response> {
  assertGoogleConfiguration(env);
  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authorizationErrorResponse(error);
    }
    throw error;
  }

  let scopes: string[];
  try {
    scopes = resolveRequestedScopes(oauthRequest.scope);
  } catch {
    return oauthErrorRedirect(
      oauthRequest,
      "invalid_scope",
      "One or more requested scopes are not available."
    );
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) return localError("Unknown OAuth client.", 400);

  const pkce = await createGooglePkce();
  const transaction: AuthorizationTransaction = {
    codeChallenge: pkce.challenge,
    codeVerifier: pkce.verifier,
    id: randomId(),
    clientName: normalizeClientName(client.clientName),
    expirationTime: new Date(Date.now() + TRANSACTION_TTL_MS).toISOString(),
    nonce: randomId(),
    resource: config.canonicalResource,
    scopes,
    oauthRequest,
  };
  await createAuthorizationTransaction(env.MCP_AUTH_CHALLENGES, transaction);
  return consentPage(transaction);
}

async function handleConsentPost(
  request: Request,
  env: McpOAuthEnv,
  config: WorkerConfig
): Promise<Response> {
  if (!isSameOriginPost(request)) return localError("Forbidden.", 403);
  const form = await readForm(request);
  const transactionId = form.get("transaction") ?? "";
  if (!TRANSACTION_ID_PATTERN.test(transactionId)) {
    return localError("Invalid or expired authorization request.", 401);
  }

  if (form.get("decision") === "deny") {
    const transaction = await consumeAuthorizationTransaction(
      env.MCP_AUTH_CHALLENGES,
      transactionId
    );
    if (!transaction || transaction.resource !== config.canonicalResource) {
      return localError("Invalid or expired authorization request.", 401);
    }
    return oauthErrorRedirect(
      transaction.oauthRequest,
      "access_denied",
      "The user denied the authorization request."
    );
  }
  if (form.get("decision") !== "allow") {
    return localError("Invalid authorization decision.", 400);
  }

  assertGoogleConfiguration(env);
  const transaction = await readAuthorizationTransaction(
    env.MCP_AUTH_CHALLENGES,
    transactionId
  );
  if (!transaction || transaction.resource !== config.canonicalResource) {
    return localError("Invalid or expired authorization request.", 401);
  }
  return redirectResponse(
    buildGoogleAuthorizationUrl({
      clientId: env.GOOGLE_CLIENT_ID,
      codeChallenge: transaction.codeChallenge,
      nonce: transaction.nonce,
      redirectUri: googleRedirectUri(request),
      state: transaction.id,
    })
  );
}

async function handleGoogleCallback(
  request: Request,
  env: McpOAuthEnv,
  config: WorkerConfig,
  googleAuthenticator: GoogleAuthenticator
): Promise<Response> {
  assertGoogleConfiguration(env);
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  if (!TRANSACTION_ID_PATTERN.test(state)) {
    return localError("Invalid or expired authorization request.", 401);
  }
  const transaction = await consumeAuthorizationTransaction(
    env.MCP_AUTH_CHALLENGES,
    state
  );
  if (!transaction || transaction.resource !== config.canonicalResource) {
    return localError("Invalid or expired authorization request.", 401);
  }
  if (url.searchParams.has("error")) {
    return oauthErrorRedirect(
      transaction.oauthRequest,
      "access_denied",
      "Google sign-in was canceled."
    );
  }

  const code = url.searchParams.get("code") ?? "";
  if (code.length < 1 || code.length > MAX_GOOGLE_CODE_LENGTH) {
    return oauthErrorRedirect(
      transaction.oauthRequest,
      "access_denied",
      "Google sign-in could not be completed."
    );
  }

  let subject: string;
  try {
    const identity = await googleAuthenticator({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      code,
      codeVerifier: transaction.codeVerifier,
      nonce: transaction.nonce,
      redirectUri: googleRedirectUri(request),
    });
    subject = identity.subject;
  } catch {
    log.warn("identity.denied", {
      requestId: currentRequestId(),
      reason: "google_verification_failed",
    });
    return oauthErrorRedirect(
      transaction.oauthRequest,
      "access_denied",
      "Google sign-in could not be completed."
    );
  }

  const props = validateMcpAuthProps({
    authMethod: "google-oidc",
    googleSubject: subject,
    principalId: `google-${subject}`,
    plan: FREE_MCP_PLAN,
    scopes: transaction.scopes,
  });
  if (!props) {
    log.warn("identity.denied", {
      requestId: currentRequestId(),
      reason: "invalid_google_subject",
    });
    return oauthErrorRedirect(
      transaction.oauthRequest,
      "access_denied",
      "Google sign-in could not be completed."
    );
  }
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: transaction.oauthRequest,
    userId: props.principalId,
    metadata: {
      authMethod: "google-oidc",
      clientName: transaction.clientName,
    },
    scope: transaction.scopes,
    props,
  });
  return redirectResponse(redirectTo);
}

/**
 * @openapi
 * /authorize:
 *   get:
 *     summary: Review an MCP authorization request.
 *     tags: [OAuth]
 *   post:
 *     summary: Continue to Google sign-in or deny MCP authorization.
 *     tags: [OAuth]
 *     responses:
 *       302:
 *         description: Redirect to Google or back to the MCP client.
 *       400:
 *         description: Invalid authorization decision.
 *       401:
 *         description: Authorization transaction is invalid or expired.
 *       403:
 *         description: Same-origin check failed.
 *       413:
 *         description: Form body exceeds 16 KiB.
 *       415:
 *         description: Form content type is required.
 *       429:
 *         description: Authorization request quota exceeded.
 * /auth/google/callback:
 *   get:
 *     summary: Complete Google sign-in and MCP authorization.
 *     tags: [OAuth]
 *     responses:
 *       302:
 *         description: Redirect to the MCP client with a code or OAuth error.
 *       401:
 *         description: Authorization transaction is invalid or expired.
 *       429:
 *         description: Authorization request quota exceeded.
 */
export function createConsentHandler(
  config: WorkerConfig,
  googleAuthenticator: GoogleAuthenticator = authenticateWithGoogle
): ExportedHandler<McpOAuthEnv> {
  return {
    async fetch(request, env) {
      try {
        const url = new URL(request.url);
        if (url.pathname === "/authorize" && request.method === "GET") {
          return handleConsentGet(request, env, config);
        }
        if (url.pathname === "/authorize" && request.method === "POST") {
          return handleConsentPost(request, env, config);
        }
        if (
          url.pathname === "/auth/google/callback" &&
          request.method === "GET"
        ) {
          return handleGoogleCallback(
            request,
            env,
            config,
            googleAuthenticator
          );
        }
        return localError("Not found.", 404);
      } catch (error) {
        if (error instanceof FormError) {
          return localError(error.message, error.status);
        }
        throw error;
      }
    },
  };
}
