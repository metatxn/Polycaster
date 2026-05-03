"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { ChromeHeader } from "@/components/app-layout";
import { CommentsSection } from "@/components/comments";
import { ErrorBoundary } from "@/components/error-boundary";
import { LeagueRail, LeagueRailMobile } from "@/components/league-rail";
import { MarketSearch } from "@/components/market-search";
import { Navbar } from "@/components/navbar";
import { SportsbookView } from "@/components/sportsbook-view";
import type { InitialHomeData } from "@/lib/server-cache";
import { getSportEntry } from "@/lib/sport-categories";

interface SportsContentProps {
  /** Reserved for future SSR hydration of the sportsbook feed. */
  initialData?: InitialHomeData | null;
  /** Sport sub-slug from the URL (`/events/sports/{slug}`). Empty string
   *  means the "All Sports" overview at `/events/sports`. */
  selectedSport?: string;
}

export function SportsContent({ selectedSport = "" }: SportsContentProps) {
  const router = useRouter();

  // Resolve the active sport entry (may be a top-level group or a nested
  // league). Falls back to a synthetic "Sports" overview when no slug is
  // supplied (legacy /events/sports root, before the redirect to /live).
  const sportEntry = selectedSport ? getSportEntry(selectedSport) : undefined;
  const sport = {
    label: sportEntry?.label ?? "Sports",
    tagSlug: sportEntry?.tagSlug ?? "sports",
    seriesId: sportEntry?.seriesId,
    isAllSports: !sportEntry,
  };

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <Navbar />
      <ChromeHeader />

      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 xl:pb-8">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground/90 mb-6 animate-in fade-in duration-500">
          <button
            type="button"
            onClick={() => router.push("/markets")}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Markets</span>
          </button>
          <span className="text-border/80">&rsaquo;</span>
          <span className="text-foreground">Sports</span>
          {selectedSport && (
            <>
              <span className="text-border/80">&rsaquo;</span>
              <span className="text-foreground">{sport.label}</span>
            </>
          )}
        </div>

        {/* Mobile-only sport picker — full rail lives in the left column at lg+ */}
        <div className="lg:hidden mb-4">
          <LeagueRailMobile activeSlug={selectedSport || undefined} />
        </div>

        <div className="grid gap-6 lg:gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:gap-8 xl:grid-cols-[240px_minmax(0,1fr)]">
          {/* Left: League rail (sticky) */}
          <div className="hidden lg:block">
            <div className="sticky top-4 self-start">
              <LeagueRail activeSlug={selectedSport || undefined} />
            </div>
          </div>

          {/* Right: hero + sportsbook + trade panel */}
          <div className="min-w-0 overflow-hidden">
            <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-700">
              <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-6">
                <div className="min-w-0 md:flex-1 md:max-w-3xl">
                  <h1 className="font-editorial italic font-medium text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.02] tracking-tight text-foreground wrap-break-word">
                    {sport.label}
                  </h1>
                  <p className="mt-4 text-base sm:text-lg text-muted-foreground font-editorial leading-snug max-w-2xl">
                    Live prediction markets across{" "}
                    {sport.isAllSports ? "every major league" : sport.label}.
                  </p>
                </div>

                <div className="flex items-center gap-3 flex-wrap md:flex-nowrap md:shrink-0 md:pb-1">
                  <MarketSearch
                    className="hidden md:block w-56"
                    tagSlug={sport.tagSlug}
                    tagLabel={sport.label}
                  />
                </div>
              </div>

              <div className="mt-6 h-px bg-linear-to-r from-border/80 via-border/40 to-transparent" />
            </div>

            <SportsbookView
              tagSlug={sport.tagSlug}
              seriesId={sport.seriesId}
              label={sport.label}
            />

            {sport.seriesId && (
              <div className="mt-10">
                <ErrorBoundary name="Sports Comments">
                  <CommentsSection
                    entityType="Series"
                    entityId={sport.seriesId}
                    variant="card"
                  />
                </ErrorBoundary>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
