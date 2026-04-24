export function formatAddress(address: string | null | undefined): string {
  if (!address) return "";
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Some traders have a `name` that's actually a raw wallet address (often
// with a suffix like `-1772479215461`). Showing the raw 42-char string
// at full width overflows on mobile and adds no information.
export function isRawAddressLike(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^0x[0-9a-fA-F]{8,}/.test(name);
}

export function displayName(
  name: string | null | undefined,
  address: string
): string {
  if (!name || isRawAddressLike(name)) return formatAddress(address);
  return name;
}

export function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatTimeExact(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Next.js will log a warning and refuse to optimize animated images like
// .gif. Detect these so we can opt out of the optimizer at the call site
// via <Image unoptimized />. Checks the extension before any query string.
export function isAnimatedImageUrl(src: string | null | undefined): boolean {
  if (!src) return false;
  const pathname = src.split("?")[0].toLowerCase();
  return pathname.endsWith(".gif");
}
