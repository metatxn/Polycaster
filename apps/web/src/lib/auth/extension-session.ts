import { type NextRequest, NextResponse } from "next/server";

const TOKEN_AUDIENCE = "knoww-extension";
const TOKEN_ISSUER = "knoww.app";
const TOKEN_TTL_MS = 15 * 60 * 1000;

export type ExtensionScope = "builder:sign" | "ai:extract" | "ai:validate";

export interface ExtensionSessionClaims {
  aud: string;
  chainId: number;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  scope: ExtensionScope[];
  sub: string;
}

interface ExtensionChallengeClaims {
  address: string;
  chainId: number;
  exp: number;
  iat: number;
  iss: string;
  message: string;
}

function getSessionSecret(): string | null {
  return process.env.EXTENSION_SESSION_SECRET || null;
}

function toBase64Url(input: string): string {
  return btoa(input)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(`${normalized}${padding}`);
}

async function computeSignature(
  secret: string,
  message: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  let binary = "";
  for (const byte of new Uint8Array(signature)) {
    binary += String.fromCharCode(byte);
  }

  return toBase64Url(binary);
}

async function verifySignature(
  secret: string,
  message: string,
  signature: string
): Promise<boolean> {
  const expected = await computeSignature(secret, message);
  return expected === signature;
}

async function signPayload<T>(payload: T): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("EXTENSION_SESSION_SECRET is not configured");
  }

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = await computeSignature(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function verifyPayload<T>(token: string): Promise<T | null> {
  const secret = getSessionSecret();
  if (!secret) {
    return null;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return null;
  }

  const isValid = await verifySignature(secret, payload, signature);
  if (!isValid) {
    return null;
  }

  try {
    return JSON.parse(fromBase64Url(payload)) as T;
  } catch {
    return null;
  }
}

export async function issueExtensionSessionToken(input: {
  address: string;
  chainId: number;
  scope?: ExtensionScope[];
}): Promise<{ token: string; claims: ExtensionSessionClaims }> {
  const now = Date.now();
  const claims: ExtensionSessionClaims = {
    aud: TOKEN_AUDIENCE,
    chainId: input.chainId,
    exp: now + TOKEN_TTL_MS,
    iat: now,
    iss: TOKEN_ISSUER,
    jti: crypto.randomUUID(),
    scope: input.scope ?? ["builder:sign", "ai:extract", "ai:validate"],
    sub: input.address.toLowerCase(),
  };

  const token = await signPayload(claims);
  return { token, claims };
}

export async function issueExtensionChallengeToken(input: {
  address: string;
  chainId: number;
  message: string;
  ttlMs?: number;
}): Promise<{ token: string; claims: ExtensionChallengeClaims }> {
  const now = Date.now();
  const claims: ExtensionChallengeClaims = {
    address: input.address.toLowerCase(),
    chainId: input.chainId,
    exp: now + (input.ttlMs ?? 5 * 60 * 1000),
    iat: now,
    iss: TOKEN_ISSUER,
    message: input.message,
  };

  const token = await signPayload(claims);
  return { token, claims };
}

export async function verifyExtensionChallengeToken(
  token: string
): Promise<ExtensionChallengeClaims | null> {
  const claims = await verifyPayload<ExtensionChallengeClaims>(token);
  if (!claims) {
    return null;
  }

  if (claims.iss !== TOKEN_ISSUER || claims.exp <= Date.now()) {
    return null;
  }
  if (
    typeof claims.address !== "string" ||
    typeof claims.chainId !== "number" ||
    typeof claims.message !== "string"
  ) {
    return null;
  }

  return claims;
}

export async function verifyExtensionSessionToken(
  token: string
): Promise<ExtensionSessionClaims | null> {
  const claims = await verifyPayload<ExtensionSessionClaims>(token);
  if (!claims) {
    return null;
  }

  if (claims.aud !== TOKEN_AUDIENCE || claims.iss !== TOKEN_ISSUER) {
    return null;
  }
  if (claims.exp <= Date.now()) {
    return null;
  }
  if (!Array.isArray(claims.scope) || typeof claims.sub !== "string") {
    return null;
  }
  return claims;
}

export async function requireExtensionSession(
  request: NextRequest,
  requiredScope?: ExtensionScope
): Promise<{
  session: ExtensionSessionClaims | null;
  response: NextResponse | null;
}> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const session = await verifyExtensionSessionToken(token);
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (requiredScope && !session.scope.includes(requiredScope)) {
    return {
      session,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { session, response: null };
}
