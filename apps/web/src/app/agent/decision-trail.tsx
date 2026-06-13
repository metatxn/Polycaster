"use client";

export function EvidenceUsed({
  news,
  search,
  social,
}: {
  news: Array<{ url: string; title: string }>;
  search: Array<{
    provider: "tavily" | "exa" | "firecrawl";
    kind: "news" | "resolution" | "social" | "web";
    query: string;
    url: string;
    title: string;
    excerpt: string;
    publishedAt: string | null;
    score: number | null;
  }>;
  social: Array<{
    text: string;
    source?: "watchlist-note" | "polymarket-rule" | "polymarket-description";
  }>;
}) {
  const newsLikeSearch = search.filter((entry) => entry.kind === "news");
  const total = news.length + search.length + social.length;
  if (total === 0) return null;
  return (
    <details className="mt-3 border-y border-(--kwm-hl-2) py-2">
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
        Evidence used · {total} ({social.length} social,{" "}
        {news.length + newsLikeSearch.length} news, {search.length} search)
      </summary>
      <div className="mt-2 space-y-2 text-xs">
        {social.map((entry, index) => (
          <div
            key={`social-${index}`}
            className="border-l-2 border-(--kwm-hl-2) pl-2"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              {entry.source ?? "watchlist-note"}
            </div>
            <div className="mt-0.5 text-(--kwm-ink-3) line-clamp-4">
              {entry.text}
            </div>
          </div>
        ))}
        {search.map((entry, index) => (
          <div
            key={`search-${entry.provider}-${index}`}
            className="border-l-2 border-(--kwm-hl-2) pl-2"
          >
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              <span>
                {entry.provider} · {entry.kind}
              </span>
              {entry.publishedAt && (
                <span>{new Date(entry.publishedAt).toLocaleDateString()}</span>
              )}
              {typeof entry.score === "number" && (
                <span>score {entry.score.toFixed(2)}</span>
              )}
            </div>
            <a
              className="mt-0.5 block underline-offset-2 hover:underline"
              href={entry.url}
              rel="noreferrer"
              target="_blank"
            >
              {entry.title || entry.url}
            </a>
            {entry.excerpt && (
              <p className="mt-1 line-clamp-3 text-(--kwm-ink-3)">
                {entry.excerpt}
              </p>
            )}
          </div>
        ))}
        {news.map((entry, index) => (
          <div
            key={`news-${index}`}
            className="border-l-2 border-(--kwm-hl-2) pl-2"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              news
            </div>
            <a
              className="mt-0.5 block underline-offset-2 hover:underline"
              href={entry.url}
              rel="noreferrer"
              target="_blank"
            >
              {entry.title || entry.url}
            </a>
          </div>
        ))}
      </div>
    </details>
  );
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SearchDiagnostics({
  diagnostics,
  search,
}: {
  diagnostics?: {
    enabled: boolean;
    mode: "native" | "direct" | "both";
    query: string | null;
    maxResults: number;
    timeoutMs: number;
    providers: Array<{
      provider: "tavily" | "exa" | "firecrawl";
      ready: boolean;
      status: "ok" | "missing-key" | "failed" | "skipped";
      durationMs: number;
      resultCount: number;
      errorMessage?: string;
    }>;
  };
  search: Array<{
    provider: "tavily" | "exa" | "firecrawl";
    kind: "news" | "resolution" | "social" | "web";
    query: string;
    url: string;
    title: string;
  }>;
}) {
  if (!diagnostics && search.length === 0) return null;
  const query = diagnostics?.query ?? search[0]?.query ?? null;
  const providers = diagnostics?.providers ?? [];
  return (
    <details className="mt-3 border-y border-(--kwm-hl-2) py-2">
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
        Search debug · {diagnostics?.mode ?? "unknown"} · {search.length}{" "}
        evidence results
      </summary>
      <div className="mt-2 space-y-2 text-xs">
        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              Mode
            </div>
            <div>{diagnostics?.mode ?? "unknown"}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              Enabled
            </div>
            <div>{diagnostics?.enabled ? "yes" : "no"}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              Max results
            </div>
            <div>{diagnostics?.maxResults ?? "unknown"}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              Timeout
            </div>
            <div>{diagnostics ? `${diagnostics.timeoutMs}ms` : "unknown"}</div>
          </div>
        </div>
        {query && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              Query
            </div>
            <div className="mt-0.5 wrap-break-word text-(--kwm-ink-3)">
              {query}
            </div>
          </div>
        )}
        {providers.length > 0 && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              Providers
            </div>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {providers.map((entry) => (
                <div
                  key={entry.provider}
                  className="border border-(--kwm-hl-2) px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
                      {entry.provider}
                    </span>
                    <span className="text-(--kwm-ink-3)">{entry.status}</span>
                  </div>
                  <div className="mt-1 text-(--kwm-ink-3)">
                    {entry.resultCount} results · {entry.durationMs}ms
                  </div>
                  {entry.errorMessage && (
                    <div className="mt-1 line-clamp-2 text-(--kwm-ink-3)">
                      {entry.errorMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {search.length > 0 && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              Evidence results
            </div>
            <div className="mt-1 space-y-1">
              {search.map((entry, index) => (
                <div
                  key={`${entry.provider}-${entry.url}-${index}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-(--kwm-ink-3)"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
                    {entry.provider} · {entry.kind}
                  </span>
                  <span>{domainFromUrl(entry.url)}</span>
                  <span className="truncate">{entry.title || entry.url}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

export function ResolutionBadge({
  resolution,
}: {
  resolution: { outcomeYes: 0 | 1; settlementPrice: string };
}) {
  const won = resolution.outcomeYes === 1;
  return (
    <span
      className={`font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-1 border ${
        won
          ? "border-emerald-600/70 text-(--kwm-up) dark:text-(--kwm-up)"
          : "border-rose-600/70 text-rose-700 dark:text-rose-400"
      }`}
    >
      Resolved {won ? "Yes" : "No"} @ {resolution.settlementPrice}
    </span>
  );
}

export function VoteCorrectness({
  fairProbability,
  outcomeYes,
}: {
  fairProbability: number;
  outcomeYes: 0 | 1;
}) {
  // Direction match: model said YES (fair > 0.5) and YES won, or model said
  // NO (fair < 0.5) and NO won. fair == 0.5 is undecided.
  const predictedYes = fairProbability > 0.5;
  const predictedNo = fairProbability < 0.5;
  if (!predictedYes && !predictedNo) {
    return (
      <span
        role="img"
        aria-label="undecided"
        className="inline-block h-2 w-2 rounded-full bg-(--kwm-ink-3)"
        title={`fair ${fairProbability.toFixed(2)} vs outcome ${outcomeYes}`}
      />
    );
  }
  const matched =
    (predictedYes && outcomeYes === 1) || (predictedNo && outcomeYes === 0);
  return (
    <span
      role="img"
      aria-label={matched ? "direction correct" : "direction wrong"}
      className={`inline-block h-2 w-2 rounded-full ${
        matched ? "bg-emerald-600" : "bg-rose-600"
      }`}
      title={`fair ${fairProbability.toFixed(2)} vs outcome ${outcomeYes}${
        matched ? " · matched" : " · missed"
      }`}
    />
  );
}

export function EdgeChip({ pct }: { pct: number }) {
  const rounded = Math.round(pct * 10) / 10;
  const tone =
    Math.abs(pct) < 1
      ? "text-(--kwm-ink-3) border-(--kwm-hl-2)"
      : pct > 0
        ? "text-(--kwm-up) border-emerald-700/40"
        : "text-(--kwm-down) border-red-700/40";
  const sign = pct > 0 ? "+" : "";
  return (
    <span
      className={`shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${tone}`}
    >
      Edge {sign}
      {rounded}pp
    </span>
  );
}

export function EvidenceList({
  label,
  items,
  tone,
}: {
  label: string;
  items?: string[];
  tone: "positive" | "negative" | "missing";
}) {
  if (!items || items.length === 0) return null;
  const toneClass =
    tone === "positive"
      ? "border-emerald-700/40"
      : tone === "negative"
        ? "border-red-700/40"
        : "border-amber-600/50 bg-amber-50/40 dark:bg-amber-950/20";
  return (
    <details className={`mt-2 border-l-2 pl-2 ${toneClass}`}>
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
        {label} · {items.length}
      </summary>
      <ul className="mt-1 list-disc pl-4 text-[11px] text-(--kwm-ink-3) space-y-0.5">
        {items.map((entry, index) => (
          <li key={`${label}-${index}`}>{entry}</li>
        ))}
      </ul>
    </details>
  );
}

export function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <dt className="font-mono uppercase tracking-widest">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}

export function DebugBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono uppercase tracking-widest">{label}</dt>
      <dd className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap wrap-break-word border border-(--kwm-hl-2) p-2">
        {value}
      </dd>
    </div>
  );
}

export function RelatedMarkets({
  markets,
}: {
  markets: Array<{
    question: string;
    outcomeLabel: string;
    marketType: "binary" | "multi_outcome" | "unknown";
    eventType: "single_market" | "multi_market" | "unknown";
    eventEndTime?: string;
    price: string | null;
    selected: boolean;
  }>;
}) {
  if (markets.length === 0) return null;
  return (
    <div className="mt-3 border-y border-(--kwm-hl-2) py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
        Related market context · {markets.length}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        {markets.map((market, index) => (
          <div
            className="border border-(--kwm-hl-2) p-2 text-xs"
            key={`${market.question}-${market.outcomeLabel}-${index}`}
          >
            <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              <span>{market.selected ? "Selected" : market.eventType}</span>
              <span>{market.price ?? "n/a"}</span>
            </div>
            <div className="mt-1 line-clamp-2">{market.question}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              {market.outcomeLabel} · {market.marketType}
              {market.eventEndTime
                ? ` · ${new Date(market.eventEndTime).toLocaleDateString()}`
                : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
