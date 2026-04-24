import { AlertCircle, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NegRiskBadgeProps {
  iconOnly?: boolean;
  className?: string;
}

export function NegRiskBadge({
  iconOnly = false,
  className,
}: NegRiskBadgeProps) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        {iconOnly ? (
          <span
            className={cn(
              "inline-flex items-center justify-center h-8 w-8 border border-border/60 hover:bg-foreground/5 cursor-help text-foreground",
              className
            )}
          >
            <AlertCircle className="h-4 w-4" />
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted-foreground border border-border/60 cursor-help",
              className
            )}
          >
            Neg Risk
            <Info className="h-3 w-3" />
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs" side="top">
        <p className="text-sm">
          Neg risk (negative risk) is a market type that allows increased
          capital efficiency by letting you convert NO shares in one market into
          YES shares in all other markets within the same event.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
