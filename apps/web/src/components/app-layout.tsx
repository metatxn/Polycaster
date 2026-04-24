"use client";

import type { ReactNode } from "react";
import { TopNav } from "@/components/top-nav";

/**
 * Shared layout wrapper for app pages. Renders the editorial
 * `<TopNav>` at xl+ (matches where the legacy sidebar used to sit);
 * below xl each page keeps showing its own mobile Navbar (xl:hidden), so
 * this component is invisible on small screens.
 *
 * Pages plug in like this:
 *
 *   export default function WhalesPage() {
 *     return (
 *       <AppLayout>
 *         <WhalesContent />
 *       </AppLayout>
 *     );
 *   }
 */

interface AppLayoutProps {
  children: ReactNode;
  /** Container class for the outer content wrapper. Pages with their
   *  own container widths can pass a custom string; defaults to the
   *  typical padded page shell used across the app. */
  className?: string;
}

export function AppLayout({
  children,
  className = "px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 xl:pb-8",
}: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="hidden xl:block px-3 sm:px-4 md:px-6 lg:px-8 pt-2">
        <TopNav />
      </div>
      <main className={className}>{children}</main>
    </div>
  );
}

/**
 * Minimal intervention for pages that already have their own layout
 * (Navbar + container + content). Call this once at the top of the
 * page's JSX — it renders the TopNav at xl+ above the page's existing
 * content.
 *
 * Below xl, this component is invisible and the page's mobile Navbar
 * takes over as before.
 */
export function ChromeHeader() {
  return (
    <div className="hidden xl:block px-3 sm:px-4 md:px-6 lg:px-8 pt-2">
      <TopNav />
    </div>
  );
}
