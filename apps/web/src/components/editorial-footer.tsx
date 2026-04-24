/**
 * Shared editorial footer used across every pro page (/leaderboard,
 * /live, /portfolio, /profile, /whales…). Tagline left, wordmark +
 * context breadcrumb + year right.
 *
 * `context` defaults to "Polymarket" but pages like /live override it
 * with their own label (e.g. "Live Sports") so the breadcrumb lines up
 * with the page's subject.
 */
export function EditorialFooter({
  context = "Polymarket",
}: {
  context?: string;
}) {
  return (
    <footer className="relative z-10 border-t border-border/40 py-8 mt-12">
      <div className="px-3 sm:px-4 md:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="font-editorial italic text-sm sm:text-base text-muted-foreground">
          Every opinion is a position.
        </p>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="text-foreground font-semibold tracking-[0.18em]">
            Knoww
          </span>
          <span className="text-border/80">›</span>
          <span>{context}</span>
          <span className="text-border/80">·</span>
          <span className="tabular-nums">{new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  );
}
