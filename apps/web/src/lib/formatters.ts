import Decimal from "decimal.js";

/**
 * Format volume numbers into human-readable strings (e.g., $1.2M, $500K)
 */
export function formatVolume(vol?: number | string) {
  if (vol === undefined || vol === null || vol === "") return "N/A";
  const num = typeof vol === "string" ? Number.parseFloat(vol) : vol;
  if (Number.isNaN(num)) return "N/A";
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Format a price (0-1) into cents with one decimal (e.g., 0.753 -> 75.3¢)
 * Uses one decimal place for sub-cent precision consistent with order book and trading UI.
 */
export function formatPrice(price: string | number) {
  try {
    const value = new Decimal(price);
    if (!value.isFinite()) return "0.0¢";
    return `${value.mul(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1)}¢`;
  } catch {
    return "0.0¢";
  }
}

/**
 * Canonical price-in-cents display. Adaptive precision (owner decision,
 * 2026-06-11): never round away available sub-cent precision — this is a
 * financial app — but don't show a noisy ".0" when the value is whole.
 *   0.75   -> "75¢"
 *   0.753  -> "75.3¢"   (one decimal, Decimal half-up)
 */
export function formatCents(price: string | number): string {
  try {
    const cents = new Decimal(price).mul(100);
    if (!cents.isFinite()) return "0¢";
    const rounded = cents.toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
    return rounded.isInteger()
      ? `${rounded.toFixed(0)}¢`
      : `${rounded.toFixed(1)}¢`;
  } catch {
    return "0¢";
  }
}

/**
 * Trade ticket profit label (potentialWin − total), computed in Decimal.
 * Owner rule: no "+" on gains; losses render -$X.XX (sign before $). Sign
 * derives from the ROUNDED magnitude so a sub-cent loss can't show "-$0.00".
 */
export function formatProfitLabel(potentialWin: number, total: number): string {
  const profit = new Decimal(potentialWin).sub(total);
  const magnitude = profit.abs().toFixed(2);
  const sign = profit.isNegative() && magnitude !== "0.00" ? "-" : "";
  return `${sign}$${magnitude}`;
}

/**
 * Format currency values (e.g., $1,234.56)
 */
export function formatCurrency(value: number, showSign = false): string {
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : value > 0 && showSign ? "+" : "";
  const formatted = absValue.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${formatted}`;
}

/**
 * Format currency values compactly for large numbers (e.g., $1.2M, $500K)
 */
export function formatCurrencyCompact(value: number, showSign = false): string {
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : value > 0 && showSign ? "+" : "";

  if (absValue >= 1_000_000_000) {
    return `${sign}$${(absValue / 1_000_000_000).toFixed(2)}B`;
  }
  if (absValue >= 1_000_000) {
    return `${sign}$${(absValue / 1_000_000).toFixed(2)}M`;
  }
  if (absValue >= 1_000) {
    return `${sign}$${(absValue / 1_000).toFixed(2)}K`;
  }
  return `${sign}$${absValue.toFixed(2)}`;
}

/**
 * Format percentage values (e.g., +12.34%)
 */
export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

/**
 * Format a wallet address for display (e.g., 0x1234...5678)
 */
export function formatAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * One relative-time formatter for both UI styles:
 *   compact -> "5m" / "3h" / "2d"      (tickers, tables)
 *   verbose -> "5m ago" / "just now"   (feeds, notifications)
 * `nowMs` is injectable for tests and useNow() integration.
 */
export function relativeTime(
  timestamp: string | number | Date,
  style: "compact" | "verbose" = "verbose",
  nowMs: number = Date.now()
): string {
  const then = new Date(timestamp).getTime();
  const diffMins = Math.floor((nowMs - then) / 60_000);
  if (style === "verbose" && diffMins < 1) return "just now";
  const units: Array<[number, string]> = [
    [60 * 24 * 30 * 12, "y"],
    [60 * 24 * 30, "mo"],
    [60 * 24, "d"],
    [60, "h"],
    [1, "m"],
  ];
  for (const [mins, label] of units) {
    if (diffMins >= mins) {
      const v = `${Math.floor(diffMins / mins)}${label}`;
      return style === "compact" ? v : `${v} ago`;
    }
  }
  return style === "compact" ? "0m" : "just now";
}

/**
 * Get a relative time string (e.g., 5m ago, 2h ago)
 */
export function timeAgo(timestamp: string | number | Date): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffMonths < 12) return `${diffMonths} mo ago`;
  return then.toLocaleDateString();
}
