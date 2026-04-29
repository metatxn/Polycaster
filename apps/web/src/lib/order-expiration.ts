export function formatOrderExpiration(
  expiration: string | null | undefined
): string {
  if (!expiration) return "Until cancelled";

  const expiresAt = new Date(expiration).getTime();
  if (!Number.isFinite(expiresAt)) return "Until cancelled";

  const diffMs = expiresAt - Date.now();
  if (diffMs <= 0) return "Expired";

  const seconds = Math.ceil(diffMs / 1000);
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.ceil(minutes / 60);
  const days = Math.ceil(hours / 24);

  if (seconds < 60) return `in ${formatUnit(seconds, "second")}`;
  if (minutes < 120) return `in ${formatUnit(minutes, "minute")}`;
  if (hours < 48) return `in ${formatUnit(hours, "hour")}`;
  return `in ${formatUnit(days, "day")}`;
}

function formatUnit(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}
