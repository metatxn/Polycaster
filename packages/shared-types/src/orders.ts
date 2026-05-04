export type LimitExpirationType = "GTC" | "GTD";
export type ExpirationDurationPreset = "1h" | "4h" | "24h" | "7d" | "30d";
export type ExpirationPreset = "GTC" | ExpirationDurationPreset;

export const LIMIT_EXPIRATION_PRESETS: Array<{
  label: ExpirationDurationPreset;
  value: number;
}> = [
  { label: "1h", value: 3600 },
  { label: "4h", value: 14_400 },
  { label: "24h", value: 86_400 },
  { label: "7d", value: 604_800 },
  { label: "30d", value: 2_592_000 },
];

export const ORDER_EXPIRATION_PRESETS: ExpirationPreset[] = [
  "GTC",
  ...LIMIT_EXPIRATION_PRESETS.map((preset) => preset.label),
];

export const EXPIRATION_SECONDS_BY_PRESET: Record<ExpirationPreset, number> = {
  GTC: 0,
  "1h": 3600,
  "4h": 14_400,
  "24h": 86_400,
  "7d": 604_800,
  "30d": 2_592_000,
};

export function getGtdExpirationTimestamp(
  preset: ExpirationDurationPreset,
  nowMs: number = Date.now(),
  bufferSeconds = 60
): number {
  return (
    Math.floor(nowMs / 1000) +
    EXPIRATION_SECONDS_BY_PRESET[preset] +
    bufferSeconds
  );
}

export function formatExpirationDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

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
