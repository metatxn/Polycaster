/**
 * Format volume numbers into human-readable strings (e.g., $1.2M, $500K)
 */
export function formatVolume(vol?: number | string) {
  if (vol === undefined || vol === null || vol === "") return "N/A";
  const num = typeof vol === "string" ? Number.parseFloat(vol) : vol;
  if (Number.isNaN(num)) return "N/A";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Format a price (0-1) into cents with one decimal (e.g., 0.753 -> 75.3¢)
 * Uses one decimal place for sub-cent precision consistent with order book and trading UI.
 */
export function formatPrice(price: string | number) {
  const num = typeof price === "string" ? Number.parseFloat(price) : price;
  if (Number.isNaN(num)) return "0.0¢";
  return `${(num * 100).toFixed(1)}¢`;
}

/**
 * Format currency values (e.g., $1,234.56)
 */
export function formatCurrency(value: number, showSign = false): string {
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : value > 0 && showSign ? "+" : "";
  return `${sign}$${absValue.toFixed(2)}`;
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
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Format a wallet address for display (e.g., 0x1234...5678)
 */
export function formatAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
