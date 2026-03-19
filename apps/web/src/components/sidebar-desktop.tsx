"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dynamic import for code-splitting: The Sidebar component (with all its hooks
 * and dependencies like useTrendingEvents, useBreakingEvents, etc.) is only
 * loaded on desktop screens. Mobile users get zero sidebar JS.
 *
 * React 19 / Next.js 15 optimization: This proper dynamic import creates a
 * separate chunk that's only downloaded when needed, reducing initial bundle
 * size for mobile users.
 */
const SidebarDesktop = dynamic(() => import("./sidebar-desktop-inner"), {
  ssr: false,
  loading: () => (
    <aside className="hidden xl:flex fixed left-0 top-0 z-40 h-screen w-56 flex-col border-r border-gray-200 dark:border-border/40 bg-white dark:bg-background">
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-full rounded-lg" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
        </div>
        <Skeleton className="h-px w-full" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
        </div>
      </div>
    </aside>
  ),
});

// Export for use in layout
// Backwards-compatible alias (both exports are SSR-disabled via dynamic import)
export { SidebarDesktop, SidebarDesktop as SidebarDesktopNoSSR };
