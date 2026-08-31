import { OAuthError, OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createLogger } from "@knoww/logger";
import type { WorkerConfig } from "../config";
import { currentRequestId } from "../context";
import { mcpOAuthApiHandler } from "./api";
import { createConsentHandler } from "./consent";
import { authenticateWithGoogle, type GoogleAuthenticator } from "./google";
import { ACTIVE_MCP_SCOPES, validateMcpAuthProps } from "./scopes";
import type { McpOAuthEnv } from "./types";

const log = createLogger("mcp.oauth");
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const DYNAMIC_CLIENT_TTL_SECONDS = 30 * 24 * 60 * 60;

const providerCache = new Map<string, OAuthProvider<McpOAuthEnv>>();
const activeScopeSet = new Set<string>(ACTIVE_MCP_SCOPES);

export function oauthProviderFor(
  config: WorkerConfig
): OAuthProvider<McpOAuthEnv> {
  const cacheKey = JSON.stringify([
    config.canonicalResource,
    config.allowedHostnames,
    config.allowedOriginHostnames,
  ]);
  let provider = providerCache.get(cacheKey);
  if (provider) return provider;

  provider = createOAuthProvider(config);
  providerCache.set(cacheKey, provider);
  return provider;
}

export function createOAuthProvider(
  config: WorkerConfig,
  googleAuthenticator: GoogleAuthenticator = authenticateWithGoogle
): OAuthProvider<McpOAuthEnv> {
  return new OAuthProvider<McpOAuthEnv>({
    apiRoute: "/mcp",
    apiHandler: mcpOAuthApiHandler,
    defaultHandler: createConsentHandler(config, googleAuthenticator),
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTTL: REFRESH_TOKEN_TTL_SECONDS,
    clientRegistrationTTL: DYNAMIC_CLIENT_TTL_SECONDS,
    scopesSupported: [...ACTIVE_MCP_SCOPES],
    allowImplicitFlow: false,
    allowPlainPKCE: false,
    allowTokenExchangeGrant: false,
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      resource: config.canonicalResource,
      scopes_supported: [...ACTIVE_MCP_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "Knoww prediction-market MCP",
    },
    tokenExchangeCallback(options) {
      const props = validateMcpAuthProps(options.props);
      if (!props) {
        throw new OAuthError("invalid_grant", {
          description: "The authorization grant is invalid.",
        });
      }
      const requested = options.requestedScope;
      if (
        requested.some(
          (scope) =>
            !activeScopeSet.has(scope) ||
            !props.scopes.includes(scope as (typeof props.scopes)[number])
        )
      ) {
        throw new OAuthError("invalid_scope", {
          description: "The requested scope is not available.",
        });
      }
      return {
        accessTokenProps: {
          ...props,
          scopes: requested,
        },
      };
    },
    onError(error) {
      log.warn("request.denied", {
        requestId: currentRequestId(),
        code: error.code,
        status: error.status,
        category: error.internal?.category,
        reason: error.internal?.reason,
      });
    },
  });
}
