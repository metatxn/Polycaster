export const MCP_READ_SCOPE = "markets:read";

interface ProtectedResourceMetadata {
  authorizationServers: string[];
  resource: string;
  scopesSupported: string[];
}

interface AuthorizationServerMetadata {
  authorizationEndpoint: string;
  issuer: string;
  issuerRequired: boolean;
  registrationEndpoint: string;
  tokenEndpoint: string;
}

export interface OAuthTransaction {
  clientId: string;
  codeVerifier: string;
  issuer: string;
  issuerRequired: boolean;
  redirectUri: string;
  resource: string;
  state: string;
  tokenEndpoint: string;
}

export interface OAuthAuthorization {
  authorizationUrl: string;
  transaction: OAuthTransaction;
}

export interface OAuthSession {
  accessToken: string;
  expiresAt?: number;
  scope: string[];
}

function objectRecord(
  value: unknown,
  message: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function secureUrl(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is missing.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${label} is invalid.`);
  }
  return url.toString();
}

async function fetchObject(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  failureMessage: string
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw new Error(failureMessage);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(failureMessage);
  }
  return objectRecord(body, failureMessage);
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function randomValue(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64Url(new Uint8Array(digest));
}

export function protectedResourceMetadataUrl(endpoint: string): string {
  const resource = new URL(secureUrl(endpoint, "MCP endpoint"));
  const path = resource.pathname === "/" ? "" : resource.pathname;
  return new URL(
    `/.well-known/oauth-protected-resource${path}`,
    resource.origin
  ).toString();
}

export function isLocalMcpEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function authorizationServerMetadataUrl(issuer: string): string {
  const url = new URL(secureUrl(issuer, "Authorization server"));
  const path = url.pathname === "/" ? "" : url.pathname;
  return new URL(
    `/.well-known/oauth-authorization-server${path}`,
    url.origin
  ).toString();
}

async function discoverProtectedResource(
  endpoint: string,
  fetchImpl: typeof fetch
): Promise<ProtectedResourceMetadata> {
  const resource = secureUrl(endpoint, "MCP endpoint");
  const metadata = await fetchObject(
    protectedResourceMetadataUrl(resource),
    { headers: { Accept: "application/json" } },
    fetchImpl,
    "Could not read MCP authorization metadata."
  );
  const advertisedResource = secureUrl(metadata.resource, "Protected resource");
  if (advertisedResource !== resource) {
    throw new Error(
      "The authorization metadata is for a different MCP server."
    );
  }
  const authorizationServers = stringArray(metadata.authorization_servers);
  if (authorizationServers.length === 0) {
    throw new Error(
      "The MCP server did not advertise an authorization server."
    );
  }
  const scopesSupported = stringArray(metadata.scopes_supported);
  if (!scopesSupported.includes(MCP_READ_SCOPE)) {
    throw new Error(`The MCP server does not advertise ${MCP_READ_SCOPE}.`);
  }
  return { authorizationServers, resource, scopesSupported };
}

async function discoverAuthorizationServer(
  issuerValue: string,
  fetchImpl: typeof fetch
): Promise<AuthorizationServerMetadata> {
  const expectedIssuer = secureUrl(issuerValue, "Authorization server");
  const metadata = await fetchObject(
    authorizationServerMetadataUrl(expectedIssuer),
    { headers: { Accept: "application/json" } },
    fetchImpl,
    "Could not read authorization-server metadata."
  );
  const issuer = secureUrl(metadata.issuer, "Authorization issuer");
  if (issuer !== expectedIssuer) {
    throw new Error("Authorization-server issuer validation failed.");
  }
  if (
    !stringArray(metadata.code_challenge_methods_supported).includes("S256")
  ) {
    throw new Error("The authorization server does not support S256 PKCE.");
  }
  return {
    authorizationEndpoint: secureUrl(
      metadata.authorization_endpoint,
      "Authorization endpoint"
    ),
    issuer,
    issuerRequired:
      metadata.authorization_response_iss_parameter_supported === true,
    registrationEndpoint: secureUrl(
      metadata.registration_endpoint,
      "Dynamic registration endpoint"
    ),
    tokenEndpoint: secureUrl(metadata.token_endpoint, "Token endpoint"),
  };
}

async function registerBrowserClient(
  registrationEndpoint: string,
  redirectUri: string,
  fetchImpl: typeof fetch
): Promise<string> {
  const registration = await fetchObject(
    registrationEndpoint,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_name: "Knoww MCP explorer",
        redirect_uris: [secureUrl(redirectUri, "OAuth redirect URI")],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "web",
      }),
    },
    fetchImpl,
    "Could not register the browser OAuth client."
  );
  if (typeof registration.client_id !== "string" || !registration.client_id) {
    throw new Error("The authorization server returned an invalid client ID.");
  }
  return registration.client_id;
}

export async function beginOAuthAuthorization(
  endpoint: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch
): Promise<OAuthAuthorization> {
  const resourceMetadata = await discoverProtectedResource(endpoint, fetchImpl);
  const serverMetadata = await discoverAuthorizationServer(
    resourceMetadata.authorizationServers[0] ?? "",
    fetchImpl
  );
  const clientId = await registerBrowserClient(
    serverMetadata.registrationEndpoint,
    redirectUri,
    fetchImpl
  );
  const codeVerifier = randomValue(64);
  const state = randomValue(32);
  const authorizationUrl = new URL(serverMetadata.authorizationEndpoint);
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: MCP_READ_SCOPE,
    state,
    code_challenge: await pkceChallenge(codeVerifier),
    code_challenge_method: "S256",
    resource: resourceMetadata.resource,
  }).toString();
  return {
    authorizationUrl: authorizationUrl.toString(),
    transaction: {
      clientId,
      codeVerifier,
      issuer: serverMetadata.issuer,
      issuerRequired: serverMetadata.issuerRequired,
      redirectUri,
      resource: resourceMetadata.resource,
      state,
      tokenEndpoint: serverMetadata.tokenEndpoint,
    },
  };
}

export async function finishOAuthAuthorization(
  transaction: OAuthTransaction,
  callback: URLSearchParams,
  fetchImpl: typeof fetch = fetch
): Promise<OAuthSession> {
  if (callback.get("state") !== transaction.state) {
    throw new Error("OAuth state validation failed.");
  }
  const callbackIssuer = callback.get("iss");
  const normalizedCallbackIssuer = callbackIssuer
    ? secureUrl(callbackIssuer, "OAuth callback issuer")
    : null;
  const normalizedTransactionIssuer = secureUrl(
    transaction.issuer,
    "OAuth transaction issuer"
  );
  if (
    (transaction.issuerRequired && !callbackIssuer) ||
    (normalizedCallbackIssuer &&
      normalizedCallbackIssuer !== normalizedTransactionIssuer)
  ) {
    throw new Error("OAuth issuer validation failed.");
  }
  const oauthError = callback.get("error");
  if (oauthError) throw new Error(`Authorization failed: ${oauthError}.`);
  const code = callback.get("code");
  if (!code)
    throw new Error("The authorization response did not include a code.");

  const token = await fetchObject(
    transaction.tokenEndpoint,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: transaction.clientId,
        code,
        code_verifier: transaction.codeVerifier,
        redirect_uri: transaction.redirectUri,
        resource: transaction.resource,
      }),
    },
    fetchImpl,
    "Could not exchange the authorization code."
  );
  if (typeof token.access_token !== "string" || !token.access_token) {
    throw new Error("The token endpoint returned an invalid access token.");
  }
  if (
    typeof token.token_type !== "string" ||
    token.token_type.toLowerCase() !== "bearer"
  ) {
    throw new Error("The token endpoint did not return a bearer token.");
  }
  const expiresIn =
    typeof token.expires_in === "number" &&
    Number.isFinite(token.expires_in) &&
    token.expires_in > 0
      ? token.expires_in
      : undefined;
  return {
    accessToken: token.access_token,
    ...(expiresIn ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
    scope: typeof token.scope === "string" ? token.scope.split(/\s+/u) : [],
  };
}
