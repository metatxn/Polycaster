"use client";

import {
  ProductHero,
  ProductLiveDot,
  ProductRefreshButton,
} from "@/components/product-hero";

interface WhaleHeroProps {
  /** Either "Whale Activity" or "Insider Detection" — reflects the
   *  current tab for the breadcrumb's third crumb. */
  section: string;
  /** Milliseconds since the data was last updated. Used to render a
   *  freshness indicator. */
  dataAgeMs: number | null;
  /** Websocket connection state for the live tape. Only meaningful on
   *  the Whales tab; caller may pass null on Insiders. */
  isLive: boolean | null;
  isFetching: boolean;
  onRefresh: () => void;
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Whales hero — DeFi product hero wrapping the shared `ProductHero` so the
 * breadcrumb, title rhythm, and bottom hairline match the rest of the
 * product surfaces. Whale-specific bits live in the title (icon next to
 * wordmark) and the right meta cluster (live tape dot + freshness).
 */
export function WhaleHero({
  section,
  dataAgeMs,
  isLive,
  isFetching,
  onRefresh,
}: WhaleHeroProps) {
  const isFresh = dataAgeMs !== null && dataAgeMs < 120_000;

  return (
    <ProductHero
      breadcrumbs={[
        { label: "Markets", href: "/markets" },
        { label: "Whales" },
        { label: section },
      ]}
      rightSlot={
        <>
          {isLive !== null && (
            <ProductLiveDot
              isLive={isLive}
              liveLabel="Live tape"
              offlineLabel="Offline"
            />
          )}
          <div className="flex items-center gap-1.5">
            <span>Updated</span>
            <span
              className="font-semibold tabular-nums"
              style={{
                color: isFresh ? "var(--kwm-ink)" : "var(--kwm-ink-3)",
              }}
            >
              {dataAgeMs === null ? "—" : formatAge(dataAgeMs)}
            </span>
            <span>ago</span>
          </div>
          <ProductRefreshButton onRefresh={onRefresh} isFetching={isFetching} />
        </>
      }
    />
  );
}
