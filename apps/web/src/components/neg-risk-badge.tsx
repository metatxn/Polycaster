import { AlertCircle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
              "inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground cursor-help text-rose-500",
              className
            )}
          >
            <AlertCircle className="h-4 w-4" />
          </span>
        ) : (
          <Badge
            variant="destructive"
            className={cn(
              "text-xs cursor-help flex items-center gap-1",
              className
            )}
          >
            Neg Risk
            <Info className="h-3 w-3" />
          </Badge>
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
