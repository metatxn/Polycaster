import { z } from "zod";
import type { WebMcpTool } from "@/lib/webmcp";

export type MarketsViewMode = "categories" | "trending" | "breaking" | "new";
export type MarketsVolumeWindow = "24h" | "1wk" | "1mo" | "1yr";
export type MarketsStatus = "active" | "live" | "ended";
export type MarketsEndWithin = "all" | "24h" | "7d" | "30d" | "custom";

export interface MarketsWebMcpEvent {
  id: string;
  slug?: string;
  title: string;
  active: boolean;
  closed: boolean;
  live: boolean;
  ended: boolean;
  volume?: string | number;
  volume24hr?: string | number;
  liquidity?: string | number;
  marketCount: number;
  topOutcome?: {
    name: string;
    price: number;
  };
}

export interface MarketsWebMcpSnapshot {
  viewMode: MarketsViewMode;
  filters: {
    volume24hr: number | null;
    volumeWeekly: number | null;
    volumeWindow: MarketsVolumeWindow;
    liquidity: number | null;
    status: MarketsStatus[];
    tagSlug: string | null;
    endWithin: MarketsEndWithin;
  };
  pagination: {
    loadedCount: number;
    hasMore: boolean;
    isLoading: boolean;
    isLoadingMore: boolean;
  };
  events: MarketsWebMcpEvent[];
  dataUpdatedAt?: string;
  observedAt: string;
}

export interface MarketsWebMcpFilterUpdate {
  viewMode?: MarketsViewMode;
  volume24hr?: number | null;
  volumeWeekly?: number | null;
  volumeWindow?: MarketsVolumeWindow;
  liquidity?: number | null;
  status?: MarketsStatus[];
  tagSlug?: string | null;
  endWithin?: Exclude<MarketsEndWithin, "custom">;
}

export interface MarketsWebMcpSearchResult {
  events: MarketsWebMcpEvent[];
  totalResults: number;
  hasMore: boolean;
}

export interface MarketsWebMcpDependencies {
  getSnapshot: () => MarketsWebMcpSnapshot | null;
  applyFilters: (update: MarketsWebMcpFilterUpdate) => void;
  resetFilters: () => void;
  openEvent: (path: string) => void;
  loadMore: () => Promise<{
    beforeCount: number;
    afterCount: number;
    hasMore: boolean;
  }>;
  searchEvents: (
    query: string,
    limit: number,
    tagSlug?: string
  ) => Promise<MarketsWebMcpSearchResult>;
}

const MAX_FILTER_AMOUNT = 1_000_000_000;
const viewModes = ["categories", "trending", "breaking", "new"] as const;
const volumeWindows = ["24h", "1wk", "1mo", "1yr"] as const;
const statuses = ["active", "live", "ended"] as const;
const endWithinValues = ["all", "24h", "7d", "30d"] as const;
const tagSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const amountSchema = z.number().finite().min(0).max(MAX_FILTER_AMOUNT);
const emptyInputSchema = z.object({}).strict();
const contextInputSchema = z
  .object({
    limit: z.number().int().min(1).max(20).default(20),
  })
  .strict();
const searchInputSchema = z
  .object({
    query: z.string().trim().min(2).max(100),
    limit: z.number().int().min(1).max(10).default(5),
    tag_slug: tagSlugSchema.nullable().optional(),
  })
  .strict();
const filtersInputSchema = z
  .object({
    view: z.enum(viewModes).optional(),
    minimum_volume_24h: amountSchema.nullable().optional(),
    minimum_volume_7d: amountSchema.nullable().optional(),
    minimum_liquidity: amountSchema.nullable().optional(),
    volume_window: z.enum(volumeWindows).optional(),
    status: z
      .array(z.enum(statuses))
      .min(1)
      .max(statuses.length)
      .refine((value) => new Set(value).size === value.length)
      .optional(),
    tag_slug: tagSlugSchema.nullable().optional(),
    end_within: z.enum(endWithinValues).optional(),
    reset: z.boolean().optional(),
  })
  .strict();
const openEventInputSchema = z
  .object({ event_id: z.string().trim().min(1).max(256) })
  .strict();

function invalidInput(message: string): never {
  throw new Error(message);
}

function requireSnapshot(
  getSnapshot: MarketsWebMcpDependencies["getSnapshot"]
): MarketsWebMcpSnapshot {
  const snapshot = getSnapshot();
  if (!snapshot) throw new Error("Markets page context is not ready");
  return snapshot;
}

function getEventPath(event: MarketsWebMcpEvent): string {
  return `/events/detail/${encodeURIComponent(event.slug || event.id)}`;
}

function toPublicEvent(event: MarketsWebMcpEvent) {
  return {
    event_id: event.id,
    ...(event.slug ? { event_slug: event.slug } : {}),
    title: event.title,
    status: {
      active: event.active,
      closed: event.closed,
      live: event.live,
      ended: event.ended,
    },
    ...(event.volume !== undefined ? { volume: event.volume } : {}),
    ...(event.volume24hr !== undefined ? { volume_24h: event.volume24hr } : {}),
    ...(event.liquidity !== undefined ? { liquidity: event.liquidity } : {}),
    market_count: event.marketCount,
    ...(event.topOutcome ? { top_outcome: event.topOutcome } : {}),
    path: getEventPath(event),
  };
}

function hasOwn(value: object, key: string): boolean {
  return Object.hasOwn(value, key);
}

export function createMarketsWebMcpTools({
  getSnapshot,
  applyFilters,
  resetFilters,
  openEvent,
  loadMore,
  searchEvents,
}: MarketsWebMcpDependencies): WebMcpTool[] {
  let latestSearchEvents = new Map<string, MarketsWebMcpEvent>();

  return [
    {
      name: "get_markets_page_context",
      description:
        "Read the current Knoww markets-page view, active filters, pagination state, and up to 20 loaded public events.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 20, default: 20 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const parsed = contextInputSchema.safeParse(rawInput);
        if (!parsed.success) invalidInput("Invalid markets-page context input");

        const snapshot = requireSnapshot(getSnapshot);
        return {
          view: snapshot.viewMode,
          filters: {
            minimum_volume_24h: snapshot.filters.volume24hr,
            minimum_volume_7d: snapshot.filters.volumeWeekly,
            minimum_liquidity: snapshot.filters.liquidity,
            volume_window: snapshot.filters.volumeWindow,
            status: snapshot.filters.status,
            tag_slug: snapshot.filters.tagSlug,
            end_within: snapshot.filters.endWithin,
          },
          pagination: {
            loaded_count: snapshot.pagination.loadedCount,
            has_more: snapshot.pagination.hasMore,
            is_loading: snapshot.pagination.isLoading,
            is_loading_more: snapshot.pagination.isLoadingMore,
          },
          events: snapshot.events
            .slice(0, parsed.data.limit)
            .map(toPublicEvent),
          truncated: snapshot.events.length > parsed.data.limit,
          ...(snapshot.dataUpdatedAt
            ? { data_updated_at: snapshot.dataUpdatedAt }
            : {}),
          observed_at: snapshot.observedAt,
        };
      },
    },
    {
      name: "search_events",
      description:
        "Search public Knoww events by a 2-to-100 character query. Uses the active tag filter unless tag_slug is provided; pass null to search all tags.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 2, maxLength: 100 },
          limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
          tag_slug: {
            anyOf: [
              {
                type: "string",
                minLength: 1,
                maxLength: 100,
                pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
              },
              { type: "null" },
            ],
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const parsed = searchInputSchema.safeParse(rawInput);
        if (!parsed.success) invalidInput("Invalid event search");

        const snapshot = requireSnapshot(getSnapshot);
        const effectiveTagSlug =
          parsed.data.tag_slug === undefined
            ? snapshot.filters.tagSlug
            : parsed.data.tag_slug;

        try {
          const result = await searchEvents(
            parsed.data.query,
            parsed.data.limit,
            effectiveTagSlug ?? undefined
          );
          const boundedEvents = result.events.slice(0, parsed.data.limit);
          latestSearchEvents = new Map(
            boundedEvents.map((event) => [event.id, event])
          );

          return {
            query: parsed.data.query,
            tag_slug: effectiveTagSlug,
            total_results: result.totalResults,
            has_more: result.hasMore,
            events: boundedEvents.map(toPublicEvent),
            observed_at: new Date().toISOString(),
          };
        } catch {
          throw new Error("Event search is temporarily unavailable");
        }
      },
    },
    {
      name: "set_market_filters",
      description:
        "Change the visible Knoww markets view and supported filters. This only updates the current page and does not trade, connect a wallet, or change an account.",
      inputSchema: {
        type: "object",
        properties: {
          view: { type: "string", enum: viewModes },
          minimum_volume_24h: {
            type: ["number", "null"],
            minimum: 0,
            maximum: MAX_FILTER_AMOUNT,
          },
          minimum_volume_7d: {
            type: ["number", "null"],
            minimum: 0,
            maximum: MAX_FILTER_AMOUNT,
          },
          minimum_liquidity: {
            type: ["number", "null"],
            minimum: 0,
            maximum: MAX_FILTER_AMOUNT,
          },
          volume_window: { type: "string", enum: volumeWindows },
          status: {
            type: "array",
            items: { type: "string", enum: statuses },
            minItems: 1,
            maxItems: statuses.length,
            uniqueItems: true,
          },
          tag_slug: {
            anyOf: [
              {
                type: "string",
                minLength: 1,
                maxLength: 100,
                pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
              },
              { type: "null" },
            ],
          },
          end_within: { type: "string", enum: endWithinValues },
          reset: { type: "boolean" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (rawInput) => {
        const parsed = filtersInputSchema.safeParse(rawInput);
        if (!parsed.success) invalidInput("Market filter values are invalid");

        const suppliedKeys = Object.keys(parsed.data);
        const filterKeys = suppliedKeys.filter((key) => key !== "reset");
        if (filterKeys.length === 0 && parsed.data.reset !== true) {
          invalidInput("At least one market filter is required");
        }
        if (parsed.data.reset === true && filterKeys.length > 0) {
          invalidInput("reset cannot be combined with other filters");
        }
        if (parsed.data.reset === true) {
          resetFilters();
          return { changed: true, reset: true };
        }

        const update: MarketsWebMcpFilterUpdate = {};
        const applied: Record<string, unknown> = {};
        if (hasOwn(parsed.data, "view")) {
          update.viewMode = parsed.data.view;
          applied.view = parsed.data.view;
        }
        if (hasOwn(parsed.data, "minimum_volume_24h")) {
          update.volume24hr = parsed.data.minimum_volume_24h;
          applied.minimum_volume_24h = parsed.data.minimum_volume_24h;
        }
        if (hasOwn(parsed.data, "minimum_volume_7d")) {
          update.volumeWeekly = parsed.data.minimum_volume_7d;
          applied.minimum_volume_7d = parsed.data.minimum_volume_7d;
        }
        if (hasOwn(parsed.data, "minimum_liquidity")) {
          update.liquidity = parsed.data.minimum_liquidity;
          applied.minimum_liquidity = parsed.data.minimum_liquidity;
        }
        if (hasOwn(parsed.data, "volume_window")) {
          update.volumeWindow = parsed.data.volume_window;
          applied.volume_window = parsed.data.volume_window;
        }
        if (hasOwn(parsed.data, "status")) {
          update.status = parsed.data.status;
          applied.status = parsed.data.status;
        }
        if (hasOwn(parsed.data, "tag_slug")) {
          update.tagSlug = parsed.data.tag_slug;
          applied.tag_slug = parsed.data.tag_slug;
        }
        if (hasOwn(parsed.data, "end_within")) {
          update.endWithin = parsed.data.end_within;
          applied.end_within = parsed.data.end_within;
        }

        applyFilters(update);
        return { changed: true, reset: false, applied };
      },
    },
    {
      name: "open_event",
      description:
        "Open an event that is present in the current markets page or the latest search_events results. Arbitrary URLs are not accepted.",
      inputSchema: {
        type: "object",
        properties: {
          event_id: { type: "string", minLength: 1, maxLength: 256 },
        },
        required: ["event_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (rawInput) => {
        const parsed = openEventInputSchema.safeParse(rawInput);
        if (!parsed.success) invalidInput("Invalid event selection");

        const snapshot = requireSnapshot(getSnapshot);
        const event =
          snapshot.events.find(({ id }) => id === parsed.data.event_id) ??
          latestSearchEvents.get(parsed.data.event_id);
        if (!event) throw new Error("Event is not available from this page");

        const path = getEventPath(event);
        openEvent(path);
        return {
          opened: true,
          event_id: event.id,
          title: event.title,
          path,
        };
      },
    },
    {
      name: "load_more_markets",
      description:
        "Load at most one additional page of events into the current Knoww markets view when more results are available.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (rawInput) => {
        if (!emptyInputSchema.safeParse(rawInput).success) {
          invalidInput("Invalid load-more input");
        }

        const snapshot = requireSnapshot(getSnapshot);
        if (!snapshot.pagination.hasMore) {
          return {
            requested: false,
            loaded: false,
            before_count: snapshot.pagination.loadedCount,
            after_count: snapshot.pagination.loadedCount,
            has_more: false,
            reason: "No more markets are available",
          };
        }
        if (
          snapshot.pagination.isLoading ||
          snapshot.pagination.isLoadingMore
        ) {
          return {
            requested: false,
            loaded: false,
            before_count: snapshot.pagination.loadedCount,
            after_count: snapshot.pagination.loadedCount,
            has_more: snapshot.pagination.hasMore,
            reason: "Markets are already loading",
          };
        }

        try {
          const result = await loadMore();
          return {
            requested: true,
            loaded: result.afterCount > result.beforeCount,
            before_count: result.beforeCount,
            after_count: result.afterCount,
            has_more: result.hasMore,
          };
        } catch {
          throw new Error("Unable to load more markets");
        }
      },
    },
  ];
}
