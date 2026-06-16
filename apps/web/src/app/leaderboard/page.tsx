import { createLogger } from "@knoww/logger";
import type { Metadata } from "next";
import type {
  LeaderboardCategory,
  LeaderboardOrderBy,
  LeaderboardTimePeriod,
} from "@/hooks/use-leaderboard";
import { buildPageMetadata } from "@/lib/seo";
import { getInitialLeaderboard } from "@/lib/server-cache";
import { LeaderboardContent } from "./leaderboard-content";

const log = createLogger("leaderboard-page");

export const metadata: Metadata = buildPageMetadata({
  title: "Prediction Market Leaderboard",
  description:
    "Track top prediction market traders by P&L, volume, and performance on Knoww.",
  path: "/leaderboard",
});

/**
 * Leaderboard Page - Server Component
 *
 * React 19 optimization: Pre-fetches the default leaderboard view
 * on the server (Cloudflare edge) to eliminate loading state on initial render.
 *
 * searchParams are read here on the server and passed as props to the client
 * component. This means LeaderboardContent does NOT need useSearchParams(),
 * which would cause the Suspense boundary to re-suspend on every URL change
 * and reset scroll position to 0.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const initialCategory = (params.category as LeaderboardCategory) || "OVERALL";
  const initialTimePeriod =
    (params.timePeriod as LeaderboardTimePeriod) || "DAY";
  const initialOrderBy = (params.orderBy as LeaderboardOrderBy) || "PNL";

  // Pre-fetch initial leaderboard data on the server (only for the default view)
  let initialData = null;
  if (
    initialCategory === "OVERALL" &&
    initialTimePeriod === "DAY" &&
    initialOrderBy === "PNL"
  ) {
    try {
      initialData = await getInitialLeaderboard();
    } catch (error) {
      log.error("prefetch.failed", { error });
      // Continue with null - client will fetch on mount
    }
  }

  return (
    <LeaderboardContent
      initialData={initialData}
      initialCategory={initialCategory}
      initialTimePeriod={initialTimePeriod}
      initialOrderBy={initialOrderBy}
    />
  );
}
