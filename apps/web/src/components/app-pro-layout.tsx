"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { ProTopNav } from "@/components/pro-top-nav";

/** Routes that use the pro chrome (sidebar hidden, top nav shown).
 *  Must mirror the list in the pre-hydration script in layout.tsx. */
const PRO_PATHS: ReadonlySet<string> = new Set([
  "/markets",
  "/whales",
  "/leaderboard",
  "/live",
  "/search",
  "/portfolio",
]);

/**
 * Shared layout wrapper for the pro chrome across sibling app pages
 * (/whales, /leaderboard, /live, /search, /portfolio, /events/[tag]).
 *
 * Responsibilities:
 *   1. Toggle the `app-pro-chrome` class on <html> so globals.css hides
 *      the app sidebar and zeros the main-content left margin at xl+.
 *   2. Render the shared <ProTopNav> above the page's own content —
 *      visible only at xl+ where the sidebar used to be. Below xl, the
 *      existing <Navbar /> (xl:hidden) keeps the mobile layout intact.
 *
 * Pages plug in like this:
 *
 *   export default function WhalesPage() {
 *     return (
 *       <AppProLayout>
 *         <WhalesContent />
 *       </AppProLayout>
 *     );
 *   }
 *
 * Works the same way on server or client components — the wrapper is
 * itself a client component, but it accepts any React children.
 */

/** Centralized controller for the `app-pro-chrome` class on <html>.
 *  Mount once in the root layout. Uses `usePathname` so pathname changes
 *  trigger a single effect that toggles the class — no add/remove gap
 *  between unmounting pages, so switching between two pro routes (e.g.
 *  /markets → /live) doesn't flash the sidebar.
 *
 *  Pairs with the pre-hydration script in layout.tsx: that script sets
 *  the class before React hydrates (avoids the initial-paint flash),
 *  and this component keeps it synchronized across client-side nav. */
export function ProChromeController() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const isEventsRoute = pathname?.startsWith("/events/") ?? false;
    const isProfileRoute = pathname?.startsWith("/profile/") ?? false;
    const isWhalesSubroute = pathname?.startsWith("/whales/") ?? false;
    const isMarketsSubroute = pathname?.startsWith("/markets/") ?? false;
    const isProPath = pathname ? PRO_PATHS.has(pathname) : false;
    const search = typeof window !== "undefined" ? window.location.search : "";
    const isLegacyMarkets =
      pathname === "/markets" &&
      new URLSearchParams(search).get("layout") === "legacy";
    const shouldEnable =
      (isProPath ||
        isEventsRoute ||
        isProfileRoute ||
        isWhalesSubroute ||
        isMarketsSubroute) &&
      !isLegacyMarkets;

    if (shouldEnable) {
      root.classList.add("app-pro-chrome");
    } else {
      root.classList.remove("app-pro-chrome");
    }
  }, [pathname]);

  return null;
}

/** Deprecated no-op kept for backwards compatibility. The class is now
 *  managed centrally by <ProChromeController> in the root layout, which
 *  avoids the old per-page add/remove flicker during client-side nav.
 *  Safe to leave the existing call sites in place — they're harmless. */
export function useProChrome(_enabled = true) {
  // Intentionally empty: see ProChromeController.
}

interface AppProLayoutProps {
  children: ReactNode;
  /** Container class for the outer content wrapper. Pages with their
   *  own container widths can pass a custom string; defaults to the
   *  typical padded page shell used across the app. */
  className?: string;
}

export function AppProLayout({
  children,
  className = "px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 xl:pb-8",
}: AppProLayoutProps) {
  useProChrome();

  return (
    <div className="min-h-screen bg-background">
      {/* ProTopNav is visible only at xl+ (matches where the sidebar
          used to live). Below xl, pages keep showing their own mobile
          Navbar (xl:hidden) — we don't interfere. */}
      <div className="hidden xl:block px-3 sm:px-4 md:px-6 lg:px-8 pt-2">
        <ProTopNav />
      </div>
      <main className={className}>{children}</main>
    </div>
  );
}

/**
 * Minimal intervention for pages that already have their own layout
 * (Navbar + container + content). Call this once at the top of the
 * page's JSX — it toggles the html class (sidebar hides) and renders
 * the ProTopNav at xl+ above the page's existing content.
 *
 * Below xl, this component is invisible and the page's mobile Navbar
 * takes over as before.
 */
export function ProChromeHeader() {
  useProChrome();
  return (
    <div className="hidden xl:block px-3 sm:px-4 md:px-6 lg:px-8 pt-2">
      <ProTopNav />
    </div>
  );
}
