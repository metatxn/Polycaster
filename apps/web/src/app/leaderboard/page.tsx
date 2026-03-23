import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getInitialLeaderboard } from "@/lib/server-cache";
import { LeaderboardContent } from "./leaderboard-content";

/**
 * Leaderboard Page - Server Component
 *
 * React 19 optimization: Pre-fetches the default leaderboard view
 * on the server (Cloudflare edge) to eliminate loading state on initial render.
 */
export default async function LeaderboardPage() {
  // Pre-fetch initial leaderboard data on the server
  let initialData = null;
  try {
    initialData = await getInitialLeaderboard();
  } catch (error) {
    console.error("[LeaderboardPage] Failed to pre-fetch data:", error);
    // Continue with null - client will fetch on mount
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="space-y-4 text-center">
            <Skeleton className="h-12 w-48 mx-auto rounded-xl" />
            <Skeleton className="h-4 w-32 mx-auto rounded-lg" />
          </div>
        </div>
      }
    >
      <LeaderboardContent initialData={initialData} />
    </Suspense>
  );
}
