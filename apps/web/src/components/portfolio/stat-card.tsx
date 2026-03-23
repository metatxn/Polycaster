import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ElementType } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPercent } from "@/lib/formatters";

interface StatCardProps {
  label: string;
  value: string;
  isLoading?: boolean;
  valueClassName?: string;
  trend?: { value: number; isPositive: boolean };
  isHighlighted?: boolean;
  icon?: ElementType;
}

export function StatCard({
  label,
  value,
  isLoading,
  valueClassName,
  trend,
  isHighlighted = false,
  icon: Icon,
}: StatCardProps) {
  return (
    <div
      className={`rounded-xl p-4 border transition-all h-full flex flex-col justify-between ${
        isHighlighted
          ? "bg-linear-to-br from-primary/10 via-primary/5 to-background border-primary/20 shadow-xs"
          : "bg-card border-border shadow-xs"
      }`}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            {label}
          </p>
          {Icon && (
            <div
              className={`p-1.5 rounded-lg ${
                isHighlighted ? "bg-primary/10" : "bg-muted/50"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${
                  isHighlighted ? "text-primary" : "text-muted-foreground"
                }`}
              />
            </div>
          )}
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-7 w-24" />
            {trend && <Skeleton className="h-4 w-16" />}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p
              className={`text-xl sm:text-2xl font-black tabular-nums tracking-tight ${
                valueClassName || ""
              }`}
            >
              {value}
            </p>
            <div className="flex items-center h-5">
              {trend ? (
                <span
                  className={`text-[10px] font-bold flex items-center gap-0.5 px-1.5 py-0.5 rounded-md ${
                    trend.isPositive
                      ? "text-emerald-500 bg-emerald-500/10"
                      : "text-red-500 bg-red-500/10"
                  }`}
                >
                  {trend.isPositive ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {formatPercent(trend.value)}
                </span>
              ) : (
                <div className="h-5" /> // Spacer for symmetry
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
