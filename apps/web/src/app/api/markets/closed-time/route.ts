import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { fetchMarket } from "@/lib/polymarket";

/**
 * Polymarket condition IDs are hex strings, optionally 0x-prefixed.
 * Reject anything that could cause path traversal or URL manipulation.
 */
const CONDITION_ID_RE = /^(?:0x)?[a-fA-F0-9]{1,128}$/;
const EVENT_SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,200}$/;
const GAMMA_PAGE_SIZE = 500;
const GAMMA_MAX_PAGES = 5;

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

async function fetchGammaClosedTimes(
  conditionIds: string[]
): Promise<Record<string, string>> {
  const wanted = new Map(conditionIds.map((id) => [id.toLowerCase(), id]));
  const closedTimes: Record<string, string> = {};

  for (let page = 0; page < GAMMA_MAX_PAGES; page++) {
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
      });
      if (!response.ok) break;

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
    } catch {
      break;
    }
  }

  return closedTimes;
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
  eventSlugsByConditionId: Map<string, string>
): Promise<Record<string, string>> {
  const closedTimes: Record<string, string> = {};
  const conditionIdsBySlug = new Map<string, string[]>();

  for (const [conditionId, slug] of eventSlugsByConditionId) {
    const conditionIds = conditionIdsBySlug.get(slug) ?? [];
    conditionIds.push(conditionId);
    conditionIdsBySlug.set(slug, conditionIds);
  }

  await Promise.allSettled(
    [...conditionIdsBySlug].map(async ([slug, conditionIds]) => {
      const url = new URL(POLYMARKET_API.GAMMA.EVENTS);
      url.searchParams.set("slug", slug);

      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return;

      const events = readGammaEvents(await response.json());
      const event = events.find((item) => item.slug === slug) ?? events[0];
      if (!event) return;

      for (const conditionId of conditionIds) {
        const closedTime = pickGammaEventClosedTime(event, conditionId);
        if (closedTime) closedTimes[conditionId] = closedTime;
      }
    })
  );

  return closedTimes;
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

  const conditionIds = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 50);

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

  const closedTimes = await fetchGammaClosedTimes(conditionIds);
  const gammaMissingSlugs = new Map(
    [...eventSlugsByConditionId].filter(([id]) => !closedTimes[id])
  );
  const gammaEventClosedTimes =
    await fetchGammaEventClosedTimes(gammaMissingSlugs);

  for (const [id, closedTime] of Object.entries(gammaEventClosedTimes)) {
    closedTimes[id] = closedTime;
  }

  const missingConditionIds = conditionIds.filter((id) => !closedTimes[id]);

  const results = await Promise.allSettled(
    missingConditionIds.map(async (id) => {
      const data = (await fetchMarket(id).catch(
        () => null
      )) as ClobMarketTime | null;
      return { id, date: pickFallbackMarketTime(data) };
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.date) {
      closedTimes[result.value.id] = result.value.date;
    }
  }

  return NextResponse.json(
    { success: true, closedTimes },
    { headers: getCacheHeaders("events") }
  );
}
