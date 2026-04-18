import { Suspense } from "react";
import { preload } from "react-dom";
import {
  buildOptimizedImageUrl,
  PRIORITY_EVENT_CARD_COUNT,
} from "@/lib/lcp-images";
import { getInitialEvents } from "@/lib/server-cache";
import { HomeContent } from "./home-content";

/**
 * Homepage - Server Component
 *
 * Benefits of this pattern:
 * 1. Initial data is fetched on the edge (Cloudflare Workers)
 * 2. Zero loading state for first render - content is pre-rendered
 * 3. Reduced JavaScript bundle for initial paint
 * 4. Better SEO - content is in the HTML
 * 5. Faster TTFP (Time to First Paint)
 *
 * The client component handles all interactivity (tabs, filters, infinite scroll)
 * while receiving the initial data as props for hydration.
 */
export default async function Home() {
  // Pre-fetch initial events on the server (runs at the edge)
  const initialData = await getInitialEvents();

  // Emit <link rel="preload" as="image" fetchpriority="high"> for the first
  // few cards before HomeContent streams in. This bypasses the Suspense
  // boundary: the preload tags land in the initial document head and the
  // browser's preload scanner kicks off image fetches immediately, instead of
  // waiting for the streamed HTML chunk to arrive and for hydration to run.
  initialData?.events?.slice(0, PRIORITY_EVENT_CARD_COUNT).forEach((event) => {
    if (event.image) {
      preload(buildOptimizedImageUrl(event.image), {
        as: "image",
        fetchPriority: "high",
      });
    }
  });

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="flex gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
            <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
            <div className="w-2 h-2 rounded-full bg-primary animate-bounce" />
          </div>
        </div>
      }
    >
      <HomeContent initialData={initialData} />
    </Suspense>
  );
}
