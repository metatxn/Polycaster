import { getAddress, isAddress } from "viem";

export const MARKETS_READ_SCOPE = "markets:read" as const;
export const FREE_MCP_PLAN = "free" as const;
export type McpPlan = typeof FREE_MCP_PLAN;

/**
 * Reserved for a later, separately reviewed x402 tool slice. This scope will
 * allow a client to attempt paid tools; it will never authorize Knoww to sign
 * a wallet payment or bypass verification of an x402 payment proof.
 */
export const FUTURE_X402_SCOPE = "x402:pay" as const;

export const ACTIVE_MCP_SCOPES = [MARKETS_READ_SCOPE] as const;

export type ActiveMcpScope = (typeof ACTIVE_MCP_SCOPES)[number];

const activeScopeSet = new Set<string>(ACTIVE_MCP_SCOPES);

export interface McpAuthProps {
  authMethod: "wallet-signature";
  principalId: string;
  walletAddress: `0x${string}`;
  plan: McpPlan;
  scopes: ActiveMcpScope[];
}

export function resolveRequestedScopes(
  requested: readonly string[]
): ActiveMcpScope[] {
  const effective = requested.length === 0 ? ACTIVE_MCP_SCOPES : requested;
  const unique: ActiveMcpScope[] = [];
  for (const scope of effective) {
    if (!activeScopeSet.has(scope)) {
      throw new Error(`Unsupported OAuth scope: ${scope}`);
    }
    if (!unique.includes(scope as ActiveMcpScope)) {
      unique.push(scope as ActiveMcpScope);
    }
  }
  return unique;
}

export function hasScope(
  scopes: readonly string[],
  requiredScope: ActiveMcpScope
): boolean {
  return scopes.includes(requiredScope);
}

export function validateMcpAuthProps(value: unknown): McpAuthProps | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.authMethod !== "wallet-signature") return null;
  if (candidate.plan !== FREE_MCP_PLAN) return null;
  if (
    typeof candidate.walletAddress !== "string" ||
    !isAddress(candidate.walletAddress)
  ) {
    return null;
  }
  if (!Array.isArray(candidate.scopes)) return null;
  const scopes: ActiveMcpScope[] = [];
  for (const scope of candidate.scopes) {
    if (typeof scope !== "string" || !activeScopeSet.has(scope)) return null;
    if (!scopes.includes(scope as ActiveMcpScope)) {
      scopes.push(scope as ActiveMcpScope);
    }
  }
  const walletAddress = getAddress(candidate.walletAddress);
  const principalId = `wallet-${walletAddress.toLowerCase()}`;
  if (candidate.principalId !== principalId) return null;

  return {
    authMethod: "wallet-signature",
    principalId,
    walletAddress,
    plan: FREE_MCP_PLAN,
    scopes,
  };
}
