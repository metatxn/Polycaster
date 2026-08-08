"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Radio } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useSportsWebSocket } from "@/hooks/use-sports-websocket";
import {
  applyEndedCorrections,
  buildEndedCorrections,
  getCountTagSlugs,
} from "@/lib/league-rail-counts";
import { qk } from "@/lib/query-keys";
import { SPORT_GROUPS, type SportGroup } from "@/lib/sport-categories";
import { cn } from "@/lib/utils";

interface LeagueCounts {
  sports: number | null;
  live: number | null;
  byTagSlug: Record<string, number>;
  meta?: {
    generatedAt: string;
    lastSuccessAt: string | null;
    ageSeconds: number | null;
    staleKeys: string[];
  };
}

interface LeagueRailProps {
  /** Active /events/sports/{slug} — used to highlight + auto-expand parent. */
  activeSlug?: string;
  /** Additional parent sport groups to open by default. */
  defaultOpenGroupSlugs?: string[];
  /** Mobile drawer integration: external close handler when a link is tapped. */
  onNavigate?: () => void;
  /** Wrapper class so the rail can pin under sticky headers when desired. */
  className?: string;
  /** Disable count fetching for routes where the rail is navigation-only. */
  countsEnabled?: boolean;
}

function getActiveGroupSlug(activeSlug?: string): string | null {
  if (!activeSlug) return null;
  for (const group of SPORT_GROUPS) {
    if (group.slug === activeSlug) return group.slug;
    if (group.leagues.some((league) => league.slug === activeSlug)) {
      return group.slug;
    }
  }
  return null;
}

function useLeagueCounts(tagSlugs: string[], enabled = true) {
  return useQuery<LeagueCounts>({
    queryKey: qk.sports.leagueCounts(tagSlugs.join(",")),
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const slug of tagSlugs) params.append("slug", slug);
      const res = await fetch(`/api/events/league-counts?${params}`);
      if (!res.ok) throw new Error("Failed to load league counts");
      return res.json();
    },
    // The server snapshot refreshes when older than ~30s; polling at 15s
    // (matching the 15s edge cache) keeps the displayed value within one
    // edge TTL of the served snapshot. Displayed staleness is snapshot age
    // + edge cache + poll gap — typically 30–45s; see the issue doc's
    // freshness criterion for the full envelope.
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
    // Opening/closing a group changes the slug set (new query key). Keep the
    // previous counts on screen while the new set loads instead of dropping
    // every badge for a frame.
    placeholderData: (previousData: LeagueCounts | undefined) => previousData,
    enabled: enabled && tagSlugs.length > 0,
  });
}

function CountBadge({
  count,
  isLive = false,
}: {
  count: number | undefined;
  isLive?: boolean;
}) {
  if (!count) return null;
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-[12px] tabular-nums leading-none",
        isLive ? "text-(--kwm-up)" : "text-(--kwm-ink-3)"
      )}
    >
      {count}
    </span>
  );
}

interface RailGroupProps {
  group: SportGroup;
  activeSlug?: string;
  countsByTag: Record<string, number> | undefined;
  onNavigate?: () => void;
  onOpenChange?: (open: boolean) => void;
  defaultOpen: boolean;
}

function RailGroup({
  group,
  activeSlug,
  countsByTag,
  onNavigate,
  onOpenChange,
  defaultOpen,
}: RailGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Sync open state when active slug changes (e.g. user navigates to a
  // league inside a different group). Without this, switching groups via
  // direct URL leaves the previously-open group expanded and the new
  // active group collapsed.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const groupActive = activeSlug === group.slug;

  // A count can be a number (known), 0 (known empty), or undefined (not
  // requested for this group state, or the server flagged it unavailable).
  // Only a KNOWN zero hides anything — unknown must never look empty.
  const childCounts = group.leagues.map(
    (league) => countsByTag?.[league.tagSlug]
  );
  const knownChildCounts = childCounts.filter(
    (count): count is number => count !== undefined
  );
  const broadCount = countsByTag?.[group.tagSlug];
  const groupCount =
    knownChildCounts.length > 0
      ? knownChildCounts.reduce((total, count) => total + count, 0)
      : broadCount;

  // Single-league sports (Golf, F1, Boxing, …): render as a leaf, no
  // collapsible affordance. Polymarket does the same.
  if (group.leagues.length === 0) {
    if (broadCount === 0) return null;

    return (
      <Link
        href={`/events/sports/${group.slug}`}
        onClick={onNavigate}
        aria-current={groupActive ? "page" : undefined}
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-2 text-[14px] transition-colors",
          groupActive
            ? "text-(--kwm-ink) bg-(--kwm-bg-3) font-medium"
            : "text-(--kwm-ink-3) hover:text-(--kwm-ink) hover:bg-(--kwm-bg-2)"
        )}
      >
        <span className="truncate">{group.label}</span>
        <CountBadge count={groupCount} />
      </Link>
    );
  }

  const allChildrenKnownZero = childCounts.every((count) => count === 0);
  const closedGroupKnownEmpty =
    knownChildCounts.length === 0 && broadCount === 0;
  if (allChildrenKnownZero || closedGroupKnownEmpty) return null;

  const visibleLeagues = group.leagues.filter(
    (league) => countsByTag?.[league.tagSlug] !== 0
  );

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-full flex items-center justify-between gap-2 px-3 py-2 text-[14px] transition-colors",
            groupActive
              ? "text-(--kwm-ink) bg-(--kwm-bg-3) font-medium"
              : "text-(--kwm-ink-3) hover:text-(--kwm-ink) hover:bg-(--kwm-bg-2)"
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform",
                open ? "rotate-0" : "-rotate-90"
              )}
            />
            <span className="truncate">{group.label}</span>
          </span>
          <CountBadge count={groupCount} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="pb-1">
          {visibleLeagues.map((league) => {
            const isActive = activeSlug === league.slug;
            const count = countsByTag?.[league.tagSlug];
            return (
              <Link
                key={league.slug}
                href={`/events/sports/${league.slug}`}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between gap-2 pl-9 pr-3 py-1.5 text-[13px] transition-colors",
                  isActive
                    ? "text-(--kwm-ink) bg-(--kwm-bg-3) font-medium"
                    : "text-(--kwm-ink-3) hover:text-(--kwm-ink) hover:bg-(--kwm-bg-2)"
                )}
              >
                <span className="truncate">{league.label}</span>
                <CountBadge count={count} />
              </Link>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Left-rail navigation listing the sport taxonomy:
 * - Live (special pseudo-leaf, links to /events/sports/live)
 * - 18 top-level groups, each expandable to its child leagues
 *
 * Scheduled counts come from a single batched /api/events/league-counts
 * call (served from the server-side snapshot) polled every 15s. The Live
 * badge is driven by the shared Sports WebSocket (`live && !ended`,
 * deduplicated by gameId); the Gamma live total is only the bootstrap
 * value until the socket has delivered data, and the fallback during
 * reconnects. WebSocket `ended` transitions are also subtracted from
 * scheduled league counts, since Gamma keeps counting an ended event
 * until its market closes.
 */
export function LeagueRail({
  activeSlug,
  defaultOpenGroupSlugs = [],
  onNavigate,
  className,
  countsEnabled = true,
}: LeagueRailProps) {
  const pathname = usePathname();

  // Derive which group should auto-open: the one containing the active slug.
  const activeGroupSlug = useMemo(
    () => getActiveGroupSlug(activeSlug),
    [activeSlug]
  );
  const initialOpenGroupSlugs = useMemo(() => {
    const slugs = new Set(defaultOpenGroupSlugs);
    if (activeGroupSlug) slugs.add(activeGroupSlug);
    return Array.from(slugs).sort();
  }, [activeGroupSlug, defaultOpenGroupSlugs]);
  const [openGroupSlugs, setOpenGroupSlugs] = useState<Set<string>>(
    () => new Set(initialOpenGroupSlugs)
  );
  // Keyed on the joined string, not the array: callers pass fresh array
  // literals every render, and re-running on identity change would re-add
  // a group the user explicitly closed.
  const initialOpenGroupKey = initialOpenGroupSlugs.join(",");
  useEffect(() => {
    const slugsToOpen = initialOpenGroupKey
      ? initialOpenGroupKey.split(",")
      : [];
    setOpenGroupSlugs((previousSlugs) => {
      let changed = false;
      const nextSlugs = new Set(previousSlugs);
      for (const slug of slugsToOpen) {
        if (!nextSlugs.has(slug)) {
          nextSlugs.add(slug);
          changed = true;
        }
      }
      return changed ? nextSlugs : previousSlugs;
    });
  }, [initialOpenGroupKey]);
  const countTagSlugs = useMemo(
    () => getCountTagSlugs(openGroupSlugs),
    [openGroupSlugs]
  );
  const { data } = useLeagueCounts(countTagSlugs, countsEnabled);

  const { isSettled, liveGames, finishedGames } = useSportsWebSocket({
    enabled: countsEnabled,
  });
  // The socket streams each active game as an individual message with no
  // completeness marker, so WS-derived counts are only authoritative once
  // the connection epoch's initial burst has settled — on first connect AND
  // on reconnects. Until then the snapshot's Gamma values stand.
  const wsReady = isSettled;
  const liveCount = wsReady ? liveGames.length : (data?.live ?? undefined);

  const countsByTag = useMemo(() => {
    if (!data?.byTagSlug) return undefined;
    if (!wsReady || finishedGames.length === 0) return data.byTagSlug;
    return applyEndedCorrections(
      data.byTagSlug,
      buildEndedCorrections(finishedGames)
    );
  }, [data?.byTagSlug, wsReady, finishedGames]);

  const isLiveActive = pathname === "/events/sports/live";

  return (
    // data-nosnippet: category nav + live counts read as noise in a snippet.
    <section
      data-nosnippet
      aria-label="Sport categories"
      className={cn(
        "min-w-0 border border-(--kwm-hl-2) bg-(--kwm-panel)",
        className
      )}
    >
      <div className="px-3 py-2.5 border-b border-(--kwm-hl)">
        <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-(--kwm-ink-3)">
          Sports
        </p>
      </div>

      <nav className="py-1.5 max-h-[calc(100vh-12rem)] overflow-y-auto scrollbar-thin">
        <Link
          href="/events/sports/live"
          onClick={onNavigate}
          aria-current={isLiveActive ? "page" : undefined}
          className={cn(
            "flex items-center justify-between gap-2 px-3 py-2 text-[14px] transition-colors",
            isLiveActive
              ? "text-(--kwm-ink) bg-(--kwm-bg-3) font-medium"
              : "text-(--kwm-ink-3) hover:text-(--kwm-ink) hover:bg-(--kwm-bg-2)"
          )}
        >
          <span className="flex items-center gap-2">
            <Radio className="h-3.5 w-3.5 text-(--kwm-up)" />
            <span>Live</span>
          </span>
          <CountBadge count={liveCount} isLive />
        </Link>

        <div className="mx-3 my-1 h-px bg-border/40" />

        {SPORT_GROUPS.map((group) => (
          <RailGroup
            key={group.slug}
            group={group}
            activeSlug={activeSlug}
            countsByTag={countsByTag}
            onNavigate={onNavigate}
            onOpenChange={(isOpen) => {
              setOpenGroupSlugs((previousSlugs) => {
                if (previousSlugs.has(group.slug) === isOpen) {
                  return previousSlugs;
                }
                const nextSlugs = new Set(previousSlugs);
                if (isOpen) {
                  nextSlugs.add(group.slug);
                } else {
                  nextSlugs.delete(group.slug);
                }
                return nextSlugs;
              });
            }}
            defaultOpen={
              activeGroupSlug === group.slug ||
              defaultOpenGroupSlugs.includes(group.slug)
            }
          />
        ))}
      </nav>
    </section>
  );
}

/**
 * Compact mobile picker: select the active sport group/league from a
 * native-feeling dropdown. Used on widths < lg where the full rail is
 * too tall to be reasonable.
 */
export function LeagueRailMobile({
  activeSlug,
  className,
}: Pick<LeagueRailProps, "activeSlug" | "className">) {
  const router = useRouter();
  const pathname = usePathname();

  const allOptions = useMemo(() => {
    const opts: Array<{ slug: string; label: string; depth: number }> = [
      { slug: "__live__", label: "Live", depth: 0 },
    ];
    for (const group of SPORT_GROUPS) {
      opts.push({ slug: group.slug, label: group.label, depth: 0 });
      for (const league of group.leagues) {
        opts.push({ slug: league.slug, label: `↳ ${league.label}`, depth: 1 });
      }
    }
    return opts;
  }, []);

  const value =
    pathname === "/events/sports/live" ? "__live__" : (activeSlug ?? "");

  return (
    <div data-nosnippet>
      <select
        aria-label="Sport category"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "__live__") {
            router.push("/events/sports/live");
          } else if (next) {
            router.push(`/events/sports/${next}`);
          }
        }}
        className={cn(
          "w-full px-3 py-2 text-[13px] bg-(--kwm-bg-2) border border-(--kwm-hl) text-(--kwm-ink) appearance-none",
          className
        )}
      >
        {allOptions.map((opt) => (
          <option key={opt.slug} value={opt.slug}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
