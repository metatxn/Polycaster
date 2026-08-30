import {
  AuthorizationError,
  type AuthRequest,
} from "@cloudflare/workers-oauth-provider";
import type { WorkerConfig } from "../config";
import {
  consumeWalletChallenge,
  createWalletChallenge,
  readWalletChallenge,
  type WalletChallenge,
} from "./challenge-store";
import { FREE_MCP_PLAN, resolveRequestedScopes } from "./scopes";
import type { McpOAuthEnv } from "./types";
import {
  buildWalletLoginMessage,
  normalizeClientName,
  verifyWalletLoginSignature,
} from "./wallet";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_FORM_BYTES = 16 * 1024;
const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9]{8,128}$/;

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
  return crypto.randomUUID().replaceAll("-", "");
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
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      `form-action 'self' ${redirectOrigin}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "same-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function consentPage(challenge: WalletChallenge): Response {
  const nonce = randomId();
  const scopes = challenge.scopes.join(" ");
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Knoww MCP</title><style nonce="${nonce}">
:root{color-scheme:dark}body{margin:0;background:#09090b;color:#fafafa;font:16px/1.5 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{background:#18181b;border:1px solid #3f3f46;border-radius:16px;max-width:520px;padding:32px;margin:20px;box-shadow:0 20px 60px #0008}h1{font-size:1.5rem;margin:0 0 12px}p{color:#d4d4d8}.client{color:#fff;font-weight:650}.scope{background:#27272a;border-radius:8px;padding:10px 12px;font-family:ui-monospace,monospace}.actions{display:flex;gap:12px;justify-content:flex-end;margin-top:28px}button{border:0;border-radius:9px;padding:11px 16px;font:inherit;font-weight:650;cursor:pointer}.deny{background:#3f3f46;color:#fff}.allow{background:#a3e635;color:#17200a}.allow:disabled{cursor:wait;opacity:.65}#status{min-height:24px;color:#fca5a5}
</style></head><body><main class="card" id="consent" data-challenge-id="${htmlEscape(challenge.id)}" data-client-name="${htmlEscape(challenge.clientName)}" data-issued-at="${htmlEscape(challenge.issuedAt)}" data-expiration-time="${htmlEscape(challenge.expirationTime)}" data-resource="${htmlEscape(challenge.resource)}" data-scopes="${htmlEscape(scopes)}">
<h1>Authorize Knoww MCP</h1><p><span class="client">${htmlEscape(challenge.clientName)}</span> is requesting access to your Knoww MCP connection.</p><p>Requested permission:</p><div class="scope">${htmlEscape(scopes)}</div><p>Your wallet signature proves account ownership. It does not authorize a trade or payment.</p><p id="status" role="status" aria-live="polite"></p>
<form id="consent-form" method="post" action="/authorize"><input type="hidden" name="challenge" value="${htmlEscape(challenge.id)}"><input type="hidden" id="decision" value="allow"><input type="hidden" name="wallet_address" id="wallet-address"><input type="hidden" name="chain_id" id="chain-id"><input type="hidden" name="signature" id="signature"><div class="actions"><button class="deny" type="submit" name="decision" value="deny">Cancel</button><button class="allow" id="allow" type="button">Connect wallet and authorize</button></div></form>
</main><script nonce="${nonce}">
const root=document.getElementById("consent"),form=document.getElementById("consent-form"),allow=document.getElementById("allow"),status=document.getElementById("status");
allow.addEventListener("click",async()=>{allow.disabled=true;status.textContent="";try{if(!window.ethereum)throw new Error("No browser wallet was found.");const accounts=await window.ethereum.request({method:"eth_requestAccounts"});const address=accounts&&accounts[0];if(!address)throw new Error("No wallet account was selected.");const chainHex=await window.ethereum.request({method:"eth_chainId"});const chainId=Number.parseInt(chainHex,16);const messageResponse=await fetch("/authorize/message",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({challenge:root.dataset.challengeId,wallet_address:address,chain_id:String(chainId)})});if(!messageResponse.ok)throw new Error("Could not create the wallet message.");const data=await messageResponse.json();const bytes=new TextEncoder().encode(data.message);const hex="0x"+Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");const signature=await window.ethereum.request({method:"personal_sign",params:[hex,address]});document.getElementById("wallet-address").value=address;document.getElementById("chain-id").value=String(chainId);document.getElementById("signature").value=signature;const decision=document.getElementById("decision");decision.name="decision";decision.value="allow";form.submit();}catch(error){status.textContent=error instanceof Error?error.message:"Wallet authorization failed.";allow.disabled=false;}});
</script></body></html>`;
  return new Response(body, {
    status: 200,
    headers: consentHeaders(nonce, challenge.oauthRequest.redirectUri),
  });
}

function localError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "cache-control": "no-store", "content-type": "text/plain" },
  });
}

async function handleConsentGet(
  request: Request,
  env: McpOAuthEnv,
  config: WorkerConfig
): Promise<Response> {
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

  const issuedAt = new Date().toISOString();
  const challenge: WalletChallenge = {
    id: randomId(),
    clientName: normalizeClientName(client.clientName),
    issuedAt,
    expirationTime: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    resource: config.canonicalResource,
    scopes,
    oauthRequest,
  };
  await createWalletChallenge(env.MCP_AUTH_CHALLENGES, challenge);
  return consentPage(challenge);
}

async function handleMessageRequest(
  request: Request,
  env: McpOAuthEnv,
  config: WorkerConfig
): Promise<Response> {
  if (!isSameOriginPost(request)) return localError("Forbidden.", 403);
  const form = await readForm(request);
  const challengeId = form.get("challenge") ?? "";
  if (!CHALLENGE_ID_PATTERN.test(challengeId)) {
    return localError("Invalid or expired challenge.", 401);
  }
  const challenge = await readWalletChallenge(
    env.MCP_AUTH_CHALLENGES,
    challengeId
  );
  if (!challenge || challenge.resource !== config.canonicalResource) {
    return localError("Invalid or expired challenge.", 401);
  }
  try {
    const message = buildWalletLoginMessage({
      address: form.get("wallet_address") ?? "",
      chainId: Number(form.get("chain_id")),
      challengeId,
      clientName: challenge.clientName,
      expirationTime: challenge.expirationTime,
      issuedAt: challenge.issuedAt,
      resource: challenge.resource,
      scopes: challenge.scopes,
    });
    return Response.json(
      { message },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return localError("Invalid wallet details.", 400);
  }
}

async function handleConsentPost(
  request: Request,
  env: McpOAuthEnv,
  config: WorkerConfig
): Promise<Response> {
  if (!isSameOriginPost(request)) return localError("Forbidden.", 403);
  const form = await readForm(request);
  const challengeId = form.get("challenge") ?? "";
  if (!CHALLENGE_ID_PATTERN.test(challengeId)) {
    return localError("Invalid or expired challenge.", 401);
  }
  const challenge = await consumeWalletChallenge(
    env.MCP_AUTH_CHALLENGES,
    challengeId
  );
  if (!challenge || challenge.resource !== config.canonicalResource) {
    return localError("Invalid or expired challenge.", 401);
  }
  if (form.get("decision") === "deny") {
    return oauthErrorRedirect(
      challenge.oauthRequest,
      "access_denied",
      "The user denied the authorization request."
    );
  }

  let message: string;
  try {
    message = buildWalletLoginMessage({
      address: form.get("wallet_address") ?? "",
      chainId: Number(form.get("chain_id")),
      challengeId,
      clientName: challenge.clientName,
      expirationTime: challenge.expirationTime,
      issuedAt: challenge.issuedAt,
      resource: challenge.resource,
      scopes: challenge.scopes,
    });
  } catch {
    return localError("Invalid wallet details.", 400);
  }
  const walletAddress = await verifyWalletLoginSignature({
    address: form.get("wallet_address") ?? "",
    message,
    signature: form.get("signature") ?? "",
  });
  if (!walletAddress) return localError("Invalid wallet signature.", 401);

  const principalId = `wallet-${walletAddress.toLowerCase()}`;
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: challenge.oauthRequest,
    userId: principalId,
    metadata: {
      authMethod: "wallet-signature",
      clientName: challenge.clientName,
    },
    scope: challenge.scopes,
    props: {
      authMethod: "wallet-signature",
      principalId,
      plan: FREE_MCP_PLAN,
      scopes: challenge.scopes,
      walletAddress,
    },
  });
  return redirectResponse(redirectTo);
}

/**
 * @openapi
 * /authorize/message:
 *   post:
 *     summary: Build the wallet message for an active consent challenge.
 *     tags: [OAuth]
 *     responses:
 *       200:
 *         description: Message that the selected wallet must sign.
 *       400:
 *         description: Invalid wallet or challenge details.
 *       401:
 *         description: The challenge is invalid or expired.
 *       403:
 *         description: Same-origin check failed.
 *       413:
 *         description: Form body exceeds 16 KiB.
 *       415:
 *         description: Form content type is required.
 *       429:
 *         description: Authorization request quota exceeded.
 */
export function createConsentHandler(
  config: WorkerConfig
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
          url.pathname === "/authorize/message" &&
          request.method === "POST"
        ) {
          return handleMessageRequest(request, env, config);
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
