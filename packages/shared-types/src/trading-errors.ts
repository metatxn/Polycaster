/**
 * Shared trading error mapping for CLOB, relayer, wallet, and network errors.
 *
 * Keep this file dependency-free so it can run in web, extension content
 * scripts, extension background, and shared tests.
 */

export interface MappedTradingError {
  title: string;
  body: string;
  code?: string;
  raw: string;
}

const CLOB_PREFIX = "clob rejected order:";
const RELAYER_PREFIX_RE = /^relayer\s+\d+:/;

export function getErrorMessage(error: unknown, fallback = ""): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error == null) return fallback;
  return String(error);
}

function getEip1193ErrorCode(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    code?: unknown;
    cause?: { code?: unknown };
  };
  return candidate.code ?? candidate.cause?.code;
}

function getEip1193ErrorText(error: unknown): string {
  if (error instanceof Error) {
    const candidate = error as Error & {
      details?: unknown;
      shortMessage?: unknown;
    };
    return [candidate.message, candidate.shortMessage, candidate.details]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
  }
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as {
      details?: unknown;
      message?: unknown;
      shortMessage?: unknown;
    };
    return [candidate.message, candidate.shortMessage, candidate.details]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
  }
  return "";
}

export function isEip1193UserRejectedError(error: unknown): boolean {
  const code = getEip1193ErrorCode(error);
  const message = getEip1193ErrorText(error);
  // Patterns must stay user-anchored. Bare "denied" / "request rejected" /
  // "transaction signature" also match infrastructure errors — a WAF 403
  // "Access denied", the relayer proxy's "Relayer create request rejected",
  // a node's "invalid transaction signature" — and would surface them as
  // "you declined the wallet prompt". ("user denied" still covers MetaMask's
  // classic "User denied transaction signature.")
  return (
    code === 4001 ||
    /user rejected|rejected the request|user denied|user cancel/i.test(message)
  );
}

export function isEip1193UnsupportedMethodError(error: unknown): boolean {
  const code = getEip1193ErrorCode(error);
  // -32002 is a *pending* request (a wallet prompt is already open), never an
  // unsupported method — viem's rewrite ("Requested resource not available.")
  // would otherwise match a bare "not available" pattern.
  if (code === -32002) return false;
  const message = getEip1193ErrorText(error);
  // "method not allowed" is the repo's own bridge allowlist rejection (page
  // bridge + WalletConnect shim); stale pre-nonce bridges answer new methods
  // with it, and callers must treat that as method-unsupported fallback.
  // "method not available" stays method-anchored: the bare form also matched
  // viem's -32002 rewrite.
  return (
    code === 4200 ||
    code === -32601 ||
    /unsupported|not supported|does not exist|method not available|method not found|method not allowed|unrecognized/i.test(
      message
    )
  );
}

export function isEip1193PendingRequestError(error: unknown): boolean {
  const code = getEip1193ErrorCode(error);
  const message = getEip1193ErrorText(error);
  // -32002: the wallet is already showing (or queueing) a prompt for this
  // request type. Raw MetaMask says "Request of type '…' already pending";
  // viem rewrites it to "Requested resource not available."
  return (
    code === -32002 ||
    /already pending|already processing|resource not available|resource unavailable/i.test(
      message
    )
  );
}

export function isWalletRejectionError(error: unknown): boolean {
  if (isEip1193UserRejectedError(error)) return true;
  const lower = getErrorMessage(error).toLowerCase();
  // No bare "transaction signature" here: it steals CLOB/node signature
  // errors ("invalid transaction signature") from their real branches, and
  // MetaMask's classic rejection is already covered by "user denied".
  return (
    lower.includes("user rejected") ||
    lower.includes("rejected the request") ||
    lower.includes("user denied") ||
    lower.includes('"code":4001') ||
    lower.includes("code: 4001")
  );
}

export function mapTradingError(
  message: string | null | undefined
): MappedTradingError {
  const raw = (message ?? "").trim();
  if (!raw) {
    return {
      title: "Something went wrong",
      body: "Please try again.",
      raw: "",
    };
  }

  const lower = raw.toLowerCase();

  if (isNetworkErrorText(lower)) {
    return {
      title: "Network issue",
      body: "Check your connection and retry the order.",
      raw,
    };
  }

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return {
      title: "Taking too long",
      body: "The request did not respond in time. Retry to start a fresh one.",
      raw,
    };
  }

  if (
    lower.includes("session expired") ||
    lower.includes("please reconnect") ||
    lower.includes("extension_auth_required")
  ) {
    return {
      title: "Session expired",
      body: "Reconnect your wallet from the Knoww panel, then try again.",
      raw,
    };
  }

  if (isWalletRejectionError(raw)) {
    return {
      title: "Signing cancelled",
      body: "You declined the wallet prompt. Retry and approve to continue.",
      raw,
    };
  }

  if (
    lower.includes("safe) is not deployed") ||
    lower.includes("safe is not deployed") ||
    lower.includes("proxy wallet not deployed") ||
    lower.includes("deposit wallet is not deployed")
  ) {
    return {
      title: "Trading wallet not set up",
      body: "Create your trading vault in the Knoww setup flow, then retry.",
      raw,
    };
  }

  if (lower.startsWith(CLOB_PREFIX)) {
    return mapClobBody(raw.slice(CLOB_PREFIX.length).trim(), raw);
  }

  if (RELAYER_PREFIX_RE.test(lower)) {
    return mapRelayerBody(raw, lower);
  }

  if (lower.includes("transaction failed")) {
    return {
      title: "Transaction failed",
      body: "The network rejected the transaction. This is usually transient. Retry.",
      raw,
    };
  }

  return {
    title: "Order rejected",
    body: truncate(raw, 160),
    code: "UNKNOWN",
    raw,
  };
}

export function formatTradingErrorLine(
  message: string | null | undefined
): string {
  const mapped = mapTradingError(message);
  return `${mapped.title}. ${mapped.body}`;
}

export function formatCtfOperationError(
  error: unknown,
  fallback = "Operation failed"
): string {
  const message = getErrorMessage(error, fallback);
  const lower = message.toLowerCase();

  if (isWalletRejectionError(message)) return "Transaction cancelled";
  if (lower.includes("insufficient") || lower.includes("exceeds balance")) {
    return "Insufficient balance";
  }
  if (
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("connection")
  ) {
    return "Network error. Please try again.";
  }
  if (lower.includes("gas") || lower.includes("execution reverted")) {
    return "Transaction failed. Please try again.";
  }

  return message.length > 100 ? `${message.substring(0, 100)}...` : message;
}

export function formatTradingFormError(message: string): string {
  const lower = message.toLowerCase();
  if (isWalletRejectionError(message)) {
    return "Wallet request was rejected. No order was placed.";
  }
  if (lower.includes("insufficient funds")) {
    return "Not enough POL to pay gas for the approval transaction.";
  }
  if (
    lower.includes("contract call:") ||
    lower.includes("request arguments:")
  ) {
    return "Approval failed. Retry and approve the wallet prompt to continue.";
  }

  const stripped = message.replace(
    /^order\s+0x[a-f0-9]+(\.\.\.)?\s+is invalid\.\s*/i,
    ""
  );
  const reason = stripped || message;
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

export function formatTradingOnboardingError(
  error: unknown,
  fallback: string
): string {
  const message = getErrorMessage(error);
  const lower = message.toLowerCase();

  if (isWalletRejectionError(message)) {
    return "Request cancelled. No changes were made. You can try again when you're ready.";
  }
  if (lower.includes("insufficient funds") || lower.includes("gas")) {
    return "Not enough POL for network fees. Add a small amount of POL to this wallet and try again.";
  }
  if (lower.includes("chain") || lower.includes("network")) {
    return "Please switch your wallet to Polygon and try again.";
  }

  if (!message) return fallback;
  return message.length > 180 ? fallback : message;
}

function mapClobBody(body: string, raw: string): MappedTradingError {
  const lower = body.toLowerCase();

  if (
    lower.includes("insufficient balance") ||
    lower.includes("insufficient_balance") ||
    lower.includes("not enough") ||
    lower.includes("not_enough_balance")
  ) {
    return {
      title: "Not enough funds",
      body: "Your account does not have enough pUSD for this order. Deposit more or reduce the size.",
      raw,
    };
  }

  if (lower.includes("allowance")) {
    return {
      title: "Allowance missing",
      body: "Trading allowance needs to be re-enabled. Reopen the Knoww panel to fix it.",
      raw,
    };
  }

  if (
    lower.includes("market closed") ||
    lower.includes("market_closed") ||
    lower.includes("not trading") ||
    lower.includes("paused") ||
    lower.includes("suspended")
  ) {
    return {
      title: "Market closed",
      body: "This market is not accepting orders right now.",
      raw,
    };
  }

  if (lower.includes("tick") || lower.includes("invalid price")) {
    return {
      title: "Invalid price",
      body: "Price must match the market's tick size, usually 1 cent increments. Adjust and retry.",
      raw,
    };
  }

  if (
    lower.includes("min_size") ||
    lower.includes("min size") ||
    lower.includes("minimum size") ||
    lower.includes("below min")
  ) {
    return {
      title: "Order too small",
      body: "Size is below this market's minimum. Increase it and retry.",
      raw,
    };
  }

  if (
    lower.includes("max_size") ||
    lower.includes("max size") ||
    lower.includes("maximum size") ||
    lower.includes("exceeds max")
  ) {
    return {
      title: "Order too large",
      body: "Size exceeds this market's maximum. Reduce it and retry.",
      raw,
    };
  }

  if (
    lower.includes("orderbook") ||
    lower.includes("no matching") ||
    lower.includes("would take too much") ||
    lower.includes("price_out_of_range")
  ) {
    return {
      title: "Price moved",
      body: "The order book shifted before your order landed. Refresh the quote and retry.",
      raw,
    };
  }

  if (
    lower.includes("signature") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid signer")
  ) {
    return {
      title: "Signing failed",
      body: "The exchange could not verify your wallet signature. Reconnect and retry.",
      raw,
    };
  }

  return {
    title: "Order rejected by exchange",
    body: truncate(body, 160) || "The exchange rejected this order.",
    code: "CLOB_UNKNOWN",
    raw,
  };
}

function mapRelayerBody(raw: string, lower: string): MappedTradingError {
  if (lower.includes("relayer 400") || lower.includes("bad request")) {
    return {
      title: "Relayer rejected",
      body: "The relayer would not process the transaction. Reconnect your wallet and retry.",
      code: "RELAYER_400",
      raw,
    };
  }
  if (
    lower.includes("relayer 502") ||
    lower.includes("relayer 503") ||
    lower.includes("relayer 504")
  ) {
    return {
      title: "Relayer unavailable",
      body: "The relayer is temporarily down. Wait a moment and retry.",
      raw,
    };
  }
  return {
    title: "Relayer error",
    body: "The transaction could not be submitted. Retry, or reconnect your wallet if it persists.",
    code: "RELAYER_UNKNOWN",
    raw,
  };
}

function isNetworkErrorText(lower: string): boolean {
  return (
    lower === "failed to fetch" ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("err_network") ||
    lower.includes("err_internet_disconnected")
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}
