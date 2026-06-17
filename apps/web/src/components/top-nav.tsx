"use client";

import { Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useConnection } from "wagmi";
import { KnowwMark } from "@/components/knoww-mark";
import { MarketSearch } from "@/components/market-search";
import { NotificationBellMobile } from "@/components/notifications";
import { ThemeToggle } from "@/components/theme-toggle";
import { WalletMenu } from "@/components/wallet-menu";
import { formatAddress } from "@/lib/formatters";
import { openWalletModal, preloadWalletModal } from "@/lib/wallet-modal";

/**
 * Top nav — the two-row bar above every app page at xl+. Row 1: wordmark
 * + primary links + wallet + theme. Row 2: category strip (horizontal,
 * overflow-scroll at narrow widths).
 *
 * This is the single source of truth for top-level navigation in the
 * app. Used by both /markets (via MarketsView) and the sibling app
 * pages (via AppLayout).
 *
 * Active-link detection uses `usePathname` + `startsWith` so that
 * category pages (/events/politics) correctly highlight the Politics
 * chip, and /markets highlights the Markets primary link.
 */

/** Primary-nav links — every top-level destination in the app. */
const PRIMARY_LINKS: Array<{ label: string; href: string }> = [
  { label: "Markets", href: "/markets" },
  { label: "Live", href: "/events/sports/live" },
  { label: "Whales", href: "/whales" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "FIFA", href: "/events/sports/fifa-world-cup" },
];

/** Category taxonomy — each item maps to the `/events/{slug}` browse
 *  page. Mirrored in [sidebar-mobile.tsx] for the mobile drawer. */
const CATEGORIES: Array<{ label: string; href: string }> = [
  { label: "Politics", href: "/events/politics" },
  { label: "Sports", href: "/events/sports/live" },
  { label: "Crypto", href: "/events/crypto" },
  { label: "Finance", href: "/events/finance" },
  { label: "Geopolitics", href: "/events/geopolitics" },
  { label: "Earnings", href: "/events/earnings" },
  { label: "Tech", href: "/events/tech" },
  { label: "Culture", href: "/events/pop-culture" },
  { label: "World", href: "/events/world" },
  { label: "Economy", href: "/events/economy" },
  { label: "Elections", href: "/events/elections" },
  { label: "Mentions", href: "/events/mention-markets" },
];

export function TopNav() {
  const pathname = usePathname();
  const { address, isConnected } = useConnection();
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      await openWalletModal();
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="border-b border-border/60">
      {/* Row 1 — primary nav + wallet + theme + search.
          Search lives in the right cluster so it sits next to the
          other utility actions (bell, wallet, theme) rather than
          competing for centered space against the wider left nav. */}
      <div className="flex items-center justify-between gap-6 px-1 py-3">
        {/* Left — wordmark + primary links */}
        <div className="flex items-center gap-6 shrink-0">
          <Link
            href="/"
            className="flex items-center gap-2 font-bold text-[14px] tracking-tight hover:opacity-80 transition-opacity"
          >
            <KnowwMark />
            Knoww
          </Link>

          <span aria-hidden="true" className="h-4 w-px bg-border/60" />

          <nav aria-label="Primary" className="flex items-center gap-1">
            {PRIMARY_LINKS.map((link) => {
              const isActive =
                pathname === link.href ||
                (link.href !== "/" && pathname?.startsWith(link.href));
              const isFifa = link.href === "/events/sports/fifa-world-cup";
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-2.5 py-1 border-b-2 font-mono text-[13px] font-medium uppercase tracking-[0.08em] transition-colors ${
                    isActive
                      ? "text-(--kwm-ink) border-(--kwm-ink)"
                      : "text-(--kwm-ink-2) border-transparent hover:text-(--kwm-ink) hover:border-(--kwm-ink-3)/40"
                  } ${isFifa ? "kw-fifa-nav-link" : ""}`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right — search + notifications + wallet + theme. Search
            leads the cluster as the most-used utility; widths step
            up at 2xl+ where there's more breathing room. */}
        <div className="flex items-center gap-2 shrink-0">
          <MarketSearch variant="boxed" className="w-56 2xl:w-64" />
          {/* Bell renders only when wallet is connected; dropdown opens
              below the nav with `align="end"`. When disconnected the
              component returns null, so the cluster stays stable. */}
          <NotificationBellMobile />
          {isConnected && address ? (
            <WalletMenu>
              <button
                type="button"
                className="flex items-center gap-2 px-3 py-1.5 border border-border hover:border-foreground/40 transition-colors font-mono text-[12px] uppercase tracking-[0.08em]"
              >
                <Wallet className="h-3.5 w-3.5" />
                <span className="tabular-nums normal-case tracking-normal text-[12px]">
                  {formatAddress(address)}
                </span>
              </button>
            </WalletMenu>
          ) : (
            <button
              type="button"
              disabled={connecting}
              onMouseEnter={preloadWalletModal}
              onFocus={preloadWalletModal}
              onClick={() => void handleConnect()}
              className="flex items-center gap-2 bg-foreground text-background px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.08em] hover:bg-foreground/90 transition-colors"
            >
              <Wallet className="h-3.5 w-3.5" />
              {connecting ? "Connecting…" : "Connect"}
            </button>
          )}
          {/* ThemeToggle renders its theme label inside the button,
              which varies in width ("Dark" → "Midnight" → "Lavender").
              With `justify-between` on the parent row, that expansion
              pushes Connect leftward on every theme switch. Force
              icon-only dimensions here so the right-side cluster has a
              stable width. */}
          <div className="[&_button]:h-9 [&_button]:w-9 [&_button]:px-0 [&_button]:justify-center [&_button>span:not(.sr-only)]:hidden">
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Row 2 — category strip. Horizontal scroll on narrow widths so
          all 12 categories remain reachable without dropdowns. */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide border-t border-(--kwm-hl-2) px-1 py-2">
        <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-(--kwm-ink-3) pr-2">
          §
        </span>
        {CATEGORIES.map((cat, i) => {
          const isActive = pathname === cat.href;
          return (
            <div key={cat.href} className="flex items-center">
              <Link
                href={cat.href}
                className={`shrink-0 px-2.5 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[0.08em] transition-colors rounded-sm ${
                  isActive
                    ? "text-(--kwm-ink) bg-accent/40"
                    : "text-(--kwm-ink-3) hover:text-(--kwm-ink) hover:bg-accent/30"
                }`}
              >
                {cat.label}
              </Link>
              {i < CATEGORIES.length - 1 && (
                <span
                  aria-hidden="true"
                  className="text-(--kwm-ink-3) px-0.5 select-none"
                >
                  ·
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
