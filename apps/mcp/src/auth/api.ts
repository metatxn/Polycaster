import { createLogger } from "@knoww/logger";
import { workerConfigFromEnv } from "../config";
import {
  currentRequestId,
  type RequestPrincipal,
  requestContext,
} from "../context";
import { dispatchMcpRequest } from "../mcp-handler";
import { checkPrincipalQuota, quotaResponse, toolLimiterFor } from "../quota";
import { hasScope, MARKETS_READ_SCOPE, validateMcpAuthProps } from "./scopes";
import type { McpOAuthEnv } from "./types";

type OAuthExecutionContext = ExecutionContext & { props?: unknown };
const log = createLogger("mcp.quota");

function resourceMetadataUrl(request: Request): string {
  return new URL(
    "/.well-known/oauth-protected-resource/mcp",
    request.url
  ).toString();
}

function authError(
  request: Request,
  status: 401 | 403,
  code: "UNAUTHENTICATED" | "FORBIDDEN",
  requiredScope?: string
): Response {
  const requestId = currentRequestId();
  const challenge = [
    "Bearer",
    status === 401 ? 'error="invalid_token"' : 'error="insufficient_scope"',
    `resource_metadata="${resourceMetadataUrl(request)}"`,
    ...(requiredScope ? [`scope="${requiredScope}"`] : []),
  ].join(", ");
  return Response.json(
    {
      error: {
        code,
        message:
          status === 401
            ? "Authentication required."
            : "The access token lacks the required scope.",
        requestId,
      },
    },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "www-authenticate": challenge,
        "x-request-id": requestId,
      },
    }
  );
}

export const mcpOAuthApiHandler = {
  async fetch(
    request: Request,
    env: McpOAuthEnv,
    executionContext: ExecutionContext
  ): Promise<Response> {
    const props = validateMcpAuthProps(
      (executionContext as OAuthExecutionContext).props
    );
    if (!props) return authError(request, 401, "UNAUTHENTICATED");
    if (!hasScope(props.scopes, MARKETS_READ_SCOPE)) {
      return authError(request, 403, "FORBIDDEN", MARKETS_READ_SCOPE);
    }

    const principal: RequestPrincipal = {
      authMethod: props.authMethod,
      id: props.principalId,
      plan: props.plan,
      scopes: props.scopes,
      walletAddress: props.walletAddress,
    };
    const config = workerConfigFromEnv(env);
    if (!(await checkPrincipalQuota(env, principal))) {
      log.warn("principal.denied", {
        requestId: currentRequestId(),
        plan: principal.plan,
        reason: "rate_limited",
      });
      return quotaResponse(currentRequestId());
    }

    return requestContext.run(
      {
        requestId: currentRequestId(),
        principal,
        toolRateLimiter: toolLimiterFor(env, principal.plan),
      },
      () => dispatchMcpRequest(request, env, executionContext, config)
    );
  },
};
