import { UpstreamPublicDataError } from "@knoww/services";
import type { ServerContext } from "@modelcontextprotocol/server";
import { MARKETS_READ_SCOPE } from "../auth/scopes";
import {
  KnowwToolError,
  requireToolScope,
  toKnowwToolError,
  toolFailureContent,
} from "../errors/tool-error";
import { requireToolQuota } from "../quota";
import { isAbortLike } from "./gamma";

export const WALLET_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
export const CONDITION_ID_PATTERN = /^0x[0-9a-f]{64}$/;
export const TOKEN_ID_PATTERN = /^[0-9]{1,80}$/;

export function cleanQuotedText(
  value: string | undefined,
  maxLength = 2000
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function mapPublicDataError(error: unknown): KnowwToolError {
  if (error instanceof KnowwToolError) return error;
  if (error instanceof UpstreamPublicDataError) {
    if (error.status === 429) {
      return new KnowwToolError(
        "RATE_LIMITED",
        "Polymarket rate limited this request."
      );
    }
    return new KnowwToolError(
      "UPSTREAM_UNAVAILABLE",
      "Polymarket could not serve this public data request."
    );
  }
  if (isAbortLike(error)) {
    return new KnowwToolError(
      "UPSTREAM_TIMEOUT",
      "Polymarket took too long to answer."
    );
  }
  return toKnowwToolError(error);
}

export async function executePublicRead<T>(
  toolName: string,
  _context: ServerContext,
  operation: () => Promise<T>
): Promise<T | ReturnType<typeof toolFailureContent>> {
  try {
    requireToolScope(MARKETS_READ_SCOPE);
    await requireToolQuota(toolName);
    return await operation();
  } catch (error) {
    return toolFailureContent(toolName, mapPublicDataError(error));
  }
}
