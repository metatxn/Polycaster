import Link from "next/link";
import type { EmptyStateProps } from "./types";

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="py-12 sm:py-16 px-4 max-w-md">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
        {title}
      </p>
      <p className="font-editorial italic text-xl leading-snug text-foreground mb-6">
        {description}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {action && (
          <Link
            href={action.href}
            className="group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground transition-colors hover:text-muted-foreground"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="underline underline-offset-4 decoration-border group-hover:decoration-foreground transition-colors">
              {action.label}
            </span>
          </Link>
        )}
        {secondaryAction && (
          <Link
            href={secondaryAction.href}
            className="group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="underline underline-offset-4 decoration-border group-hover:decoration-foreground transition-colors">
              {secondaryAction.label}
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
