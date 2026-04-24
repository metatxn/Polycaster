"use client";

import { useAppKit } from "@reown/appkit/react";
import { Menu, Wallet } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useConnection } from "wagmi";
import { DepositModal } from "@/components/deposit-modal";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useRelayerClient } from "@/hooks/use-relayer-client";
import { cn } from "@/lib/utils";

/** Primary destinations — mirror of PRIMARY_LINKS in top-nav. */
const PRIMARY_LINKS: Array<{ label: string; href: string }> = [
  { label: "Markets", href: "/markets" },
  { label: "Live", href: "/live" },
  { label: "Whales", href: "/whales" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Search", href: "/search" },
];

/** Category taxonomy — mirror of CATEGORIES in top-nav. */
const CATEGORIES: Array<{ label: string; href: string }> = [
  { label: "Politics", href: "/events/politics" },
  { label: "Sports", href: "/events/sports" },
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

export function SidebarMobile() {
  const router = useRouter();
  const pathname = usePathname();
  const { isConnected } = useConnection();
  const { open } = useAppKit();
  const [isOpen, setIsOpen] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);

  const {
    proxyAddress: proxyWalletAddress,
    isDeployed: hasProxyWalletFromHook,
    usdcBalance: proxyUsdcBalance,
  } = useProxyWallet();

  const {
    proxyAddress: relayerProxyAddress,
    hasDeployedSafe: hasDeployedSafeFromRelayer,
  } = useRelayerClient();

  const proxyAddress = relayerProxyAddress || proxyWalletAddress;
  const hasProxyWallet = hasDeployedSafeFromRelayer || hasProxyWalletFromHook;

  const handleNavigation = (href: string) => {
    router.push(href);
    setIsOpen(false);
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="xl:hidden">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>

        <SheetContent
          side="left"
          className="w-72 p-0 flex flex-col bg-background"
        >
          <SheetDescription className="sr-only">
            Knoww navigation — browse markets, view your portfolio, and manage
            your trading wallet.
          </SheetDescription>

          {/* Header — editorial K-block wordmark, matches TopNav */}
          <div className="flex items-center gap-2 px-4 h-14 border-b border-border/60">
            <span className="inline-flex h-6 w-6 items-center justify-center bg-foreground text-background text-[11px] font-bold leading-none">
              K
            </span>
            <SheetTitle className="font-bold text-[14px] tracking-tight">
              Knoww
            </SheetTitle>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-6 px-3">
            {/* Primary links — mono caps with underline-active */}
            <div className="mb-7">
              <p className="px-3 mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                §&nbsp;&nbsp;Navigate
              </p>
              <div>
                {PRIMARY_LINKS.map((link) => {
                  const isActive =
                    pathname === link.href ||
                    (link.href !== "/" && pathname?.startsWith(link.href));
                  return (
                    <button
                      type="button"
                      key={link.href}
                      onClick={() => handleNavigation(link.href)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.15em] border-b border-border/40 transition-colors text-left",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span>{link.label}</span>
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="font-sans text-foreground/60"
                        >
                          →
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Browse categories — same editorial pattern */}
            <div>
              <p className="px-3 mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                §&nbsp;&nbsp;Browse
              </p>
              <div>
                {CATEGORIES.map((cat) => {
                  const isActive = pathname === cat.href;
                  return (
                    <button
                      type="button"
                      key={cat.href}
                      onClick={() => handleNavigation(cat.href)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2.5 border-b border-border/40 transition-colors text-left",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className="font-editorial italic text-base">
                        {cat.label}
                      </span>
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="font-sans text-foreground/60"
                        >
                          →
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>

          {/* Bottom — editorial balance block, no hardcoded dark card */}
          <div className="border-t border-border/60 px-4 py-5 space-y-4">
            {isConnected && hasProxyWallet && proxyAddress ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                    <Wallet className="h-3 w-3" />
                    Balance
                  </div>
                </div>
                <p className="font-editorial italic text-4xl leading-none tracking-tight text-foreground tabular-nums">
                  $
                  {proxyUsdcBalance.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowDepositModal(true);
                    setIsOpen(false);
                  }}
                  className="group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] text-foreground transition-colors hover:text-muted-foreground"
                >
                  <span className="underline underline-offset-4 decoration-border group-hover:decoration-foreground transition-colors">
                    Deposit
                  </span>
                  <span
                    aria-hidden="true"
                    className="translate-y-px transition-transform group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </button>
              </>
            ) : !isConnected ? (
              <button
                type="button"
                onClick={() => {
                  open();
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2 bg-foreground text-background px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] hover:bg-foreground/90 transition-colors"
              >
                <Wallet className="h-3.5 w-3.5" />
                Connect Wallet
              </button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <DepositModal
        open={showDepositModal}
        onOpenChange={setShowDepositModal}
      />
    </>
  );
}
