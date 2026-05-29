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
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        <Link
          href="/markets"
          className="flex items-center gap-1 hover:text-(--kwm-ink) transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Markets</span>
        </Link>
        <span className="text-(--kwm-ink-dim)">&rsaquo;</span>
        <span className="text-(--kwm-ink)">Portfolio</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap font-mono text-[11px] uppercase tracking-[0.14em]">
        {proxyAddress && (
          <button
            type="button"
            onClick={handleCopy}
            className="group inline-flex items-center gap-2 h-7 px-2.5 text-(--kwm-ink-3) hover:text-(--kwm-ink) transition-colors"
          >
            <span>{formatAddress(proxyAddress)}</span>
            {copied ? (
              <Check className="h-3 w-3 text-(--kwm-up)" />
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
              className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-(--kwm-ink) bg-(--kwm-ink) text-(--kwm-bg) font-semibold hover:brightness-110 transition-[filter,background]"
            >
              <ArrowDownToLine className="h-3 w-3" />
              <span>Deposit</span>
            </button>
            <button
              type="button"
              onClick={onWithdraw}
              className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-(--kwm-hl-2) bg-(--kwm-bg-2) text-(--kwm-ink) hover:border-(--kwm-hl-3) hover:bg-(--kwm-bg-3) transition-colors"
            >
              <ArrowUpFromLine className="h-3 w-3" />
              <span>Withdraw</span>
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 text-(--kwm-ink-3) hover:text-(--kwm-ink) transition-colors disabled:opacity-50"
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
