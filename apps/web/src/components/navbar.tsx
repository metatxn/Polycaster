"use client";

import { useAppKit } from "@reown/appkit/react";
import { ArrowDownToLine, Rocket, Wallet } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { useState } from "react";
import { useConnection } from "wagmi";
import { DepositModal } from "@/components/deposit-modal";
import { NotificationBellMobile } from "@/components/notifications";
import { SidebarMobile } from "@/components/sidebar-mobile";
import { ThemeToggle } from "@/components/theme-toggle";
import { useOnboarding } from "@/context/onboarding-context";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";

/** Truncate a 0x… address to `0x1234…abcd` for the mobile wallet pill.
 *  Mirrors the helper in ProTopNav so the two bars render the wallet in
 *  the same shape even though the layouts differ. */
function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Mobile top bar (below xl). Visually mirrors `<ProTopNav>` — editorial
 * K-block wordmark, mono caps wallet pill, hairline borders — so the
 * aesthetic is continuous across breakpoints. Only the layout compresses
 * (no primary-nav row, no category strip) because those collapse into
 * the `<SidebarMobile>` sheet at mobile widths.
 */
export function Navbar() {
  const { address, isConnected } = useConnection();
  const { open } = useAppKit();
  const [showDepositModal, setShowDepositModal] = useState(false);

  const { setShowOnboarding, needsTradingSetup } = useOnboarding();
  const { proxyAddress, isDeployed: hasProxyWallet } = useProxyWallet();

  return (
    <nav className="xl:hidden sticky top-0 z-50 w-full border-b border-border/60 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
        {/* Left: hamburger + wordmark */}
        <SidebarMobile />
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-[14px] tracking-tight hover:opacity-80 transition-opacity"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center bg-foreground text-background text-[11px] font-bold leading-none">
            K
          </span>
          Knoww
        </Link>

        {/* Right: contextual actions + wallet + theme */}
        <div className="flex items-center gap-2 ml-auto">
          {isConnected ? (
            <>
              <NotificationBellMobile />

              {needsTradingSetup && (
                <button
                  type="button"
                  onClick={() => {
                    posthog.capture("trading_account_setup_clicked", {
                      wallet_address: address,
                    });
                    setShowOnboarding(true);
                  }}
                  className="inline-flex items-center gap-1.5 bg-foreground text-background px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] hover:bg-foreground/90 transition-colors"
                >
                  <Rocket className="h-3 w-3" />
                  <span className="hidden sm:inline">Setup Trading</span>
                  <span className="sm:hidden">Setup</span>
                </button>
              )}

              {hasProxyWallet && proxyAddress && !needsTradingSetup && (
                <button
                  type="button"
                  onClick={() => setShowDepositModal(true)}
                  className="hidden sm:inline-flex items-center gap-1.5 border border-border hover:border-foreground/40 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-foreground transition-colors"
                >
                  <ArrowDownToLine className="h-3 w-3" />
                  Deposit
                </button>
              )}

              <button
                type="button"
                onClick={() => open()}
                className="flex items-center gap-2 px-2.5 py-1.5 border border-border hover:border-foreground/40 transition-colors font-mono text-[11px] uppercase tracking-[0.12em]"
              >
                <Wallet className="h-3.5 w-3.5" />
                <span className="hidden sm:inline tabular-nums normal-case tracking-normal text-[12px]">
                  {formatAddress(address || "")}
                </span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                posthog.capture("wallet_connect_clicked");
                open();
              }}
              className="flex items-center gap-2 bg-foreground text-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.15em] hover:bg-foreground/90 transition-colors"
            >
              <Wallet className="h-3.5 w-3.5" />
              Connect
            </button>
          )}

          {/* Force icon-only dimensions so theme label expansion doesn't
              reflow the wallet pill horizontally (matches ProTopNav). */}
          <div className="[&_button]:h-9 [&_button]:w-9 [&_button]:px-0 [&_button]:justify-center [&_button>span:not(.sr-only)]:hidden">
            <ThemeToggle />
          </div>
        </div>
      </div>

      <DepositModal
        open={showDepositModal}
        onOpenChange={setShowDepositModal}
      />
    </nav>
  );
}
