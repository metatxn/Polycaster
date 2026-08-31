import { createLogger } from "@knoww/logger";
import { knownMcpToolName } from "./tool-catalog";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const ALLOWED_POSTHOG_HOSTS = new Set([
  "https://us.i.posthog.com",
  "https://eu.i.posthog.com",
]);
const encoder = new TextEncoder();
const log = createLogger("mcp.analytics");

export const MCP_ANALYTICS_EVENTS = {
  httpRequestCompleted: "mcp_http_request_completed",
  protocolRequestCompleted: "mcp_protocol_request_completed",
  toolCalled: "mcp_tool_called",
} as const;

export type McpAnalyticsEvent =
  (typeof MCP_ANALYTICS_EVENTS)[keyof typeof MCP_ANALYTICS_EVENTS];
export type McpAnalyticsProperties = Record<
  string,
  string | number | boolean | undefined
>;

interface QueuedEvent {
  event: McpAnalyticsEvent;
  identity?: string;
  properties: McpAnalyticsProperties;
}

export interface McpAnalytics {
  capture(
    event: McpAnalyticsEvent,
    properties: McpAnalyticsProperties,
    identity?: string
  ): void;
  flush(): void;
}

interface CreateMcpAnalyticsOptions {
  projectApiKey?: string;
  host?: string;
  fetchImpl?: typeof fetch;
  waitUntil?: (task: Promise<unknown>) => void;
}

export interface McpProtocolProperties {
  protocol_method: string;
  tool_name?: string;
  client_family?: string;
}

const PUBLIC_ROUTES = new Set([
  "/healthz",
  "/readyz",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
  "/authorize",
  "/auth/google/callback",
  "/oauth/token",
  "/oauth/register",
  "/mcp",
]);

const PROTOCOL_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "notifications/cancelled",
  "ping",
  "server/discover",
  "tools/list",
  "tools/call",
  "resources/list",
  "prompts/list",
]);

function normalizedPostHogHost(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/u, "");
  return trimmed && ALLOWED_POSTHOG_HOSTS.has(trimmed)
    ? trimmed
    : DEFAULT_POSTHOG_HOST;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function clientFamily(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("claude")) return "claude";
  if (normalized.includes("chatgpt")) return "chatgpt";
  if (normalized.includes("cursor")) return "cursor";
  if (normalized.includes("inspector")) return "mcp-inspector";
  return "other";
}

function parseProtocolMessage(value: unknown): McpProtocolProperties | null {
  const message = record(value);
  if (!message || typeof message.method !== "string") return null;
  const protocolMethod = PROTOCOL_METHODS.has(message.method)
    ? message.method
    : "other";
  const properties: McpProtocolProperties = {
    protocol_method: protocolMethod,
  };
  const params = record(message.params);
  if (protocolMethod === "tools/call") {
    const toolName = knownMcpToolName(params?.name);
    if (toolName) properties.tool_name = toolName;
  }
  if (protocolMethod === "initialize") {
    const clientInfo = record(params?.clientInfo);
    const family = clientFamily(clientInfo?.name);
    if (family) properties.client_family = family;
  }
  if (protocolMethod === "server/discover") {
    const meta = record(params?._meta);
    const clientInfo = record(meta?.["io.modelcontextprotocol/clientInfo"]);
    const family = clientFamily(clientInfo?.name);
    if (family) properties.client_family = family;
  }
  return properties;
}

export function parseMcpProtocolMessages(
  value: unknown
): McpProtocolProperties[] {
  const messages = Array.isArray(value) ? value : [value];
  return messages.flatMap((message) => {
    const parsed = parseProtocolMessage(message);
    return parsed ? [parsed] : [];
  });
}

export function mcpRoute(pathname: string): string {
  return PUBLIC_ROUTES.has(pathname) ? pathname : "other";
}

async function distinctId(identity: string | undefined): Promise<string> {
  if (!identity) return "mcp_anonymous";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`knoww-mcp:${identity}`)
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `mcp_${hex}`;
}

function definedProperties(
  properties: McpAnalyticsProperties
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(properties).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined
    )
  );
}

export function createMcpAnalytics(
  options: CreateMcpAnalyticsOptions
): McpAnalytics {
  const projectApiKey = options.projectApiKey?.trim();
  const host = normalizedPostHogHost(options.host);
  const fetchImpl = options.fetchImpl ?? fetch;
  const waitUntil = options.waitUntil ?? (() => undefined);
  const queue: QueuedEvent[] = [];
  let flushed = false;

  return {
    capture(event, properties, identity) {
      if (!projectApiKey || flushed) return;
      queue.push({ event, properties, identity });
    },
    flush() {
      if (!projectApiKey || flushed || queue.length === 0) return;
      flushed = true;
      const events = queue.splice(0);
      const delivery = Promise.all(
        events.map(async ({ event, identity, properties }) => ({
          event,
          properties: {
            ...definedProperties(properties),
            distinct_id: await distinctId(identity),
            product: "mcp",
            service: "knoww-mcp",
            $process_person_profile: false,
          },
        }))
      )
        .then((batch) =>
          fetchImpl(`${host}/batch/`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ api_key: projectApiKey, batch }),
          })
        )
        .then((response) => {
          if (!response.ok) {
            log.warn("delivery.failed", { status: response.status });
          }
        })
        .catch((error: unknown) => {
          log.warn("delivery.failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
        });
      waitUntil(delivery);
    },
  };
}
