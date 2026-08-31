import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = [
  "https://accounts.google.com",
  "accounts.google.com",
] as const;
const GOOGLE_SCOPES = "openid email";
const TOKEN_RESPONSE_LIMIT_BYTES = 64 * 1024;
const GOOGLE_SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;

const googleTokenResponseSchema = z.object({
  id_token: z
    .string()
    .min(1)
    .max(16 * 1024),
});

const googleTokenErrorResponseSchema = z.object({
  error: z.string().min(1).max(128),
});

const GOOGLE_OAUTH_ERROR_CODES = new Set<GoogleOAuthError>([
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
]);

const googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI), {
  cacheMaxAge: 60 * 60 * 1000,
  cooldownDuration: 30 * 1000,
  timeoutDuration: 5 * 1000,
});

export interface GoogleIdentity {
  subject: string;
}

export interface GoogleAuthenticationInput {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
}

export type GoogleAuthenticator = (
  input: GoogleAuthenticationInput
) => Promise<GoogleIdentity>;

export type GoogleAuthenticationStage =
  | "token_exchange"
  | "id_token_verification";

export type GoogleAuthenticationFailure =
  | "request_failed"
  | "upstream_rejected"
  | "invalid_response"
  | "verification_failed";

export type GoogleOAuthError =
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type";

interface GoogleAuthenticationErrorInput {
  googleFailure: GoogleAuthenticationFailure;
  googleOAuthError?: GoogleOAuthError | "unknown";
  googleStage: GoogleAuthenticationStage;
  googleUpstreamStatus?: number;
}

export interface GoogleAuthenticationLogFields {
  googleFailure: GoogleAuthenticationFailure | "unexpected_error";
  googleOAuthError?: GoogleOAuthError | "unknown";
  googleStage: GoogleAuthenticationStage | "unknown";
  googleUpstreamStatus?: number;
}

export class GoogleAuthenticationError extends Error {
  readonly googleFailure: GoogleAuthenticationFailure;
  readonly googleOAuthError?: GoogleOAuthError | "unknown";
  readonly googleStage: GoogleAuthenticationStage;
  readonly googleUpstreamStatus?: number;

  constructor(input: GoogleAuthenticationErrorInput) {
    super(
      input.googleStage === "id_token_verification"
        ? "Google identity could not be verified."
        : "Google authentication failed."
    );
    this.name = "GoogleAuthenticationError";
    this.googleFailure = input.googleFailure;
    this.googleOAuthError = input.googleOAuthError;
    this.googleStage = input.googleStage;
    this.googleUpstreamStatus = input.googleUpstreamStatus;
  }
}

export function googleAuthenticationLogFields(
  error: unknown
): GoogleAuthenticationLogFields {
  if (!(error instanceof GoogleAuthenticationError)) {
    return {
      googleFailure: "unexpected_error",
      googleStage: "unknown",
    };
  }
  return {
    googleFailure: error.googleFailure,
    googleStage: error.googleStage,
    ...(error.googleOAuthError === undefined
      ? {}
      : { googleOAuthError: error.googleOAuthError }),
    ...(error.googleUpstreamStatus === undefined
      ? {}
      : { googleUpstreamStatus: error.googleUpstreamStatus }),
  };
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function readBoundedText(
  response: Response,
  limitBytes: number
): Promise<string> {
  if (!response.body) throw new Error("Google authentication failed.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limitBytes) {
      await reader.cancel();
      throw new Error("Google authentication failed.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function sanitizeGoogleOAuthError(value: string): GoogleOAuthError | "unknown" {
  return GOOGLE_OAUTH_ERROR_CODES.has(value as GoogleOAuthError)
    ? (value as GoogleOAuthError)
    : "unknown";
}

async function readGoogleOAuthError(
  response: Response
): Promise<GoogleOAuthError | "unknown"> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return "unknown";
  }
  try {
    const body: unknown = JSON.parse(
      await readBoundedText(response, TOKEN_RESPONSE_LIMIT_BYTES)
    );
    const parsed = googleTokenErrorResponseSchema.safeParse(body);
    return parsed.success
      ? sanitizeGoogleOAuthError(parsed.data.error)
      : "unknown";
  } catch {
    return "unknown";
  }
}

export async function createGooglePkce(): Promise<{
  challenge: string;
  verifier: string;
}> {
  const verifier = randomBase64Url(64);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return { challenge: toBase64Url(digest), verifier };
}

export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  codeChallenge: string;
  nonce: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    nonce: input.nonce,
    prompt: "select_account",
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    state: input.state,
  }).toString();
  return url.toString();
}

export async function exchangeGoogleAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
  redirectUri: string;
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleAuthenticationError({
      googleFailure: "request_failed",
      googleStage: "token_exchange",
    });
  }
  if (!response.ok) {
    throw new GoogleAuthenticationError({
      googleFailure: "upstream_rejected",
      googleOAuthError: await readGoogleOAuthError(response),
      googleStage: "token_exchange",
      googleUpstreamStatus: response.status,
    });
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new GoogleAuthenticationError({
      googleFailure: "invalid_response",
      googleStage: "token_exchange",
    });
  }
  let body: unknown;
  try {
    body = JSON.parse(
      await readBoundedText(response, TOKEN_RESPONSE_LIMIT_BYTES)
    );
  } catch {
    throw new GoogleAuthenticationError({
      googleFailure: "invalid_response",
      googleStage: "token_exchange",
    });
  }
  const parsed = googleTokenResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new GoogleAuthenticationError({
      googleFailure: "invalid_response",
      googleStage: "token_exchange",
    });
  }
  return parsed.data.id_token;
}

export async function verifyGoogleIdToken(input: {
  clientId: string;
  idToken: string;
  keyResolver?: JWTVerifyGetKey;
  nonce: string;
}): Promise<GoogleIdentity> {
  try {
    const { payload } = await jwtVerify(
      input.idToken,
      input.keyResolver ?? googleJwks,
      {
        algorithms: ["RS256"],
        audience: input.clientId,
        clockTolerance: 5,
        issuer: [...GOOGLE_ISSUERS],
        maxTokenAge: "10m",
        requiredClaims: ["sub", "nonce", "email", "email_verified"],
      }
    );
    if (
      payload.nonce !== input.nonce ||
      payload.email_verified !== true ||
      typeof payload.email !== "string" ||
      !GOOGLE_SUBJECT_PATTERN.test(payload.sub ?? "") ||
      (payload.azp !== undefined && payload.azp !== input.clientId)
    ) {
      throw new Error("Invalid Google claims.");
    }
    return { subject: payload.sub as string };
  } catch {
    throw new GoogleAuthenticationError({
      googleFailure: "verification_failed",
      googleStage: "id_token_verification",
    });
  }
}

export const authenticateWithGoogle: GoogleAuthenticator = async (input) => {
  const idToken = await exchangeGoogleAuthorizationCode(input);
  return verifyGoogleIdToken({
    clientId: input.clientId,
    idToken,
    nonce: input.nonce,
  });
};
