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
import { SPORT_GROUPS, type SportGroup } from "@/lib/sport-categories";
import { cn } from "@/lib/utils";

interface LeagueCounts {
  sports: number;
  live: number;
  byTagSlug: Record<string, number>;
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
}

const COUNT_TAG_SLUGS = (() => {
  const slugs = new Set<string>(["sports"]);
  for (const group of SPORT_GROUPS) {
    if (group.tagSlug) slugs.add(group.tagSlug);
    for (const league of group.leagues) {
      if (league.tagSlug) slugs.add(league.tagSlug);
    }
  }
  return Array.from(slugs);
})();

function useLeagueCounts() {
  return useQuery<LeagueCounts>({
    queryKey: ["league-counts", COUNT_TAG_SLUGS.join(",")],
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const slug of COUNT_TAG_SLUGS) params.append("slug", slug);
      const res = await fetch(`/api/events/league-counts?${params}`);
      if (!res.ok) throw new Error("Failed to load league counts");
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
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
        isLive
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground/80"
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
  defaultOpen: boolean;
}

function RailGroup({
  group,
  activeSlug,
  countsByTag,
  onNavigate,
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

  const groupActive = activeSlug === group.slug;
  const groupCount =
    group.leagues.length > 0 && countsByTag
      ? group.leagues.reduce(
          (total, league) => total + (countsByTag[league.tagSlug] ?? 0),
          0
        )
      : countsByTag?.[group.tagSlug];
  const countsLoaded = countsByTag !== undefined;

  // Single-league sports (Golf, F1, Boxing, …): render as a leaf, no
  // collapsible affordance. Polymarket does the same.
  if (group.leagues.length === 0) {
    if (countsLoaded && !groupCount) return null;

    return (
      <Link
        href={`/events/sports/${group.slug}`}
        onClick={onNavigate}
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-2 text-[14px] transition-colors",
          groupActive
            ? "text-foreground bg-accent/40 font-medium"
            : "text-muted-foreground/90 hover:text-foreground hover:bg-accent/20"
        )}
      >
        <span className="truncate">{group.label}</span>
        <CountBadge count={groupCount} />
      </Link>
    );
  }

  const visibleLeagues = countsLoaded
    ? group.leagues.filter((league) => (countsByTag[league.tagSlug] ?? 0) > 0)
    : group.leagues;

  if (countsLoaded && visibleLeagues.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-full flex items-center justify-between gap-2 px-3 py-2 text-[14px] transition-colors",
            groupActive
              ? "text-foreground bg-accent/40 font-medium"
              : "text-muted-foreground/90 hover:text-foreground hover:bg-accent/20"
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
                className={cn(
                  "flex items-center justify-between gap-2 pl-9 pr-3 py-1.5 text-[13px] transition-colors",
                  isActive
                    ? "text-foreground bg-accent/40 font-medium"
                    : "text-muted-foreground/90 hover:text-foreground hover:bg-accent/20"
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
 * Live counts come from a single batched /api/events/league-counts call
 * cached for 60s.
 */
export function LeagueRail({
  activeSlug,
  defaultOpenGroupSlugs = [],
  onNavigate,
  className,
}: LeagueRailProps) {
  const pathname = usePathname();
  const { data } = useLeagueCounts();
  const defaultOpenGroupSet = useMemo(
    () => new Set(defaultOpenGroupSlugs),
    [defaultOpenGroupSlugs]
  );

  // Derive which group should auto-open: the one containing the active slug.
  const activeGroupSlug = useMemo(() => {
    if (!activeSlug) return null;
    for (const group of SPORT_GROUPS) {
      if (group.slug === activeSlug) return group.slug;
      if (group.leagues.some((l) => l.slug === activeSlug)) return group.slug;
    }
    return null;
  }, [activeSlug]);

  const isLiveActive = pathname === "/events/sports/live";

  return (
    <aside
      aria-label="Sport categories"
      className={cn("min-w-0 border border-border/60 bg-background", className)}
    >
      <div className="px-3 py-2.5 border-b border-border/40">
        <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted-foreground/80">
          Sports
        </p>
      </div>

      <nav className="py-1.5 max-h-[calc(100vh-12rem)] overflow-y-auto scrollbar-thin">
        <Link
          href="/events/sports/live"
          onClick={onNavigate}
          className={cn(
            "flex items-center justify-between gap-2 px-3 py-2 text-[14px] transition-colors",
            isLiveActive
              ? "text-foreground bg-accent/40 font-medium"
              : "text-muted-foreground/90 hover:text-foreground hover:bg-accent/20"
          )}
        >
          <span className="flex items-center gap-2">
            <Radio className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Live</span>
          </span>
          <CountBadge count={data?.live} isLive />
        </Link>

        <div className="mx-3 my-1 h-px bg-border/40" />

        {SPORT_GROUPS.map((group) => (
          <RailGroup
            key={group.slug}
            group={group}
            activeSlug={activeSlug}
            countsByTag={data?.byTagSlug}
            onNavigate={onNavigate}
            defaultOpen={
              activeGroupSlug === group.slug ||
              defaultOpenGroupSet.has(group.slug)
            }
          />
        ))}
      </nav>
    </aside>
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
        "w-full px-3 py-2 text-[13px] bg-background border border-border/60 text-foreground appearance-none",
        className
      )}
    >
      {allOptions.map((opt) => (
        <option key={opt.slug} value={opt.slug}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
