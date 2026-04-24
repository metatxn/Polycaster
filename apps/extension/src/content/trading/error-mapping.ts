/**
 * Maps raw trading error strings — from the CLOB, relayer, wallet, or network —
 * into a structured shape with a human title, body copy, and (optionally) a
 * diagnostic code that users can copy when reaching out to support.
 *
 * All input patterns here are tolerant of trailing whitespace, surrounding
 * JSON, and mixed case. Match strings are kept lowercased for portability.
 */

export interface MappedTradingError {
  title: string;
  body: string;
  /**
   * Diagnostic code for unmapped / pass-through errors. When set, the UI
   * should offer a "copy details" affordance so users can forward the raw
   * text to support without squinting at a truncated toast.
   */
  code?: string;
  /** Raw, untruncated error string for clipboard / logging. */
  raw: string;
}

const CLOB_PREFIX = "clob rejected order:";
const RELAYER_PREFIX_RE = /^relayer\s+\d+:/;

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

  // ── Network ─────────────────────────────────────────────────────────
  if (
    lower === "failed to fetch" ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("err_network") ||
    lower.includes("err_internet_disconnected")
  ) {
    return {
      title: "Network issue",
      body: "Check your connection and retry the order.",
      raw,
    };
  }

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return {
      title: "Taking too long",
      body: "The request didn't respond in time. Retry to start a fresh one.",
      raw,
    };
  }

  // ── Session / wallet ────────────────────────────────────────────────
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

  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return {
      title: "Signing cancelled",
      body: "You declined the wallet prompt. Retry and approve to continue.",
      raw,
    };
  }

  // ── Onboarding state ────────────────────────────────────────────────
  if (
    lower.includes("safe) is not deployed") ||
    lower.includes("safe is not deployed") ||
    lower.includes("proxy wallet not deployed")
  ) {
    return {
      title: "Trading wallet not set up",
      body: "Finish the one-click onboarding on knoww.app, then retry here.",
      raw,
    };
  }

  // ── CLOB-level rejections ───────────────────────────────────────────
  if (lower.startsWith(CLOB_PREFIX)) {
    return mapClobBody(raw.slice(CLOB_PREFIX.length).trim(), raw);
  }

  // ── Relayer-level ──────────────────────────────────────────────────
  if (RELAYER_PREFIX_RE.test(lower)) {
    return mapRelayerBody(raw, lower);
  }

  if (lower.includes("transaction failed")) {
    return {
      title: "Transaction failed",
      body: "The network rejected the transaction. This is usually transient — retry.",
      raw,
    };
  }

  // ── Unmapped — pass through, offer copy-details ─────────────────────
  return {
    title: "Order rejected",
    body: truncate(raw, 160),
    code: "UNKNOWN",
    raw,
  };
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
      body: "Your account doesn't have enough pUSD for this order. Deposit more or reduce the size.",
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
      body: "This market isn't accepting orders right now.",
      raw,
    };
  }

  if (lower.includes("tick") || lower.includes("invalid price")) {
    return {
      title: "Invalid price",
      body: "Price must match the market's tick size (usually 1¢ increments). Adjust and retry.",
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
      body: "The exchange couldn't verify your wallet signature. Reconnect and retry.",
      raw,
    };
  }

  // Unknown CLOB error — surface it with a copy affordance
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
      body: "The relayer wouldn't process the transaction. Reconnect your wallet and retry.",
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
    body: "The transaction couldn't be submitted. Retry, or reconnect your wallet if it persists.",
    code: "RELAYER_UNKNOWN",
    raw,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Simple string form — used by inline error banners (Deploy Safe gate,
 * Enable Trading gate) where a single line of copy is enough.
 */
export function formatTradingErrorLine(
  message: string | null | undefined
): string {
  const mapped = mapTradingError(message);
  return `${mapped.title}. ${mapped.body}`;
}
