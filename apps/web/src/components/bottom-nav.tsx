"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConnection } from "wagmi";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  requiresAuth?: boolean;
  showBalance?: boolean;
  /** Match this view param on the /markets page. */
  viewParam?: string;
}

const navItems: NavItem[] = [
  { label: "Markets", href: "/markets" },
  { label: "Live", href: "/live" },
  { label: "Whales", href: "/whales" },
  { label: "Search", href: "/search" },
  {
    label: "Portfolio",
    href: "/portfolio",
    requiresAuth: true,
    showBalance: true,
  },
];

/**
 * Mobile bottom dock. Visual grammar mirrors `<TopNav>`'s primary nav
 * row: mono caps labels, no rounded tabs, active state carried by the
 * underline glyph only. No colored accents, no glows — the hairline
 * `border-t` plus editorial typography does the work.
 *
 * Rendered only below xl; at xl+ the TopNav takes over.
 */
export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const { isConnected } = useConnection();
  const { usdcBalance, isDeployed: hasProxyWallet } = useProxyWallet();

  const visibleItems = navItems.filter(
    (item) => !item.requiresAuth || isConnected
  );

  const isItemActive = (item: NavItem) => {
    if (item.viewParam) {
      return pathname === "/markets" && viewParam === item.viewParam;
    }
    if (item.href === "/markets") {
      return pathname === "/markets" && !viewParam;
    }
    return (
      pathname === item.href ||
      (item.href !== "/markets" && pathname.startsWith(item.href))
    );
  };

  return (
    <nav className="xl:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t border-border/60 safe-area-pb">
      <div className="flex items-stretch h-14">
        {visibleItems.map((item) => {
          const isActive = isItemActive(item);

          return (
            <button
              key={item.href}
              type="button"
              onClick={() => router.push(item.href)}
              className={cn(
                "relative flex-1 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.showBalance && isConnected && hasProxyWallet ? (
                <span className="tabular-nums text-[11px] font-semibold normal-case tracking-normal">
                  $
                  {usdcBalance.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              ) : (
                <span>{item.label}</span>
              )}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-6 top-0 h-px bg-foreground"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
