import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/** The provider injects OAUTH_PROVIDER before invoking application handlers. */
export type McpOAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
