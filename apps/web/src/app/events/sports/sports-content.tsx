"use client";

import { ChromeHeader } from "@/components/app-layout";
import { CommentsSection } from "@/components/comments";
import { ErrorBoundary } from "@/components/error-boundary";
import { LeagueRail, LeagueRailMobile } from "@/components/league-rail";
import { MarketSearch } from "@/components/market-search";
import { Navbar } from "@/components/navbar";
import { ProductFooter } from "@/components/product-footer";
import { ProductHero } from "@/components/product-hero";
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

  const breadcrumbs = [
    { label: "Markets", href: "/markets" },
    selectedSport ? { label: "Sports", href: "/events/sports" } : null,
    { label: selectedSport ? sport.label : "Sports" },
  ].filter(Boolean) as { label: string; href?: string }[];

  return (
    <div className="kw-app min-h-screen relative overflow-x-hidden">
      <Navbar />
      <ChromeHeader />

      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 xl:pb-8">
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
            <ProductHero
              breadcrumbs={breadcrumbs}
              rightSlot={
                <MarketSearch
                  className="hidden md:block w-48"
                  tagSlug={sport.tagSlug}
                  tagLabel={sport.label}
                />
              }
            />

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
      <ProductFooter context={sport.label} />
    </div>
  );
}
