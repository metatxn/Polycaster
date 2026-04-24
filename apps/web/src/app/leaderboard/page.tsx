import { createLogger } from "@knoww/logger";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getInitialLeaderboard } from "@/lib/server-cache";
import { LeaderboardContent } from "./leaderboard-content";

const log = createLogger("leaderboard-page");

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
    log.error("prefetch.failed", { error });
    // Continue with null - client will fetch on mount
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="space-y-3 text-center">
            <Skeleton className="h-10 w-48 mx-auto rounded-none" />
            <Skeleton className="h-3 w-32 mx-auto rounded-none" />
          </div>
        </div>
      }
    >
      <LeaderboardContent initialData={initialData} />
    </Suspense>
  );
}
