"use client";

import { motion } from "framer-motion";
import { Home, Search, Wallet, Zap } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConnection } from "wagmi";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Home;
  requiresAuth?: boolean;
  showBalance?: boolean;
  /** Match this view param on home page */
  viewParam?: string;
}

const navItems: NavItem[] = [
  { label: "Home", href: "/", icon: Home },
  { label: "Search", href: "/search", icon: Search },
  {
    label: "Breaking",
    href: "/?view=breaking",
    icon: Zap,
    viewParam: "breaking",
  },
  {
    label: "Portfolio",
    href: "/portfolio",
    icon: Wallet,
    requiresAuth: true,
    showBalance: true,
  },
];

/**
 * Bottom navigation bar for mobile screens
 * Shows key navigation items with the portfolio balance
 * Enhanced with better visual feedback and touch interactions
 */
export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const { isConnected } = useConnection();
  const { usdcBalance, isDeployed: hasProxyWallet } = useProxyWallet();

  const handleNavigation = (item: NavItem) => {
    router.push(item.href);
  };

  // Filter items based on auth state
  const visibleItems = navItems.filter(
    (item) => !item.requiresAuth || isConnected
  );

  // Check if item is active
  const isItemActive = (item: NavItem) => {
    // Special handling for Breaking - active when on home with view=breaking
    if (item.viewParam) {
      return pathname === "/" && viewParam === item.viewParam;
    }
    // Home is active when on "/" without a view param
    if (item.href === "/") {
      return pathname === "/" && !viewParam;
    }
    // Other items - standard path matching
    return (
      pathname === item.href ||
      (item.href !== "/" && pathname.startsWith(item.href))
    );
  };

  return (
    <nav className="xl:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-t border-border/30 safe-area-pb">
      {/* Subtle top gradient line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

      <div className="flex items-center justify-around h-16 px-1">
        {visibleItems.map((item) => {
          const isActive = isItemActive(item);
          const Icon = item.icon;

          return (
            <motion.button
              key={item.href}
              type="button"
              onClick={() => handleNavigation(item)}
              whileTap={{ scale: 0.92 }}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 px-4 py-2 rounded-2xl transition-all duration-200 min-w-[72px]",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground active:text-foreground"
              )}
            >
              {/* Active background glow */}
              {isActive && (
                <motion.div
                  layoutId="bottomNavActive"
                  className="absolute inset-0 bg-primary/10 rounded-2xl"
                  initial={false}
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}

              {/* Active indicator dot */}
              {isActive && (
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="absolute -top-0.5 w-1.5 h-1.5 rounded-full bg-primary shadow-lg shadow-primary/50"
                />
              )}

              <div className="relative z-10">
                <Icon
                  className={cn(
                    "h-5 w-5 transition-transform duration-200",
                    isActive && "scale-110"
                  )}
                />
              </div>

              {/* Show balance for portfolio, label for others */}
              {item.showBalance && isConnected && hasProxyWallet ? (
                <span
                  className={cn(
                    "relative z-10 text-[10px] font-bold tabular-nums transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  $
                  {usdcBalance.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              ) : (
                <span
                  className={cn(
                    "relative z-10 text-[10px] font-semibold transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
}
