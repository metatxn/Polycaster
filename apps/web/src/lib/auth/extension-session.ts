import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type NextRequest, NextResponse } from "next/server";

const TOKEN_AUDIENCE = "knoww-extension";
const TOKEN_ISSUER = "knoww.app";
const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_RECORD_PREFIX = "extension-sessions/v1/records";
const SUBJECT_RECORD_PREFIX = "extension-sessions/v1/subjects";

export type ExtensionScope =
  | "builder:sign"
  | "ai:extract"
  | "ai:validate"
  | "relayer:submit";

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

type ExtensionSessionStatus = "active" | "revoked";

interface ExtensionSessionRecord {
  chainId: number;
  expiresAt: number;
  issuedAt: number;
  jti: string;
  revokedAt?: number;
  scope: ExtensionScope[];
  status: ExtensionSessionStatus;
  sub: string;
  updatedAt: number;
}

interface ExtensionSubjectRecord {
  currentJti: string;
  expiresAt: number;
  sub: string;
  updatedAt: number;
}

const memorySessionRecords = new Map<string, ExtensionSessionRecord>();
const memorySubjectRecords = new Map<string, ExtensionSubjectRecord>();

function getSessionSecret(): string | null {
  return process.env.EXTENSION_SESSION_SECRET || null;
}

type ExtensionSessionStore =
  | {
      kind: "memory";
    }
  | {
      bucket: R2Bucket;
      kind: "r2";
    };

function getSessionRecordKey(jti: string): string {
  return `${SESSION_RECORD_PREFIX}/${jti}.json`;
}

function getSubjectRecordKey(sub: string): string {
  return `${SUBJECT_RECORD_PREFIX}/${sub}.json`;
}

let memoryFallbackWarned = false;

async function getExtensionSessionStore(): Promise<ExtensionSessionStore> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    if (env.NEXT_INC_CACHE_R2_BUCKET) {
      return {
        kind: "r2",
        bucket: env.NEXT_INC_CACHE_R2_BUCKET,
      };
    }
  } catch {
    // Fall back to process-local memory in environments without Cloudflare bindings.
  }

  if (process.env.NODE_ENV === "production" && !memoryFallbackWarned) {
    memoryFallbackWarned = true;
    console.warn(
      "[extension-session] R2 bucket unavailable — using in-memory session store. " +
        "Session revocation will NOT persist across isolates or redeployments."
    );
  }

  return { kind: "memory" };
}

async function readStoreJson<T>(key: string): Promise<T | null> {
  const store = await getExtensionSessionStore();
  if (store.kind === "r2") {
    const object = await store.bucket.get(key);
    if (!object) return null;

    try {
      return await object.json<T>();
    } catch {
      return null;
    }
  }

  if (key.startsWith(`${SESSION_RECORD_PREFIX}/`)) {
    return (memorySessionRecords.get(key) as T | undefined) ?? null;
  }

  return (memorySubjectRecords.get(key) as T | undefined) ?? null;
}

async function writeStoreJson<T>(key: string, value: T): Promise<void> {
  const store = await getExtensionSessionStore();
  if (store.kind === "r2") {
    await store.bucket.put(key, JSON.stringify(value), {
      httpMetadata: { contentType: "application/json" },
    });
    return;
  }

  if (key.startsWith(`${SESSION_RECORD_PREFIX}/`)) {
    memorySessionRecords.set(key, value as ExtensionSessionRecord);
    return;
  }

  memorySubjectRecords.set(key, value as ExtensionSubjectRecord);
}

async function deleteStoreKey(key: string): Promise<void> {
  const store = await getExtensionSessionStore();
  if (store.kind === "r2") {
    await store.bucket.delete(key);
    return;
  }

  if (key.startsWith(`${SESSION_RECORD_PREFIX}/`)) {
    memorySessionRecords.delete(key);
    return;
  }

  memorySubjectRecords.delete(key);
}

async function getStoredSessionRecord(
  jti: string
): Promise<ExtensionSessionRecord | null> {
  const record = await readStoreJson<ExtensionSessionRecord>(
    getSessionRecordKey(jti)
  );
  if (!record) return null;

  if (record.expiresAt <= Date.now()) {
    await deleteStoreKey(getSessionRecordKey(jti));
    return null;
  }

  return record;
}

async function getStoredSubjectRecord(
  sub: string
): Promise<ExtensionSubjectRecord | null> {
  const record = await readStoreJson<ExtensionSubjectRecord>(
    getSubjectRecordKey(sub)
  );
  if (!record) return null;

  if (record.expiresAt <= Date.now()) {
    await deleteStoreKey(getSubjectRecordKey(sub));
    return null;
  }

  return record;
}

async function registerExtensionSession(
  claims: ExtensionSessionClaims
): Promise<void> {
  const now = Date.now();
  const currentSubjectRecord = await getStoredSubjectRecord(claims.sub);

  if (
    currentSubjectRecord?.currentJti &&
    currentSubjectRecord.currentJti !== claims.jti
  ) {
    const previousSession = await getStoredSessionRecord(
      currentSubjectRecord.currentJti
    );

    if (previousSession && previousSession.status === "active") {
      await writeStoreJson(getSessionRecordKey(previousSession.jti), {
        ...previousSession,
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      });
    }
  }

  const record: ExtensionSessionRecord = {
    chainId: claims.chainId,
    expiresAt: claims.exp,
    issuedAt: claims.iat,
    jti: claims.jti,
    scope: claims.scope,
    status: "active",
    sub: claims.sub,
    updatedAt: now,
  };

  const subjectRecord: ExtensionSubjectRecord = {
    currentJti: claims.jti,
    expiresAt: claims.exp,
    sub: claims.sub,
    updatedAt: now,
  };

  await writeStoreJson(getSessionRecordKey(claims.jti), record);
  await writeStoreJson(getSubjectRecordKey(claims.sub), subjectRecord);
}

async function isPersistedSessionActive(
  claims: ExtensionSessionClaims
): Promise<boolean> {
  const sessionRecord = await getStoredSessionRecord(claims.jti);
  if (!sessionRecord) {
    return false;
  }

  if (sessionRecord.status !== "active" || sessionRecord.sub !== claims.sub) {
    return false;
  }

  const subjectRecord = await getStoredSubjectRecord(claims.sub);
  if (subjectRecord?.currentJti !== claims.jti) {
    return false;
  }

  return true;
}

export async function revokeExtensionSession(
  claims: ExtensionSessionClaims
): Promise<void> {
  const now = Date.now();
  const existingRecord = await getStoredSessionRecord(claims.jti);

  const revokedRecord: ExtensionSessionRecord = existingRecord
    ? {
        ...existingRecord,
        status: "revoked",
        revokedAt: existingRecord.revokedAt ?? now,
        updatedAt: now,
      }
    : {
        chainId: claims.chainId,
        expiresAt: claims.exp,
        issuedAt: claims.iat,
        jti: claims.jti,
        revokedAt: now,
        scope: claims.scope,
        status: "revoked",
        sub: claims.sub,
        updatedAt: now,
      };

  await writeStoreJson(getSessionRecordKey(claims.jti), revokedRecord);

  const subjectRecord = await getStoredSubjectRecord(claims.sub);
  if (subjectRecord?.currentJti === claims.jti) {
    await deleteStoreKey(getSubjectRecordKey(claims.sub));
  }
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
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  let signatureBytes: Uint8Array;
  try {
    const raw = fromBase64Url(signature);
    signatureBytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      signatureBytes[i] = raw.charCodeAt(i);
    }
  } catch {
    return false;
  }

  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes.buffer as ArrayBuffer,
    encoder.encode(message)
  );
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
    scope: input.scope ?? [
      "builder:sign",
      "ai:extract",
      "ai:validate",
      "relayer:submit",
    ],
    sub: input.address.toLowerCase(),
  };

  const token = await signPayload(claims);
  await registerExtensionSession(claims);
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
  if (!(await isPersistedSessionActive(claims))) {
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
