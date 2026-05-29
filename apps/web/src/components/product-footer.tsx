/**
 * Product footer — DeFi/financial counterpart to `EditorialFooter`. Used
 * across product pages (/leaderboard, /portfolio, /whales, /search,
 * /events, /profile, etc) wrapped in `.kw-app`.
 *
 * Compact mono row — no editorial italic pull quote. Wordmark + context
 * + year on one line.
 */
export function ProductFooter({
  context = "Polymarket",
}: {
  context?: string;
}) {
  return (
    <footer
      className="relative z-10 mt-10 py-5 border-t"
      style={{ borderColor: "var(--kwm-hl)" }}
    >
      <div
        className="px-3 sm:px-4 md:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.14em]"
        style={{ color: "var(--kwm-ink-3)" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="font-semibold tracking-[0.18em]"
            style={{ color: "var(--kwm-ink)" }}
          >
            Knoww
          </span>
          <span style={{ color: "var(--kwm-hl-2)" }}>›</span>
          <span>{context}</span>
        </div>
        <span className="tabular-nums">{new Date().getFullYear()}</span>
      </div>
    </footer>
  );
}
