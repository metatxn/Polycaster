import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { fetchMarket } from "@/lib/polymarket";

const log = createLogger("api.markets.closed-time");

/**
 * Polymarket condition IDs are hex strings, optionally 0x-prefixed.
 * Reject anything that could cause path traversal or URL manipulation.
 */
const CONDITION_ID_RE = /^(?:0x)?[a-fA-F0-9]{1,128}$/;
const EVENT_SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,200}$/;
const GAMMA_PAGE_SIZE = 500;
const GAMMA_MAX_PAGES = 5;
/** Per-request workload cap; callers with more ids must chunk. */
const MAX_CONDITION_IDS = 50;
// Keep below Workers' practical outbound-connection ceiling and leave one
// slot available for unrelated work in the same isolate.
const UPSTREAM_CONCURRENCY = 5;
const REQUEST_DEADLINE_MS = 12_000;

interface GammaClosedMarket {
  conditionId?: string;
  closedTime?: string;
}

interface GammaClosedEvent {
  slug?: string;
  closedTime?: string;
  markets?: GammaClosedMarket[];
}

interface ClobMarketTime {
  closedTime?: string;
  end_date_iso?: string;
  endDateIso?: string;
  endDate?: string;
}

function normalizeClosedTime(value?: string | null): string | null {
  if (!value) return null;
  const iso = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

async function settleWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await task(items[index]),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker)
  );
  return results;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("Upstream deadline exceeded", "AbortError");
  }
}

async function fetchGammaClosedTimes(
  conditionIds: string[],
  signal: AbortSignal
): Promise<{
  closedTimes: Record<string, string>;
  failed: boolean;
}> {
  const wanted = new Map(conditionIds.map((id) => [id.toLowerCase(), id]));
  const closedTimes: Record<string, string> = {};
  let failed = false;

  for (let page = 0; page < GAMMA_MAX_PAGES; page++) {
    if (signal.aborted) {
      failed = true;
      break;
    }

    const url = new URL(POLYMARKET_API.GAMMA.MARKETS);
    url.searchParams.set("closed", "true");
    url.searchParams.set("limit", GAMMA_PAGE_SIZE.toString());
    url.searchParams.set("offset", (page * GAMMA_PAGE_SIZE).toString());
    url.searchParams.set("order", "closedTime");
    url.searchParams.set("ascending", "false");

    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        log.warn("gamma.markets_page_non2xx", {
          page,
          status: response.status,
        });
        failed = true;
        break;
      }

      const markets = (await response.json()) as GammaClosedMarket[];
      for (const market of markets) {
        const originalId = market.conditionId
          ? wanted.get(market.conditionId.toLowerCase())
          : undefined;
        const closedTime = normalizeClosedTime(market.closedTime);
        if (originalId && closedTime) {
          closedTimes[originalId] = closedTime;
        }
      }

      if (
        Object.keys(closedTimes).length === conditionIds.length ||
        markets.length < GAMMA_PAGE_SIZE
      ) {
        break;
      }
    } catch (error) {
      log.warn("gamma.markets_page_failed", {
        page,
        error: error instanceof Error ? error.message : String(error),
      });
      failed = true;
      break;
    }
  }

  return { closedTimes, failed };
}

function readGammaEvents(data: unknown): GammaClosedEvent[] {
  if (Array.isArray(data)) return data as GammaClosedEvent[];
  if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { data?: unknown }).data)
  ) {
    return (data as { data: GammaClosedEvent[] }).data;
  }
  return data && typeof data === "object" ? [data as GammaClosedEvent] : [];
}

function pickGammaEventClosedTime(
  event: GammaClosedEvent,
  conditionId: string
): string | null {
  const conditionIdLower = conditionId.toLowerCase();
  const matchingMarket = event.markets?.find(
    (market) => market.conditionId?.toLowerCase() === conditionIdLower
  );

  return (
    normalizeClosedTime(matchingMarket?.closedTime) ||
    normalizeClosedTime(event.closedTime)
  );
}

async function fetchGammaEventClosedTimes(
  eventSlugsByConditionId: Map<string, string>,
  signal: AbortSignal
): Promise<{ closedTimes: Record<string, string>; failed: boolean }> {
  const closedTimes: Record<string, string> = {};
  let failed = false;
  const conditionIdsBySlug = new Map<string, string[]>();

  for (const [conditionId, slug] of eventSlugsByConditionId) {
    const conditionIds = conditionIdsBySlug.get(slug) ?? [];
    conditionIds.push(conditionId);
    conditionIdsBySlug.set(slug, conditionIds);
  }

  const settled = await settleWithConcurrency(
    [...conditionIdsBySlug],
    UPSTREAM_CONCURRENCY,
    async ([slug, conditionIds]) => {
      throwIfAborted(signal);
      const url = new URL(POLYMARKET_API.GAMMA.EVENTS);
      url.searchParams.set("slug", slug);

      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        log.warn("gamma.event_lookup_non2xx", {
          slug,
          status: response.status,
        });
        failed = true;
        return;
      }

      const events = readGammaEvents(await response.json());
      const event = events.find((item) => item.slug === slug) ?? events[0];
      if (!event) return;

      for (const conditionId of conditionIds) {
        const closedTime = pickGammaEventClosedTime(event, conditionId);
        if (closedTime) closedTimes[conditionId] = closedTime;
      }
    }
  );

  const rejected = settled.filter((result) => result.status === "rejected");
  if (rejected.length > 0) {
    log.warn("gamma.event_lookups_failed", {
      failedCount: rejected.length,
      totalCount: settled.length,
    });
    failed = true;
  }

  return { closedTimes, failed };
}

function pickFallbackMarketTime(data: ClobMarketTime | null): string | null {
  if (!data) return null;
  return (
    normalizeClosedTime(data.closedTime) ||
    data.end_date_iso ||
    data.endDateIso ||
    data.endDate ||
    null
  );
}

/**
 * GET /api/markets/closed-time?ids=conditionId1,conditionId2,...&slugs=eventSlug1,eventSlug2,...
 *
 * Returns the best available resolution/closed timestamp for each condition ID.
 * Gamma's `closedTime` is preferred so synthetic portfolio loss rows sort in
 * the same timeline position as Polymarket's history table. CLOB market end
 * dates remain a fallback for older or unindexed markets.
 */
/**
 * @openapi
 * /api/markets/closed-time:
 *   get:
 *     summary: Fetch /api/markets/closed-time.
 *     tags: [Markets]
 *     responses:
 *       200:
 *         description: Successful response.
 *       400:
 *         description: Invalid request.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Request forbidden.
 *       404:
 *         description: Resource not found.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Request failed.
 */
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json(
      { success: false, error: "Missing 'ids' query parameter" },
      { status: 400 }
    );
  }

  const requestedIds = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  // The workload cap protects the Worker; anything past it is reported as
  // truncated (and kept out of shared caches) instead of silently dropped.
  const conditionIds = requestedIds.slice(0, MAX_CONDITION_IDS);
  const truncated = requestedIds.length > MAX_CONDITION_IDS;

  if (conditionIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "No valid condition IDs provided" },
      { status: 400 }
    );
  }

  if (conditionIds.some((id) => !CONDITION_ID_RE.test(id))) {
    return NextResponse.json(
      { success: false, error: "Invalid condition ID format" },
      { status: 400 }
    );
  }

  const slugsParam = request.nextUrl.searchParams.get("slugs");
  const slugs = slugsParam
    ? slugsParam.split(",").map((slug) => slug.trim())
    : [];

  if (slugs.some((slug) => slug && !EVENT_SLUG_RE.test(slug))) {
    return NextResponse.json(
      { success: false, error: "Invalid event slug format" },
      { status: 400 }
    );
  }

  const eventSlugsByConditionId = new Map<string, string>();
  for (const [index, conditionId] of conditionIds.entries()) {
    const slug = slugs[index];
    if (slug) eventSlugsByConditionId.set(conditionId, slug);
  }

  const deadlineController = new AbortController();
  const deadlineId = setTimeout(
    () => deadlineController.abort(),
    REQUEST_DEADLINE_MS
  );
  const abortOnDisconnect = () => deadlineController.abort();
  if (request.signal.aborted) {
    deadlineController.abort();
  } else {
    request.signal.addEventListener("abort", abortOnDisconnect, { once: true });
  }

  try {
    const signal = deadlineController.signal;
    const gammaResult = await fetchGammaClosedTimes(conditionIds, signal);
    const closedTimes = gammaResult.closedTimes;
    const gammaMissingSlugs = new Map(
      [...eventSlugsByConditionId].filter(([id]) => !closedTimes[id])
    );
    const eventsResult = await fetchGammaEventClosedTimes(
      gammaMissingSlugs,
      signal
    );

    for (const [id, closedTime] of Object.entries(eventsResult.closedTimes)) {
      closedTimes[id] = closedTime;
    }

    const missingConditionIds = conditionIds.filter((id) => !closedTimes[id]);

    let fallbackFailed = signal.aborted;
    const results = await settleWithConcurrency(
      missingConditionIds,
      UPSTREAM_CONCURRENCY,
      async (id) => {
        if (signal.aborted) {
          fallbackFailed = true;
          throwIfAborted(signal);
        }
        const data = (await fetchMarket(id, signal).catch(() => {
          fallbackFailed = true;
          return null;
        })) as ClobMarketTime | null;
        return { id, date: pickFallbackMarketTime(data) };
      }
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.date) {
        closedTimes[result.value.id] = result.value.date;
      } else if (result.status === "rejected") {
        fallbackFailed = true;
      }
    }

    const unresolvedCount = conditionIds.filter(
      (id) => !closedTimes[id]
    ).length;
    const upstreamFailed =
      gammaResult.failed || eventsResult.failed || fallbackFailed;
    if (unresolvedCount > 0) {
      log.info("resolve.partial", {
        requested: conditionIds.length,
        unresolvedCount,
        upstreamFailed,
      });
    }

    // A missing closedTime is cacheable when every upstream answered (the
    // market genuinely has none), but not when an upstream failure may have
    // hidden it — caching that would pin an incomplete map for the TTL. A
    // truncated request is incomplete by construction, so it is never cached.
    // `partial` is surfaced in the body too: without it, an upstream outage is
    // indistinguishable from "this market has no closedTime" and clients would
    // pin fallback timestamps for the life of the page instead of retrying.
    const partial = unresolvedCount > 0 && upstreamFailed;
    const degraded = partial || truncated;
    if (truncated) {
      log.warn("resolve.truncated", {
        requested: requestedIds.length,
        processed: conditionIds.length,
      });
    }

    return NextResponse.json(
      {
        success: true,
        closedTimes,
        ...(partial ? { partial } : {}),
        ...(truncated ? { truncated } : {}),
      },
      {
        headers: degraded
          ? { "Cache-Control": "no-store" }
          : getCacheHeaders("events"),
      }
    );
  } finally {
    clearTimeout(deadlineId);
    request.signal.removeEventListener("abort", abortOnDisconnect);
  }
}
