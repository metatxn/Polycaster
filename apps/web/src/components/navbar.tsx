"use client";

import { useAppKit } from "@reown/appkit/react";
import {
  ArrowDownToLine,
  ChevronDown,
  LogOut,
  Rocket,
  User,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBalance, useConnection, useDisconnect } from "wagmi";
import { DepositModal } from "@/components/deposit-modal";
import { NotificationBellMobile } from "@/components/notifications";
import { SidebarMobile } from "@/components/sidebar-mobile";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOnboarding } from "@/context/onboarding-context";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";

export function Navbar() {
  const router = useRouter();
  const { address, isConnected, chain } = useConnection();
  const disconnect = useDisconnect();
  const { data: balance } = useBalance({ address });
  const { open } = useAppKit();
  const [showDepositModal, setShowDepositModal] = useState(false);

  // Use the global onboarding context
  const { setShowOnboarding, needsTradingSetup } = useOnboarding();

  // Proxy wallet for deposit functionality
  const { proxyAddress, isDeployed: hasProxyWallet } = useProxyWallet();

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatBalance = (value: bigint, decimals: number) => {
    const divisor = BigInt(10 ** decimals);
    const integerPart = value / divisor;
    const fractionalPart = value % divisor;
    const fractionalStr = fractionalPart
      .toString()
      .padStart(decimals, "0")
      .slice(0, 2);
    return `${integerPart}.${fractionalStr}`;
  };

  return (
    <nav className="xl:hidden sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      {/* Main Navbar - Mobile Only */}
      <div className="flex h-14 items-center px-4 md:px-6">
        {/* Mobile Sidebar Trigger + Logo */}
        <div className="flex items-center gap-2">
          <SidebarMobile />
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-2 font-bold text-lg hover:opacity-80 transition-opacity"
          >
            <Image
              src="/logo-256x256.png"
              alt="Knoww"
              width={24}
              height={24}
              className="sm:w-7 sm:h-7"
            />
            <span>Knoww</span>
          </button>
        </div>

        {/* Right Side - Theme Toggle, Wallet Info & Actions */}
        <div className="flex items-center gap-2 ml-auto">
          {/* Theme Toggle */}
          <ThemeToggle />

          {isConnected ? (
            <>
              {/* Notification Bell - Mobile */}
              <NotificationBellMobile />

              {/* Setup Trading Account Button - Show when user hasn't completed setup */}
              {needsTradingSetup && (
                <Button
                  onClick={() => setShowOnboarding(true)}
                  size="sm"
                  className="bg-linear-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  <Rocket className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">Setup Trading</span>
                  <span className="sm:hidden">Setup</span>
                </Button>
              )}

              {/* Deposit Button - Hidden on mobile, shown on tablet+ */}
              {hasProxyWallet && proxyAddress && !needsTradingSetup && (
                <Button
                  onClick={() => setShowDepositModal(true)}
                  size="sm"
                  className="hidden sm:flex bg-linear-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-sm shadow-emerald-500/25"
                >
                  <ArrowDownToLine className="mr-1 h-4 w-4" />
                  Deposit
                </Button>
              )}

              {/* Balance Badge */}
              {balance && (
                <Badge variant="secondary" className="hidden sm:inline-flex">
                  {formatBalance(balance.value, balance.decimals)}{" "}
                  {balance.symbol}
                </Badge>
              )}

              {/* Account Dropdown */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Wallet className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {formatAddress(address || "")}
                    </span>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />

                  <div className="px-2 py-2 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Address:</span>
                      <span className="font-mono text-xs">
                        {formatAddress(address || "")}
                      </span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Network:</span>
                      <span className="font-medium text-xs">
                        {chain?.name || "Unknown"}
                      </span>
                    </div>

                    {balance && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Balance:</span>
                        <span className="font-medium text-xs">
                          {formatBalance(balance.value, balance.decimals)}{" "}
                          {balance.symbol}
                        </span>
                      </div>
                    )}
                  </div>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem onClick={() => open()}>
                    <User className="mr-2 h-4 w-4" />
                    <span>Account Settings</span>
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={() => disconnect.mutate({})}
                    className="text-destructive focus:text-destructive"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Disconnect</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button onClick={() => open()} size="sm">
              <Wallet className="mr-2 h-4 w-4" />
              Connect Wallet
            </Button>
          )}
        </div>
      </div>

      {/* Deposit Modal */}
      <DepositModal
        open={showDepositModal}
        onOpenChange={setShowDepositModal}
      />
    </nav>
  );
}
