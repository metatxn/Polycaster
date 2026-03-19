"use client";

import { useAppKit } from "@reown/appkit/react";
import {
  BarChart2,
  Bitcoin,
  CircleDollarSign,
  Cpu,
  Crown,
  Fish,
  FolderOpen,
  Globe,
  Grid3X3,
  Landmark,
  Menu,
  MessageSquare,
  TrendingUp,
  Trophy,
  Users,
  Vote,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useConnection } from "wagmi";
import { DepositModal } from "@/components/deposit-modal";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useRelayerClient } from "@/hooks/use-relayer-client";
import { cn } from "@/lib/utils";

// Categories with Lucide icons
const categories = [
  { label: "Politics", href: "/events/politics", icon: Landmark },
  { label: "Sports", href: "/events/sports", icon: Trophy },
  { label: "Crypto", href: "/events/crypto", icon: Bitcoin },
  { label: "Finance", href: "/events/finance", icon: CircleDollarSign },
  { label: "Geopolitics", href: "/events/geopolitics", icon: Globe },
  { label: "Earnings", href: "/events/earnings", icon: BarChart2 },
  { label: "Tech", href: "/events/tech", icon: Cpu },
  { label: "Culture", href: "/events/pop-culture", icon: Users },
  { label: "World", href: "/events/world", icon: Globe },
  { label: "Economy", href: "/events/economy", icon: TrendingUp },
  { label: "Elections", href: "/events/elections", icon: Vote },
  { label: "Mentions", href: "/events/mention-markets", icon: MessageSquare },
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

        <SheetContent side="left" className="w-72 p-0 flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 h-14 border-b">
            <Image src="/logo-256x256.png" alt="Knoww" width={28} height={28} />
            <SheetTitle className="font-bold text-lg">Knoww</SheetTitle>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-4 px-3">
            {/* Main Navigation */}
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => handleNavigation("/")}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors",
                  pathname === "/"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Grid3X3 className="h-5 w-5" />
                All Markets
              </button>

              <button
                type="button"
                onClick={() => handleNavigation("/whales")}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors",
                  pathname === "/whales"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Fish className="h-5 w-5" />
                Whales
              </button>

              {isConnected && (
                <button
                  type="button"
                  onClick={() => handleNavigation("/portfolio")}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors",
                    pathname === "/portfolio"
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <FolderOpen className="h-5 w-5" />
                  Portfolio
                </button>
              )}

              <button
                type="button"
                onClick={() => handleNavigation("/leaderboard")}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors",
                  pathname === "/leaderboard"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Crown className="h-5 w-5" />
                Leaderboard
              </button>
            </div>

            {/* Browse Section */}
            <div className="mt-6">
              <h3 className="px-3 mb-2 text-xs font-semibold text-primary uppercase tracking-wider">
                Browse
              </h3>
              <div className="space-y-0.5">
                {categories.map((cat) => {
                  const isActive = pathname === cat.href;
                  return (
                    <button
                      type="button"
                      key={cat.href}
                      onClick={() => handleNavigation(cat.href)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <cat.icon className="h-4 w-4" />
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>

          {/* Bottom Section */}
          <div className="border-t p-3 space-y-3 bg-muted/30">
            {/* Balance Card - Simplified for mobile (no address shown) */}
            {isConnected && hasProxyWallet && proxyAddress && (
              <div className="relative overflow-hidden p-4 rounded-2xl bg-gray-900 border border-gray-800 shadow-xl">
                {/* Subtle gradient overlay */}
                <div className="absolute inset-0 bg-linear-to-br from-gray-800/50 via-transparent to-gray-900/50 pointer-events-none" />

                <div className="relative space-y-3">
                  {/* Header: Balance label */}
                  <div className="flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-400">
                      Balance
                    </span>
                  </div>

                  {/* Balance Amount */}
                  <p className="text-3xl font-bold text-white tracking-tight">
                    $
                    {proxyUsdcBalance.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>

                  {/* Deposit Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowDepositModal(true);
                      setIsOpen(false);
                    }}
                    className="w-full py-2.5 text-sm font-semibold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white transition-all shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40"
                  >
                    Deposit
                  </button>
                </div>
              </div>
            )}

            {/* Connect Wallet Button - Only show when not connected */}
            {!isConnected && (
              <Button
                onClick={() => {
                  open();
                  setIsOpen(false);
                }}
                className="w-full"
              >
                <Wallet className="mr-2 h-4 w-4" />
                Connect Wallet
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Deposit Modal */}
      <DepositModal
        open={showDepositModal}
        onOpenChange={setShowDepositModal}
      />
    </>
  );
}
