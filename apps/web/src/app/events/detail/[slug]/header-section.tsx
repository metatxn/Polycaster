"use client";

import { Check, Link2, Mail, Share2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import { NegRiskBadge } from "@/components/neg-risk-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Build a share-intent URL for each target. Every platform-specific
 * sharer takes a different param shape; consolidating here keeps the
 * dropdown JSX clean and the URL grammar in one place.
 */
function buildShareUrl(
  target:
    | "x"
    | "facebook"
    | "linkedin"
    | "whatsapp"
    | "telegram"
    | "reddit"
    | "email",
  url: string,
  title: string
): string {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const tu = encodeURIComponent(`${title} ${url}`);
  switch (target) {
    case "x":
      return `https://twitter.com/intent/tweet?url=${u}&text=${t}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case "whatsapp":
      return `https://wa.me/?text=${tu}`;
    case "telegram":
      return `https://t.me/share/url?url=${u}&text=${t}`;
    case "reddit":
      return `https://www.reddit.com/submit?url=${u}&title=${t}`;
    case "email":
      return `mailto:?subject=${t}&body=${tu}`;
  }
}

/**
 * Brand glyphs as inline SVG paths. Lucide dropped most brand icons in
 * v0.43+, so we ship the official wordmark paths inline. Each renders
 * at 14×14 to match Lucide's `h-3.5 w-3.5` sizing used elsewhere in the
 * dropdown. The `<title>` element provides the accessible label so the
 * dropdown item still reads correctly under a screen reader even if the
 * adjacent text node is somehow stripped.
 */
const BRAND_LABELS: Record<BrandName, string> = {
  x: "X",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  reddit: "Reddit",
};

type BrandName =
  | "x"
  | "facebook"
  | "linkedin"
  | "whatsapp"
  | "telegram"
  | "reddit";

function BrandIcon({ name }: { name: BrandName }) {
  const label = BRAND_LABELS[name];
  const common = {
    className: "h-3.5 w-3.5",
    viewBox: "0 0 24 24",
    fill: "currentColor",
    role: "img" as const,
  };
  switch (name) {
    case "x":
      return (
        <svg {...common}>
          <title>{label}</title>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common}>
          <title>{label}</title>
          <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common}>
          <title>{label}</title>
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg {...common}>
          <title>{label}</title>
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
        </svg>
      );
    case "telegram":
      return (
        <svg {...common}>
          <title>{label}</title>
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      );
    case "reddit":
      return (
        <svg {...common}>
          <title>{label}</title>
          <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.605a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
        </svg>
      );
  }
}

interface HeaderSectionProps {
  event: {
    title: string;
    image?: string;
    volume?: number | string;
    endDate?: string;
    negRisk?: boolean;
    /** Polymarket `live` flag — true when the event is currently in
     *  progress (sports games on-broadcast). Drives the LIVE pulse. */
    live?: boolean;
  };
  /**
   * Kickoff timestamp for sports events. Used in place of `endDate` in the
   * stats date pill so the header reads as "Apr 30" (kickoff) instead of the
   * resolution deadline (which on Polymarket sits ~7 days after the game).
   */
  kickoffAt?: string;
  isScrolled: boolean;
  formatVolume: (vol?: number | string) => string;
  totalMarketsCount: number;
  openMarkets: unknown[];
  closedMarkets: unknown[];
}

/**
 * Compute "X days left" / "X hours left" / "Settled" from an ISO end date.
 * Returns null when the input is missing or unparseable — caller skips
 * rendering rather than showing a placeholder. Past-due events return
 * `"Settled"` so the stats row reads coherently after resolution.
 */
function formatDaysLeft(endDateIso?: string): string | null {
  if (!endDateIso) return null;
  const end = new Date(endDateIso).getTime();
  if (!Number.isFinite(end)) return null;
  const diffMs = end - Date.now();
  if (diffMs <= 0) return "Settled";
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 24) {
    const h = Math.max(1, Math.floor(diffHours));
    return `${h}h left`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "1 day left";
  if (diffDays < 60) return `${diffDays} days left`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths} months left`;
}

/**
 * Compact LIVE pulse — green dot + "LIVE" mono caps. Renders inline in
 * the stats row when the event is currently in progress. Theme-safe via
 * the `kwm-pulse` class defined in globals.css under `.kw-app`.
 */
function LivePulse() {
  return (
    <span
      className="inline-flex items-center gap-1.5 shrink-0 font-(family-name:--font-geist-mono) text-[10px] sm:text-[11px] uppercase tracking-[0.16em] font-semibold text-(--kwm-up)"
      title="Event is currently live"
    >
      <span className="kwm-pulse" aria-hidden="true" />
      Live
    </span>
  );
}

/**
 * Mono-caps stat — single uniform style matching the design package's
 * stat strip. No leading icon (design keeps these text-only); optional
 * trailing label in `--kwm-ink-3`. Middle-dot separator between adjacent
 * items is supplied by the `.kwm-stat-row` rule in globals.css.
 */
function StatItem({ value, label }: { value: string; label?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 shrink-0 font-(family-name:--font-geist-mono) text-[10px] sm:text-[11px] uppercase tracking-[0.16em] tabular-nums text-(--kwm-ink)">
      {value}
      {label && <span className="text-(--kwm-ink-3)">{label}</span>}
    </span>
  );
}

/**
 * Share dropdown — replaces the native `navigator.share` sheet with an
 * in-app menu so the share targets are explicit (and reachable on
 * desktop, where the native API silently no-ops). Each item opens the
 * platform's share-intent endpoint in a new tab; Copy link writes the
 * URL to the clipboard and surfaces a toast confirmation.
 */
function ShareMenu({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const targets: Array<{
    key: BrandName | "email";
    label: string;
    icon: React.ReactNode;
    href: string;
  }> = (() => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    return [
      {
        key: "x",
        label: "X",
        icon: <BrandIcon name="x" />,
        href: buildShareUrl("x", url, title),
      },
      {
        key: "facebook",
        label: "Facebook",
        icon: <BrandIcon name="facebook" />,
        href: buildShareUrl("facebook", url, title),
      },
      {
        key: "linkedin",
        label: "LinkedIn",
        icon: <BrandIcon name="linkedin" />,
        href: buildShareUrl("linkedin", url, title),
      },
      {
        key: "whatsapp",
        label: "WhatsApp",
        icon: <BrandIcon name="whatsapp" />,
        href: buildShareUrl("whatsapp", url, title),
      },
      {
        key: "telegram",
        label: "Telegram",
        icon: <BrandIcon name="telegram" />,
        href: buildShareUrl("telegram", url, title),
      },
      {
        key: "reddit",
        label: "Reddit",
        icon: <BrandIcon name="reddit" />,
        href: buildShareUrl("reddit", url, title),
      },
      {
        key: "email",
        label: "Email",
        icon: <Mail className="h-3.5 w-3.5" />,
        href: buildShareUrl("email", url, title),
      },
    ];
  })();

  const handleCopy = async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy link");
    }
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Share"
          className="inline-flex items-center justify-center rounded-md h-8 w-8 lg:w-auto lg:px-2.5 lg:gap-1.5 font-(family-name:--font-geist-mono) text-[10px] tracking-[0.16em] uppercase text-(--kwm-ink-3) border border-(--kwm-hl) hover:bg-(--kwm-bg-3) hover:text-(--kwm-ink) transition-colors cursor-pointer"
        >
          <Share2 className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Share</span>
        </button>
      </DropdownMenuTrigger>
      {/* Dropdown content is portaled to document.body — OUTSIDE the
          `.kw-app` scope where the --kwm-* tokens live. Use shadcn's
          :root-defined tokens (bg-popover, border-border, focus:bg-accent)
          so the menu renders opaque under every theme. Typography keeps
          the mono-caps treatment because `--font-geist-mono` is injected
          at :root by next/font in layout.tsx. */}
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="min-w-[180px] p-1"
      >
        <DropdownMenuItem
          onClick={handleCopy}
          className="gap-2 font-(family-name:--font-geist-mono) text-[11px] uppercase tracking-[0.12em] cursor-pointer"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Link2 className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy link"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {targets.map((t) => (
          <DropdownMenuItem
            key={t.key}
            asChild
            className="gap-2 font-(family-name:--font-geist-mono) text-[11px] uppercase tracking-[0.12em] cursor-pointer"
          >
            <a
              href={t.href}
              target={t.key === "email" ? undefined : "_blank"}
              rel="noopener noreferrer"
            >
              {t.icon}
              {t.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function HeaderSection({
  event,
  kickoffAt,
  isScrolled,
  formatVolume,
  totalMarketsCount,
  openMarkets,
  closedMarkets,
}: HeaderSectionProps) {
  // Sports events: prefer kickoff date over the resolution `endDate`.
  // Non-sports events (no `kickoffAt`) keep showing their resolution
  // deadline.
  const displayDate = kickoffAt ?? event.endDate;
  // "X days left" derived from the same source as the date pill. Suppressed
  // when the event has already settled (the date pill carries the closure
  // signal in that case) so we don't render `Settled · Settled`.
  const daysLeftLabel = formatDaysLeft(displayDate);
  const showDaysLeft = daysLeftLabel !== null && daysLeftLabel !== "Settled";
  // LIVE pulse — only when Polymarket marks the event as currently in
  // progress (game on-broadcast for sports). Most non-sports events keep
  // this false.
  const isEventLive = event.live === true;

  return (
    <div
      className={cn(
        "lg:sticky lg:top-0 z-30 -mx-4 px-4 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 transition-all duration-300",
        isScrolled
          ? "lg:bg-(--kwm-panel)/80 lg:backdrop-blur-md lg:border-b lg:border-(--kwm-hl) lg:py-2 lg:mb-2 py-2 mb-3"
          : "bg-transparent py-2 mb-3"
      )}
    >
      <div className="flex items-start gap-3 md:gap-4">
        {event.image && (
          <div
            className={cn(
              "relative shrink-0 aspect-square overflow-hidden rounded-sm border border-(--kwm-hl-2) transition-all duration-300",
              isScrolled ? "lg:w-10 w-12 sm:w-14" : "w-12 sm:w-14 md:w-16"
            )}
          >
            <Image
              src={event.image}
              alt={event.title}
              fill
              sizes="(max-width: 640px) 56px, (max-width: 768px) 64px, 72px"
              className="object-cover"
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h1
              className={cn(
                "font-medium leading-[1.15] tracking-tight transition-all duration-300 flex-1 min-w-0 text-(--kwm-ink)",
                isScrolled
                  ? "lg:text-[22px] text-xl sm:text-2xl md:text-[26px]"
                  : "text-xl sm:text-2xl md:text-[26px] lg:text-[28px]"
              )}
            >
              {event.title}
            </h1>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Neg Risk icon on mobile only — text variant lives in the stats row below. */}
              {event.negRisk && <NegRiskBadge iconOnly className="md:hidden" />}
              <ShareMenu title={event.title} />
            </div>
          </div>

          {/* Single consolidated stats row — replaces the previous three
              breakpoint-specific copies. Middle-dot separators between items
              are supplied by the `.kwm-stat-row` rule in globals.css. */}
          <div className="kwm-stat-row flex flex-wrap items-center gap-1.5 mt-1 overflow-x-auto no-scrollbar">
            <StatItem value={formatVolume(event.volume)} label="Vol" />
            {displayDate && (
              <StatItem
                value={new Date(displayDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              />
            )}
            <StatItem
              value={`${totalMarketsCount} mkt${totalMarketsCount !== 1 ? "s" : ""}`}
            />
            {showDaysLeft && <StatItem value={daysLeftLabel} />}
            {closedMarkets.length > 0 && (
              <StatItem
                value={`${openMarkets.length} open · ${closedMarkets.length} closed`}
              />
            )}
            {event.negRisk && <NegRiskBadge />}
            {isEventLive && <LivePulse />}
          </div>
        </div>
      </div>
    </div>
  );
}
