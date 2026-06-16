import type { LiveEvent } from "./types";

// ── Time formatting for scheduled events ────────────────────────────

export function parseGammaDate(input?: string): Date | null {
  if (!input) return null;
  const normalized =
    input.includes("T") || input.endsWith("Z")
      ? input
      : input.replace(" ", "T");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getGameStartTime(event: LiveEvent): Date | null {
  // Sports events expose kickoff separately from `startDate`; `startDate` is
  // often the market creation/open timestamp and should only be a fallback.
  const eventKickoff = parseGammaDate(event.startTime);
  if (eventKickoff) return eventKickoff;

  // Scan all markets for the earliest valid gameStartTime
  if (event.markets) {
    let earliest: Date | null = null;
    for (const m of event.markets) {
      const d = parseGammaDate(m.gameStartTime);
      if (!d) continue;
      if (!earliest || d.getTime() < earliest.getTime()) earliest = d;
    }
    if (earliest) return earliest;
  }

  return parseGammaDate(event.startDate);
}

export function formatStartTime(
  date: Date,
  { includeDay = true }: { includeDay?: boolean } = {}
): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (!includeDay) return timeStr;
  if (diffHours < 0) return timeStr;
  if (diffHours < 24) {
    const isToday = date.toDateString() === now.toDateString();
    return isToday ? `Today ${timeStr}` : `Tomorrow ${timeStr}`;
  }
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${dateStr} ${timeStr}`;
}

export function getLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDateHeading(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatRelativeTime(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  if (diffMs < 0) return "Starting soon";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}
