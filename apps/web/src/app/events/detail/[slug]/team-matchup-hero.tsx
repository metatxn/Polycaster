"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { EventTeam } from "@/hooks/use-event-detail";
import { useNow } from "@/hooks/use-now";

/**
 * Polymarket only ships team metadata (`event.teams`) for team-vs-team sports
 * events. Anything else (politics, crypto, weather, etc.) leaves it
 * empty/undefined, so this is the cleanest discriminator for switching to the
 * matchup hero.
 */
export function isTeamMatchupEvent(
  teams?: EventTeam[]
): teams is [EventTeam, EventTeam] {
  return Array.isArray(teams) && teams.length === 2;
}

function teamLogosCollide(teams: [EventTeam, EventTeam]): boolean {
  const [a, b] = teams;
  if (!a.logo || !b.logo) return true;
  return a.logo.trim() === b.logo.trim();
}

function TeamCrest({ team, fallback }: { team: EventTeam; fallback: boolean }) {
  const tint = team.color || "var(--muted-foreground)";
  if (!fallback && team.logo) {
    return (
      <div className="relative h-10 w-10 sm:h-12 sm:w-12 rounded-full overflow-hidden border border-border/60 bg-background shrink-0">
        <Image
          src={team.logo}
          alt={team.name}
          fill
          sizes="48px"
          className="object-contain"
        />
      </div>
    );
  }
  // Tinted-ball fallback: when both teams share a logo, or one is missing,
  // draw a colored circle stamped with the abbreviation. The two crests stay
  // visually distinct via `team.color`, which is what Polymarket uses for
  // their team accent strip.
  const label = (team.abbreviation || team.name.slice(0, 3)).toUpperCase();
  return (
    <div
      className="relative h-10 w-10 sm:h-12 sm:w-12 rounded-full border border-border/60 shrink-0 flex items-center justify-center"
      style={{ backgroundColor: tint, color: "white" }}
    >
      <span className="font-mono text-[10px] sm:text-xs font-semibold tracking-wider">
        {label}
      </span>
    </div>
  );
}

interface KickoffParts {
  /** Absolute date label (e.g. "Apr 30"). */
  day: string;
  /** Absolute time label (e.g. "7:30 PM"). */
  time: string;
}

function formatKickoff(iso: string): KickoffParts | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    day: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

/**
 * Live countdown to kickoff.
 *
 * - <1h:   "STARTS IN 42M 13S"
 * - <24h:  "STARTS IN 13H 20M"
 * - <7d:   "STARTS IN 3D 12H"
 * - >=7d:  null  (caller falls back to a plain date label so we don't show
 *                 noisy month-long countdowns)
 * - past:  "LIVE"
 *
 * Returns `null` instead of empty strings so the parent can pick its own
 * fallback element (date stamp, etc.) without ternary noise here.
 */
function buildCountdownLabel(diffMs: number): string | null {
  if (diffMs <= 0) return "LIVE";
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 7) return null;
  if (days >= 1) {
    const remainingHours = hours - days * 24;
    return `STARTS IN ${days}D ${remainingHours}H`;
  }
  if (hours >= 1) {
    const remainingMinutes = minutes - hours * 60;
    return `STARTS IN ${hours}H ${remainingMinutes}M`;
  }
  const remainingSeconds = seconds - minutes * 60;
  return `STARTS IN ${minutes}M ${remainingSeconds}S`;
}

const COUNTDOWN_CLASS_BASE =
  "font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.14em] tabular-nums";
const COUNTDOWN_CLASS_IDLE = `${COUNTDOWN_CLASS_BASE} text-muted-foreground/90 font-semibold`;

function MatchCountdown({ kickoffAt }: { kickoffAt: string }) {
  // Tick every second when <1h away (so the seconds digit moves), every
  // minute otherwise (so we don't burn cycles for a label that only
  // changes every 60s). Like the setInterval block this replaces, the
  // cadence is picked once per kickoffAt.
  const tickMs = useMemo(() => {
    const diff = new Date(kickoffAt).getTime() - Date.now();
    return diff < 60 * 60 * 1000 ? 1_000 : 60 * 1000;
  }, [kickoffAt]);
  const now = useNow(tickMs);

  // Mount gate: the label can structurally flip between LIVE (has a dot
  // child span) and a countdown string (no dot). suppressHydrationWarning
  // cannot cover structural changes, so we render a blank placeholder that
  // matches the non-live shape until after hydration, then reveal the real
  // label. This is a LEAF-level guard — only the text node changes post-mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const target = new Date(kickoffAt).getTime();
  if (!Number.isFinite(target)) return null;

  if (!mounted) {
    // Render the non-live shape (no dot span) with empty text so the DOM
    // structure is stable across server/client on first paint. This must come
    // before any clock-derived branching (label nullness depends on `now`,
    // which can differ between server and client).
    return <span className={COUNTDOWN_CLASS_IDLE} />;
  }

  const label = buildCountdownLabel(target - now);
  if (!label) return null;

  const isLive = label === "LIVE";

  return (
    <span
      className={
        isLive
          ? `${COUNTDOWN_CLASS_BASE} text-red-500 font-semibold`
          : COUNTDOWN_CLASS_IDLE
      }
    >
      {isLive && (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 mr-1.5 animate-pulse"
          aria-hidden
        />
      )}
      {label}
    </span>
  );
}

export interface TeamMatchupHeroProps {
  teams: [EventTeam, EventTeam];
  kickoffAt?: string;
  score?: string;
  period?: string;
  elapsed?: string | number;
}

function parseScore(raw: string | undefined): [string, string] | null {
  if (!raw) return null;
  const scorePart = raw.includes("|") ? raw.split("|")[1] : raw;
  const [home, away] = (scorePart ?? "").split("-").map((part) => part.trim());
  if (!home || !away) return null;
  return [home, away];
}

/**
 * Compact team-vs-team header for live sports events. Rendered inside the
 * chart column (not the page-wide HeaderSection) so the sticky trading panel
 * isn't pushed down by a full-width hero.
 */
export function TeamMatchupHero({
  teams,
  kickoffAt,
  score,
  period,
  elapsed,
}: TeamMatchupHeroProps) {
  const collide = teamLogosCollide(teams);
  const kickoff = kickoffAt ? formatKickoff(kickoffAt) : null;
  const scoreParts = parseScore(score);
  const liveMeta = [period, elapsed ? `${elapsed}'` : null].filter(Boolean);
  return (
    <div className="flex items-center justify-between gap-3 sm:gap-4 rounded-md border border-border/40 bg-card/40 px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="flex flex-1 items-center gap-2.5 min-w-0">
        <TeamCrest team={teams[0]} fallback={collide} />
        <span className="font-editorial italic text-sm sm:text-base leading-tight truncate">
          {teams[0].name.trim()}
        </span>
      </div>

      <div className="flex flex-col items-center gap-0.5 shrink-0 px-2 min-w-[88px]">
        {scoreParts ? (
          <>
            <span className="font-mono text-xl sm:text-2xl font-semibold tabular-nums leading-none text-foreground">
              {scoreParts[0]} - {scoreParts[1]}
            </span>
            <span className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-red-500 font-semibold">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 mr-1.5 animate-pulse"
                aria-hidden
              />
              {liveMeta.length > 0 ? liveMeta.join(" · ") : "LIVE"}
            </span>
          </>
        ) : kickoff ? (
          <>
            {/* suppressHydrationWarning: toLocale* formats in the SERVER's
                locale/timezone (Workers = UTC) but must be viewer-local, so
                this text legitimately differs on hydration. Text-only — do
                not copy this onto elements whose STRUCTURE can differ. */}
            <span
              suppressHydrationWarning
              className="font-mono text-xs sm:text-sm tabular-nums font-semibold text-foreground"
            >
              {kickoff.time}
            </span>
            {kickoffAt ? (
              <MatchCountdown kickoffAt={kickoffAt} />
            ) : (
              <span
                suppressHydrationWarning
                className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-muted-foreground"
              >
                {kickoff.day}
              </span>
            )}
          </>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            vs
          </span>
        )}
      </div>

      <div className="flex flex-1 items-center gap-2.5 min-w-0 justify-end">
        <span className="font-editorial italic text-sm sm:text-base leading-tight truncate text-right">
          {teams[1].name.trim()}
        </span>
        <TeamCrest team={teams[1]} fallback={collide} />
      </div>
    </div>
  );
}
