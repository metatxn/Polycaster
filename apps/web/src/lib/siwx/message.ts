const STATEMENT = "Sign in to Knoww";

function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.ALLOWED_ORIGIN ||
    "http://localhost:8787"
  );
}

function createNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function buildSiwxMessage(input: {
  address: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}): string {
  const baseUrl = getBaseUrl();
  const domain = new URL(baseUrl).host;

  return `${domain} wants you to sign in with your Ethereum account:
${input.address}

${STATEMENT}

URI: ${baseUrl}
Version: 1
Chain ID: ${input.chainId}
Nonce: ${input.nonce}
Issued At: ${input.issuedAt}
Expiration Time: ${input.expirationTime}`;
}

export function createSiwxChallenge(input: {
  address: string;
  chainId: number;
}): {
  expirationTime: string;
  issuedAt: string;
  message: string;
  nonce: string;
} {
  const nonce = createNonce();
  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  return {
    message: buildSiwxMessage({
      address: input.address,
      chainId: input.chainId,
      nonce,
      issuedAt,
      expirationTime,
    }),
    nonce,
    issuedAt,
    expirationTime,
  };
}
