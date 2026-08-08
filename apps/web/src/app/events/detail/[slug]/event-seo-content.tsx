import Link from "next/link";
import { formatVolume } from "@/lib/formatters";
import { buildEventDetailPath, getEventSeoStatus } from "@/lib/seo";
import type { GammaEventFull, InitialEvent } from "@/lib/server-cache";
import type { EventCategoryCrumb } from "@/lib/tag-slugs";

interface EventSeoContentProps {
  event: GammaEventFull;
  category: EventCategoryCrumb | null;
  relatedEvents: InitialEvent[];
}

interface MarketSummary {
  label: string;
  probability: number;
  oneDayPriceChange?: number;
  endDate?: string;
  resolutionSource?: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE_FORMAT.format(date);
}

function parseJsonStringArray(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Reduce the event's markets to the single outcome traders currently rank
 * highest. Prices come from Gamma's `outcomePrices` (already verified data —
 * no estimates), so a missing/unparseable price simply drops that market.
 */
function findLeadingOutcome(event: GammaEventFull): MarketSummary | null {
  const markets = event.markets ?? [];
  const closed = getEventSeoStatus(event) !== "live";
  const candidates = closed
    ? markets
    : markets.filter((m) => m.active !== false && m.closed !== true);
  const scope = candidates.length > 0 ? candidates : markets;

  let best: MarketSummary | null = null;
  for (const market of scope) {
    const prices = parseJsonStringArray(market.outcomePrices).map(Number);
    const yesPrice = prices[0];
    if (!Number.isFinite(yesPrice) || yesPrice < 0 || yesPrice > 1) {
      continue;
    }

    // Single binary market: the proposition is the event question itself,
    // and the tracked probability is always the Yes side. Multi-outcome
    // events label the leader by its bucket title (candidate, team, range).
    const isBinaryEvent = markets.length === 1;
    let label = market.groupItemTitle || market.question || event.title;
    let probability = yesPrice;
    let oneDayPriceChange = market.oneDayPriceChange;
    if (isBinaryEvent) {
      const outcomes = parseJsonStringArray(market.outcomes);
      const yesIndex = yesPrice >= 0.5 ? 0 : 1;
      label = outcomes[yesIndex] || (yesIndex === 0 ? "Yes" : "No");
      probability = yesIndex === 0 ? yesPrice : 1 - yesPrice;
      if (yesIndex === 1 && oneDayPriceChange !== undefined) {
        oneDayPriceChange = -oneDayPriceChange;
      }
    }

    if (!best || probability > best.probability) {
      best = {
        label,
        probability,
        oneDayPriceChange,
        endDate: market.endDate,
        resolutionSource: market.resolutionSource,
      };
    }
  }
  return best;
}

function formatProbability(probability: number): string {
  const pct = Math.round(probability * 100);
  if (pct <= 0) {
    return "<1%";
  }
  if (pct >= 100 && probability < 1) {
    return ">99%";
  }
  return `${pct}%`;
}

/**
 * Crawlable, server-rendered event context (SEO audit §4): market snapshot,
 * rules, data source, and related internal links. Every figure is taken
 * verbatim from the Gamma payload that already rendered the page — no
 * estimated or fabricated values. The client shell renders this node at the
 * bottom of its <main>, so it ships in the SSR HTML.
 */
export function EventSeoContent({
  event,
  category,
  relatedEvents,
}: EventSeoContentProps) {
  const status = getEventSeoStatus(event);
  const closed = status !== "live";
  const resolved = status === "resolved";
  const leading = findLeadingOutcome(event);
  const marketCount = event.markets?.length ?? 0;
  const volume = event.volume ? formatVolume(event.volume) : null;
  const liquidity = event.liquidity ? formatVolume(event.liquidity) : null;
  const resolutionDate = formatDate(leading?.endDate || event.endDate);
  const updatedDate = formatDate(event.updatedAt);
  const description = event.description?.trim();
  const isBinaryEvent = marketCount === 1;

  if (!leading && !description && relatedEvents.length === 0) {
    return null;
  }

  const movementPoints = leading?.oneDayPriceChange
    ? Math.round(Math.abs(leading.oneDayPriceChange) * 100)
    : 0;
  const movementDirection =
    leading?.oneDayPriceChange && leading.oneDayPriceChange < 0 ? "down" : "up";

  const snapshotSentences: string[] = [];
  if (leading) {
    const pct = formatProbability(leading.probability);
    if (closed) {
      snapshotSentences.push(
        resolved
          ? isBinaryEvent
            ? `This market is resolved. ${leading.label} was the final outcome after closing at a ${pct} probability.`
            : `This market is resolved. ${leading.label} was the final outcome after finishing with a closing probability of ${pct}.`
          : isBinaryEvent
            ? `Trading on this market has ended, but settlement is still pending. The final recorded probability for ${leading.label} was ${pct}.`
            : `Trading on this market has ended, but settlement is still pending. ${leading.label} finished as the leading outcome at a closing probability of ${pct}.`
      );
    } else {
      snapshotSentences.push(
        isBinaryEvent
          ? `Traders currently assign a ${pct} probability to ${leading.label} on this market. This is the live price of the leading outcome, and it moves as traders buy and sell.`
          : `Traders currently see ${leading.label} as the leading outcome, at a ${pct} probability across ${marketCount} listed outcomes.`
      );
      if (movementPoints >= 1) {
        snapshotSentences.push(
          `Over the past 24 hours, the leading outcome's probability has moved ${movementDirection} ${movementPoints} percentage point${movementPoints === 1 ? "" : "s"}.`
        );
      }
    }
    if (volume) {
      snapshotSentences.push(
        closed
          ? `The market traded approximately ${volume} in total volume.`
          : `The market has traded approximately ${volume} in volume as of the latest update.`
      );
    }
    if (!closed && resolutionDate) {
      snapshotSentences.push(
        `It is scheduled to resolve by ${resolutionDate}.`
      );
    }
  }

  const facts: Array<{ term: string; value: string }> = [];
  facts.push({
    term: "Status",
    value: resolved ? "Resolved" : closed ? "Trading closed" : "Live trading",
  });
  if (leading) {
    facts.push({
      term: resolved
        ? "Final outcome"
        : closed
          ? "Final leading outcome"
          : "Leading outcome",
      value: `${leading.label} (${formatProbability(leading.probability)})`,
    });
  }
  if (volume) {
    facts.push({ term: "Volume", value: volume });
  }
  if (!closed && liquidity) {
    facts.push({ term: "Liquidity", value: liquidity });
  }
  if (resolutionDate) {
    facts.push({ term: "Resolution date", value: resolutionDate });
  }
  if (marketCount > 1) {
    facts.push({ term: "Outcomes", value: String(marketCount) });
  }
  if (updatedDate) {
    facts.push({ term: "Last updated", value: updatedDate });
  }

  return (
    <section
      aria-labelledby="event-seo-heading"
      className="mt-10 border-t border-border/40 pt-8 text-sm leading-6 text-muted-foreground"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] mb-3">
        § Market context
      </p>
      <h2
        id="event-seo-heading"
        className="text-lg font-semibold tracking-tight text-foreground mb-4"
      >
        About this market
      </h2>

      {snapshotSentences.length > 0 && (
        <p className="max-w-3xl mb-5">{snapshotSentences.join(" ")}</p>
      )}

      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 max-w-3xl mb-6">
          {facts.map((fact) => (
            <div key={fact.term}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.15em]">
                {fact.term}
              </dt>
              <dd className="mt-0.5 text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {description && (
        <div className="max-w-3xl mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-2">
            Rules and resolution
          </h3>
          <p className="whitespace-pre-line">{description}</p>
          {leading?.resolutionSource && (
            <p className="mt-2">
              Resolution source:{" "}
              <a
                href={leading.resolutionSource}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                {leading.resolutionSource}
              </a>
            </p>
          )}
        </div>
      )}

      <div className="max-w-3xl mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          Data source and freshness
        </h3>
        <p>
          Odds, volume, and liquidity come from live Polymarket order books.
          {resolved
            ? " Trading and settlement have ended, so the figures above reflect the resolved market state."
            : closed
              ? " Trading has ended, so the figures above reflect the final trading state while settlement remains pending."
              : " Prices update continuously while trading is open; the figures above reflect the most recent refresh."}{" "}
          Probabilities are market prices — what traders collectively pay for a
          $1 payout if the outcome occurs — not editorial forecasts.
        </p>
      </div>

      {(relatedEvents.length > 0 || category) && (
        <div className="max-w-3xl">
          <h3 className="text-sm font-semibold text-foreground mb-2">
            Related markets
          </h3>
          {relatedEvents.length > 0 && (
            <ul className="list-disc pl-5 space-y-1 mb-2">
              {relatedEvents.map((related) => (
                <li key={related.slug}>
                  <Link
                    href={buildEventDetailPath(related.slug)}
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                  >
                    {related.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {category && (
            <p>
              <Link
                href={`/events/${category.slug}`}
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Browse all {category.label.toLowerCase()} prediction markets
              </Link>
            </p>
          )}
        </div>
      )}

      <p className="max-w-3xl mt-6 text-xs text-muted-foreground/80">
        Prediction-market prices can move quickly and past probabilities do not
        guarantee outcomes. Nothing on this page is financial advice.
      </p>
    </section>
  );
}
