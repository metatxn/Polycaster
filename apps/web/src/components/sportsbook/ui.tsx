"use client";

import Image from "next/image";
import { useState } from "react";
import { formatPrice } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { countryFlagSrc } from "./country-flags";
import { teamAbbr } from "./market-parsing";

// ── Team color palette ────────────────────────────────────────────

const TEAM_COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-violet-600",
  "bg-cyan-600",
  "bg-orange-600",
  "bg-teal-600",
  "bg-pink-600",
  "bg-indigo-600",
  "bg-lime-600",
  "bg-fuchsia-600",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function TeamAvatar({
  name,
  imageSrc,
  size = "md",
}: {
  name: string;
  imageSrc?: string;
  size?: "sm" | "md";
}) {
  const [failed, setFailed] = useState(false);
  const initials = teamAbbr(name);
  const colorClass = TEAM_COLORS[hashString(name) % TEAM_COLORS.length];
  const dim = size === "sm" ? 24 : 28;
  const sizeClasses =
    size === "sm" ? "w-6 h-6 text-[9px]" : "w-7 h-7 text-[10px]";

  // Prefer an explicit image; otherwise fall back to a bundled national-team
  // flag derived from the name. Non-countries (clubs, fighters) resolve to
  // null and render the colored-initials badge. A load error (missing flag
  // or broken image) also degrades to initials, so there's no broken state.
  const resolvedSrc = imageSrc ?? countryFlagSrc(name);

  if (resolvedSrc && !failed) {
    return (
      <Image
        src={resolvedSrc}
        alt={name}
        width={dim}
        height={dim}
        className={cn(
          "rounded-full object-cover shrink-0 bg-(--kwm-bg-3)",
          sizeClasses
        )}
        title={name}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full text-white font-bold shrink-0",
        colorClass,
        sizeClasses
      )}
      title={name}
    >
      {initials}
    </span>
  );
}

// ── Price cell primitives ──────────────────────────────────────────
// Shared shell for the price / spread / total / draw cells so they stay
// visually consistent and pick up the same hover, press, and keyboard-focus
// affordances. `fill` switches between a content-hugging inline pill (mobile,
// beside the team name) and a full-width tabular cell (desktop grid columns),
// where right-aligned prices line up for fast column scanning.

const CELL_SHELL =
  "h-10 px-3 rounded-md border whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--kwm-ink) active:bg-(--kwm-bg-3)";

const cellLayout = (fill?: boolean) =>
  fill
    ? "flex w-full items-center justify-center gap-2"
    : "inline-flex items-center gap-2";

/** Editorial price cell — hairline border, mono ticker, tabular-nums price.
 *  Favored side gets emerald text; underdog stays neutral. No color fills. */
export function PriceButton({
  abbr,
  price,
  isFavored,
  selected = false,
  fill = false,
  className,
  onClick,
}: {
  abbr: string;
  price: number;
  isFavored: boolean;
  selected?: boolean;
  fill?: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        CELL_SHELL,
        cellLayout(fill),
        selected
          ? "border-(--kwm-ink) bg-(--kwm-bg-3)"
          : isFavored
            ? "border-(--kwm-hl-2) bg-(--kwm-up-soft) hover:border-(--kwm-up-border)"
            : "border-(--kwm-hl) bg-(--kwm-bg-2) hover:border-(--kwm-hl-3) hover:bg-(--kwm-bg-3)",
        className
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        {abbr}
      </span>
      <span
        className={cn(
          "font-mono text-sm tabular-nums text-(--kwm-ink)",
          isFavored ? "font-semibold" : "font-medium"
        )}
      >
        {formatPrice(price)}
      </span>
    </button>
  );
}

export function SpreadCell({
  abbr,
  handicap,
  price,
  selected = false,
  fill = false,
  onClick,
}: {
  abbr: string;
  handicap: string;
  price: number;
  selected?: boolean;
  fill?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        CELL_SHELL,
        cellLayout(fill),
        selected
          ? "border-(--kwm-ink) bg-(--kwm-bg-3)"
          : "border-(--kwm-hl) bg-(--kwm-bg-2) hover:border-(--kwm-hl-3) hover:bg-(--kwm-bg-3)"
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        {abbr} {handicap}
      </span>
      <span className="font-mono text-sm font-medium tabular-nums text-(--kwm-ink)">
        {formatPrice(price)}
      </span>
    </button>
  );
}

export function TotalCell({
  label,
  line,
  price,
  selected = false,
  fill = false,
  onClick,
}: {
  label: string;
  line: string;
  price: number;
  selected?: boolean;
  fill?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        CELL_SHELL,
        cellLayout(fill),
        selected
          ? "border-(--kwm-ink) bg-(--kwm-bg-3)"
          : "border-(--kwm-hl) bg-(--kwm-bg-2) hover:border-(--kwm-hl-3) hover:bg-(--kwm-bg-3)"
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        {label} {line}
      </span>
      <span className="font-mono text-sm font-medium tabular-nums text-(--kwm-ink)">
        {formatPrice(price)}
      </span>
    </button>
  );
}

export function DrawButton({
  price,
  selected = false,
  fill = false,
  className,
  onClick,
}: {
  price: number;
  selected?: boolean;
  fill?: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        CELL_SHELL,
        cellLayout(fill),
        selected
          ? "border-(--kwm-ink) bg-(--kwm-bg-3)"
          : "border-(--kwm-hl) bg-(--kwm-bg-2) hover:border-(--kwm-hl-3) hover:bg-(--kwm-bg-3)",
        className
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-warn)">
        Draw
      </span>
      <span className="font-mono text-sm font-medium tabular-nums text-(--kwm-ink)">
        {formatPrice(price)}
      </span>
    </button>
  );
}
