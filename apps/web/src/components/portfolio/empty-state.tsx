import { TrendingUp } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { EmptyStateProps } from "./types";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 sm:py-16 text-center px-4">
      <div className="relative">
        <div className="absolute inset-0 bg-linear-to-r from-violet-500/20 to-fuchsia-500/20 blur-2xl rounded-full" />
        <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-linear-to-br from-muted to-muted/50 flex items-center justify-center mb-4">
          <Icon className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground" />
        </div>
      </div>
      <h3 className="text-base sm:text-lg font-semibold mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-xs mb-4">
        {description}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        {action && (
          <Button
            asChild
            size="sm"
            className="bg-linear-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
          >
            <Link href={action.href}>
              <TrendingUp className="h-4 w-4 mr-1.5" />
              {action.label}
            </Link>
          </Button>
        )}
        {secondaryAction && (
          <Button asChild variant="outline" size="sm">
            <Link href={secondaryAction.href}>{secondaryAction.label}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
