"use client";

import { Timer, Trophy } from "lucide-react";
import type { LiveGameState } from "@/hooks/use-sports-websocket";
import { cn } from "@/lib/utils";

interface LiveGameBadgeProps {
  game: LiveGameState;
  compact?: boolean;
  className?: string;
}

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    Scheduled: "Scheduled",
    scheduled: "Scheduled",
    InProgress: "In Progress",
    inprogress: "In Progress",
    running: "In Progress",
    Final: "Final",
    finished: "Final",
    "F/OT": "Final (OT)",
    "F/SO": "Final (SO)",
    Break: "Halftime",
    Suspended: "Suspended",
    suspended: "Suspended",
    Postponed: "Postponed",
    postponed: "Postponed",
    Delayed: "Delayed",
    Canceled: "Canceled",
    cancelled: "Canceled",
    PenaltyShootout: "Penalties",
    Awarded: "Awarded",
    Forfeit: "Forfeit",
    NotNecessary: "Not Needed",
    not_started: "Starting Soon",
  };
  return map[status] || status;
}

function isGameLive(status: string): boolean {
  return [
    "InProgress",
    "inprogress",
    "running",
    "Break",
    "PenaltyShootout",
  ].includes(status);
}

function isGameSuspended(status: string): boolean {
  return [
    "Suspended",
    "suspended",
    "Postponed",
    "postponed",
    "Delayed",
  ].includes(status);
}

function isGameFinished(status: string): boolean {
  return [
    "Final",
    "finished",
    "F/OT",
    "F/SO",
    "Awarded",
    "Forfeit",
    "cancelled",
    "Canceled",
    "NotNecessary",
  ].includes(status);
}

function formatElapsed(game: LiveGameState): string | null {
  if (game.elapsed) return game.elapsed;
  if (game.period && game.period !== "FT") return game.period;
  return null;
}

export function LiveGameBadge({
  game,
  compact = false,
  className,
}: LiveGameBadgeProps) {
  const live = isGameLive(game.status);
  const finished = isGameFinished(game.status);
  const elapsed = formatElapsed(game);

  if (compact) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide border",
          live &&
            "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
          finished &&
            "bg-zinc-500/10 border-zinc-500/20 text-zinc-500 dark:text-zinc-400",
          !live &&
            !finished &&
            "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
          className
        )}
      >
        {live && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
        )}
        {finished && <Trophy className="h-2.5 w-2.5" />}
        {formatStatus(game.status)}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-xl border backdrop-blur-sm",
        live &&
          "bg-emerald-500/10 border-emerald-500/25 shadow-sm shadow-emerald-500/10",
        finished && "bg-zinc-500/5 border-zinc-500/15",
        !live && !finished && "bg-amber-500/5 border-amber-500/15",
        className
      )}
    >
      {/* Status indicator */}
      <div className="flex items-center gap-1.5 shrink-0">
        {live && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        )}
        {finished && <Trophy className="h-3.5 w-3.5 text-zinc-500" />}
        {!live && !finished && <Timer className="h-3.5 w-3.5 text-amber-500" />}
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-wider",
            live && "text-emerald-600 dark:text-emerald-400",
            finished && "text-zinc-500",
            !live && !finished && "text-amber-600 dark:text-amber-400"
          )}
        >
          {formatStatus(game.status)}
        </span>
      </div>

      {/* Score */}
      {game.score && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono font-black tracking-tight text-foreground">
            {game.homeTeam}
          </span>
          <span className="text-sm font-mono font-black text-foreground">
            {game.score}
          </span>
          <span className="text-xs font-mono font-black tracking-tight text-foreground">
            {game.awayTeam}
          </span>
        </div>
      )}

      {/* Period / Elapsed */}
      {live && elapsed && (
        <span className="text-[10px] font-semibold text-muted-foreground ml-auto tabular-nums">
          {elapsed}
        </span>
      )}
    </div>
  );
}

export function LiveGameScoreStrip({
  game,
  className,
}: {
  game: LiveGameState;
  className?: string;
}) {
  const live = isGameLive(game.status);

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs",
        live
          ? "bg-emerald-500/10 border border-emerald-500/20"
          : "bg-muted/30 border border-border/30",
        className
      )}
    >
      {live && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
        </span>
      )}
      <span className="font-bold text-foreground truncate">
        {game.homeTeam}
      </span>
      <span className="font-mono font-black text-foreground">{game.score}</span>
      <span className="font-bold text-foreground truncate">
        {game.awayTeam}
      </span>
      {game.period && (
        <span className="text-muted-foreground font-medium ml-auto shrink-0 tabular-nums">
          {game.period}
        </span>
      )}
    </div>
  );
}

export { formatStatus, isGameFinished, isGameLive, isGameSuspended };
