import { getAddress, isAddress, verifyMessage } from "viem";

const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9]{8,128}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;

export interface WalletLoginMessageInput {
  address: string;
  chainId: number;
  challengeId: string;
  clientName: string;
  expirationTime: string;
  issuedAt: string;
  resource: string;
  scopes: readonly string[];
}

export function normalizeClientName(value: string | undefined): string {
  const withoutControls = Array.from(value ?? "Unnamed MCP client", (char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : char;
  }).join("");
  const normalized = withoutControls.replace(/\s+/g, " ").trim().slice(0, 100);
  return normalized || "Unnamed MCP client";
}

export function buildWalletLoginMessage(
  input: WalletLoginMessageInput
): string {
  if (!isAddress(input.address)) throw new Error("Invalid wallet address.");
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) {
    throw new Error("Invalid chain ID.");
  }
  if (!CHALLENGE_ID_PATTERN.test(input.challengeId)) {
    throw new Error("Invalid challenge ID.");
  }
  const resource = new URL(input.resource);
  if (!/^https?:$/.test(resource.protocol)) {
    throw new Error("Invalid MCP resource.");
  }
  if (
    Number.isNaN(Date.parse(input.issuedAt)) ||
    Number.isNaN(Date.parse(input.expirationTime))
  ) {
    throw new Error("Invalid challenge timestamps.");
  }

  const clientName = normalizeClientName(input.clientName);
  const resources = [
    resource.toString(),
    ...input.scopes.map(
      (scope) => `urn:knoww:mcp:scope:${encodeURIComponent(scope)}`
    ),
  ];

  return `${resource.host} wants you to sign in with your Ethereum account:
${getAddress(input.address)}

Authorize ${clientName} to access Knoww MCP.

URI: ${resource.toString()}
Version: 1
Chain ID: ${input.chainId}
Nonce: ${input.challengeId}
Issued At: ${input.issuedAt}
Expiration Time: ${input.expirationTime}
Resources:
${resources.map((entry) => `- ${entry}`).join("\n")}`;
}

export async function verifyWalletLoginSignature(input: {
  address: string;
  message: string;
  signature: string;
}): Promise<`0x${string}` | null> {
  if (!isAddress(input.address) || !SIGNATURE_PATTERN.test(input.signature)) {
    return null;
  }
  const address = getAddress(input.address);
  try {
    const valid = await verifyMessage({
      address,
      message: input.message,
      signature: input.signature as `0x${string}`,
    });
    return valid ? address : null;
  } catch {
    return null;
  }
}
