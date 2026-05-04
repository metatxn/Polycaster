"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronLeft,
  Copy,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatAddress } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface PortfolioUtilityRowProps {
  proxyAddress?: string;
  hasProxyWallet: boolean;
  onDeposit: () => void;
  onWithdraw: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function PortfolioUtilityRow({
  proxyAddress,
  hasProxyWallet,
  onDeposit,
  onWithdraw,
  onRefresh,
  isRefreshing,
}: PortfolioUtilityRowProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = () => {
    if (!proxyAddress) return;
    navigator.clipboard.writeText(proxyAddress);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground/90">
        <Link
          href="/markets"
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Markets</span>
        </Link>
        <span className="text-border/80">&rsaquo;</span>
        <span className="text-foreground">Portfolio</span>
      </div>

      <div className="flex items-center gap-5 flex-wrap font-mono text-[11px] uppercase tracking-[0.14em]">
        {proxyAddress && (
          <button
            type="button"
            onClick={handleCopy}
            className="group inline-flex items-center gap-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{formatAddress(proxyAddress)}</span>
            {copied ? (
              <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3 opacity-60 group-hover:opacity-100" />
            )}
          </button>
        )}
        {hasProxyWallet && proxyAddress && (
          <>
            <button
              type="button"
              onClick={onDeposit}
              className="group inline-flex items-center gap-2 py-1 font-semibold text-foreground transition-colors"
            >
              <ArrowDownToLine className="h-3 w-3" />
              <span className="border-b-2 border-foreground pb-0.5 group-hover:border-foreground/60 transition-colors">
                Deposit
              </span>
            </button>
            <button
              type="button"
              onClick={onWithdraw}
              className="group inline-flex items-center gap-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowUpFromLine className="h-3 w-3" />
              <span className="border-b border-border/60 pb-0.5 group-hover:border-foreground transition-colors">
                Withdraw
              </span>
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={cn("h-3 w-3", isRefreshing && "animate-spin")}
          />
          <span>Refresh</span>
        </button>
      </div>
    </div>
  );
}
