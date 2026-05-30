"use client";

import { PullStat, TrendGlyph } from "@/components/pull-stat";
import { formatCurrency } from "@/lib/formatters";

interface PortfolioStatsCardProps {
  portfolioValue: number;
  openPositionsValue: number;
  positionCount: number | undefined;
  cashBalance: number;
  totalPnl: number;
  totalInvested: number;
  isPortfolioLoading: boolean;
  isPositionsLoading: boolean;
  isCashLoading: boolean;
  isPnlLoading: boolean;
}

export function PortfolioStatsCard({
  portfolioValue,
  openPositionsValue,
  positionCount,
  cashBalance,
  totalPnl,
  totalInvested,
  isPortfolioLoading,
  isPositionsLoading,
  isCashLoading,
  isPnlLoading,
}: PortfolioStatsCardProps) {
  const pnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 overflow-hidden h-full">
      <div className="grid grid-cols-2 divide-x divide-y divide-border/40 [&>*:nth-child(-n+2)]:border-t-0">
        <PullStat
          label="Portfolio Value"
          value={formatCurrency(portfolioValue)}
          caption="Cash + positions"
          isLoading={isPortfolioLoading}
        />
        <PullStat
          label="Open Positions"
          value={formatCurrency(openPositionsValue)}
          caption={positionCount ? `${positionCount} markets` : "—"}
          isLoading={isPositionsLoading}
        />
        <PullStat
          label="Cash Balance"
          value={formatCurrency(cashBalance)}
          caption="USDC available"
          isLoading={isCashLoading}
        />
        <PullStat
          label="Total P&L"
          emphasis
          value={formatCurrency(totalPnl)}
          caption={
            totalInvested > 0
              ? `${pnlPercent.toFixed(2)}% on cost`
              : "No cost basis yet"
          }
          valueClassName={
            totalPnl >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }
          mark={
            totalInvested > 0 ? (
              <TrendGlyph direction={totalPnl >= 0 ? "up" : "down"} />
            ) : undefined
          }
          isLoading={isPnlLoading}
        />
      </div>
    </div>
  );
}
