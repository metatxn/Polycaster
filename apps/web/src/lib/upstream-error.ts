/**
 * Sanitize an upstream (Polymarket/Gamma/etc.) error response body before it is
 * written to application logs.
 *
 * Raw upstream bodies are unsafe to log verbatim (CWE-532): they can echo
 * request-derived data, user PII, or — if an upstream ever changes — credential
 * material. This helper redacts credential-like key/value pairs and bounds the
 * length so logs keep just enough diagnostic context without becoming a sink
 * for sensitive data.
 */

// Keys whose values must never reach the logs. Matched in JSON (`"token":"x"`)
// and query/form (`token=x`) shapes, case-insensitively.
const SECRET_VALUE_PATTERN =
  /("?(?:authorization|access[_-]?token|token|api[_-]?key|secret|signature|passphrase|password|cookie)"?\s*[:=]\s*"?)[^",}&]+/gi;

const DEFAULT_MAX_LENGTH = 200;

export function sanitizeUpstreamBody(
  body: string,
  maxLength: number = DEFAULT_MAX_LENGTH
): string {
  if (!body) return "";

  const redacted = body.replace(SECRET_VALUE_PATTERN, "$1[redacted]");

  if (redacted.length <= maxLength) return redacted;

  const dropped = redacted.length - maxLength;
  return `${redacted.slice(0, maxLength)}…[+${dropped} chars]`;
}
