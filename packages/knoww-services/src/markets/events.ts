import { z } from "zod";
import { UpstreamEventError } from "../errors";
import {
  type ServiceFetchOptions,
  withUpstreamTimeout,
} from "../fetch-options";
import { gammaTimestampSchema, nonNegativeDecimalSchema } from "../validation";
import { type GammaMarketDetail, gammaMarketDetailSchema } from "./detail";
import { GAMMA_API_BASE } from "./search";

const EVENT_UPSTREAM_TIMEOUT_MS = 8500;
const CHILD_EVENTS_LIMIT = 50;

export interface ChildEventsResult {
  events: GammaEventDetail[];
  truncated: boolean;
}

export type EventIdentifier =
  | { kind: "id"; value: string }
  | { kind: "slug"; value: string };

export interface GammaEventDetail {
  id: string;
  title?: string;
  slug?: string;
  description?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  negRisk?: boolean;
  startDate?: string;
  endDate?: string;
  creationDate?: string;
  volume?: string | number;
  volume24hr?: string | number;
  liquidity?: string | number;
  tags?: { id?: string; label?: string; slug?: string }[];
  markets?: GammaMarketDetail[];
}

const gammaEventDetailSchema: z.ZodType<GammaEventDetail> = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    slug: z.string().optional(),
    description: z.string().optional(),
    active: z.boolean().optional(),
    closed: z.boolean().optional(),
    archived: z.boolean().optional(),
    negRisk: z.boolean().optional(),
    startDate: gammaTimestampSchema.optional(),
    endDate: gammaTimestampSchema.optional(),
    creationDate: gammaTimestampSchema.optional(),
    volume: nonNegativeDecimalSchema.optional(),
    volume24hr: nonNegativeDecimalSchema.optional(),
    liquidity: nonNegativeDecimalSchema.optional(),
    tags: z
      .array(
        z
          .object({
            id: z.string().optional(),
            label: z.string().optional(),
            slug: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    markets: z.array(gammaMarketDetailSchema).optional(),
  })
  .passthrough();

function requestInit(signal: AbortSignal): RequestInit {
  return {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  };
}

/**
 * Looks up a single event. /events/{id} and /events/slug/{slug} return one
 * object, not an array. Gamma answers 422 for malformed slugs, so on a slug
 * lookup that status means not found; on an id lookup it stays an upstream
 * error because ids we send are already digit-only.
 */
export async function fetchEventByIdentifier(
  identifier: EventIdentifier,
  options?: ServiceFetchOptions
): Promise<GammaEventDetail | null> {
  const path =
    identifier.kind === "id"
      ? `/events/${encodeURIComponent(identifier.value)}`
      : `/events/slug/${encodeURIComponent(identifier.value)}`;

  return withUpstreamTimeout(
    options,
    EVENT_UPSTREAM_TIMEOUT_MS,
    async (fetchImpl, signal) => {
      const response = await fetchImpl(
        `${GAMMA_API_BASE}${path}`,
        requestInit(signal)
      );
      if (response.status === 404) {
        return null;
      }
      if (response.status === 422 && identifier.kind === "slug") {
        return null;
      }
      if (!response.ok) {
        throw new UpstreamEventError(
          `Gamma event lookup failed with status ${response.status}`,
          response.status
        );
      }
      const payload: unknown = await response.json();
      if (payload === null || payload === undefined) {
        return null;
      }
      const parsed = gammaEventDetailSchema.safeParse(payload);
      if (!parsed.success) {
        throw new UpstreamEventError("Gamma event payload was malformed");
      }
      return parsed.data;
    }
  );
}

/**
 * Fetches the open child events of a negRisk parent. Best-effort at the call
 * site: callers tolerate a throw and degrade instead of failing the lookup.
 */
export async function fetchChildEvents(
  parentEventId: string,
  options?: ServiceFetchOptions
): Promise<ChildEventsResult> {
  const url = new URL(`${GAMMA_API_BASE}/events`);
  url.searchParams.set("parent_event_id", parentEventId);
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", String(CHILD_EVENTS_LIMIT + 1));

  return withUpstreamTimeout(
    options,
    EVENT_UPSTREAM_TIMEOUT_MS,
    async (fetchImpl, signal) => {
      const response = await fetchImpl(url.toString(), requestInit(signal));
      if (!response.ok) {
        throw new UpstreamEventError(
          `Gamma child event lookup failed with status ${response.status}`,
          response.status
        );
      }
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        throw new UpstreamEventError(
          "Gamma child event payload was not an array"
        );
      }
      const parsed = z.array(gammaEventDetailSchema).safeParse(payload);
      if (!parsed.success) {
        throw new UpstreamEventError(
          "Gamma child event payload contained malformed data"
        );
      }
      return {
        events: parsed.data.slice(0, CHILD_EVENTS_LIMIT),
        truncated: parsed.data.length > CHILD_EVENTS_LIMIT,
      };
    }
  );
}

/**
 * Fallback for event payloads that arrive without an embedded markets array:
 * pulls the event's open markets directly from /markets.
 */
export async function fetchOpenMarketsByEventSlug(
  slug: string,
  options?: ServiceFetchOptions
): Promise<GammaMarketDetail[]> {
  const url = new URL(`${GAMMA_API_BASE}/markets`);
  url.searchParams.set("events_slug", slug);
  url.searchParams.set("closed", "false");

  return withUpstreamTimeout(
    options,
    EVENT_UPSTREAM_TIMEOUT_MS,
    async (fetchImpl, signal) => {
      const response = await fetchImpl(url.toString(), requestInit(signal));
      if (!response.ok) {
        throw new UpstreamEventError(
          `Gamma event market lookup failed with status ${response.status}`,
          response.status
        );
      }
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        throw new UpstreamEventError(
          "Gamma event market payload was not an array"
        );
      }
      const parsed = z.array(gammaMarketDetailSchema).safeParse(payload);
      if (!parsed.success) {
        throw new UpstreamEventError(
          "Gamma event market payload contained malformed data"
        );
      }
      return parsed.data;
    }
  );
}
