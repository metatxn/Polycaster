import { createLogger } from "@knoww/logger";
import type { AgentEvidencePack, AgentWatchlistItem } from "./types.ts";

const log = createLogger("agent.search-tools");

export type AgentSearchProvider = "exa" | "tavily" | "firecrawl";
export type AgentWebSearchMode = "native" | "direct" | "both";

type AgentSearchResult = AgentEvidencePack["search"][number];
type AgentSearchResultKind = AgentSearchResult["kind"];
type AgentSearchDiagnostics = NonNullable<
  AgentEvidencePack["searchDiagnostics"]
>;

interface ProviderStatus {
  provider: AgentSearchProvider;
  ready: boolean;
  missing: string[];
}

export interface AgentSearchStatus {
  enabled: boolean;
  mode: AgentWebSearchMode;
  providers: ProviderStatus[];
}

export interface AgentSearchEvidenceCollection {
  results: AgentSearchResult[];
  diagnostics: AgentSearchDiagnostics;
}

const PROVIDERS: AgentSearchProvider[] = ["tavily", "exa", "firecrawl"];
const DEFAULT_SEARCH_TIMEOUT_MS = 5000;
const DEFAULT_SEARCH_MAX_RESULTS = 3;
const MAX_EXCERPT_CHARS = 800;

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function configuredWebSearchEnabled(): boolean {
  const raw = envValue("AGENT_LLM_WEB_SEARCH_ENABLED")?.toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  if (raw === "true" || raw === "1" || raw === "on") return true;
  return true;
}

export function configuredWebSearchMode(): AgentWebSearchMode {
  const raw = envValue("AGENT_LLM_WEB_SEARCH_MODE")?.toLowerCase();
  if (raw === "direct" || raw === "providers" || raw === "external") {
    return "direct";
  }
  if (raw === "both" || raw === "hybrid") return "both";
  return "native";
}

export function configuredDirectSearchEnabled(): boolean {
  if (!configuredWebSearchEnabled()) return false;
  const mode = configuredWebSearchMode();
  return mode === "direct" || mode === "both";
}

export function configuredNativeWebSearchEnabled(): boolean {
  if (!configuredWebSearchEnabled()) return false;
  const mode = configuredWebSearchMode();
  return mode === "native" || mode === "both";
}

function configuredMaxResults(): number {
  const configured = Number.parseInt(
    process.env.AGENT_SEARCH_MAX_RESULTS ?? "",
    10
  );
  return Number.isFinite(configured) && configured >= 1
    ? Math.min(configured, 10)
    : DEFAULT_SEARCH_MAX_RESULTS;
}

function configuredTimeoutMs(): number {
  const configured = Number.parseInt(
    process.env.AGENT_SEARCH_TIMEOUT_MS ?? "",
    10
  );
  return Number.isFinite(configured) && configured >= 1000
    ? configured
    : DEFAULT_SEARCH_TIMEOUT_MS;
}

function configuredProviders(): AgentSearchProvider[] {
  const raw = process.env.AGENT_SEARCH_PROVIDERS;
  if (raw !== undefined) {
    const selected = raw
      .split(",")
      .map((provider) => provider.trim().toLowerCase())
      .filter((provider): provider is AgentSearchProvider =>
        PROVIDERS.includes(provider as AgentSearchProvider)
      );
    return [...new Set(selected)];
  }
  return PROVIDERS.filter((provider) => apiKeyForProvider(provider));
}

function apiKeyName(provider: AgentSearchProvider): string {
  if (provider === "exa") return "EXA_API_KEY";
  if (provider === "tavily") return "TAVILY_API_KEY";
  return "FIRECRAWL_API_KEY";
}

function apiKeyForProvider(provider: AgentSearchProvider): string | undefined {
  return envValue(apiKeyName(provider));
}

function providerStatus(provider: AgentSearchProvider): ProviderStatus {
  const missing = apiKeyForProvider(provider) ? [] : [apiKeyName(provider)];
  return {
    provider,
    ready: missing.length === 0,
    missing,
  };
}

export function getAgentSearchStatus(): AgentSearchStatus {
  const providers = configuredProviders().map(providerStatus);
  return {
    enabled: configuredDirectSearchEnabled() && providers.length > 0,
    mode: configuredWebSearchMode(),
    providers,
  };
}

function cleanText(value: unknown, maxChars = MAX_EXCERPT_CHARS): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxChars)
    : "";
}

function finiteScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function classifySearchResult(
  provider: AgentSearchProvider,
  url: string
): AgentSearchResultKind {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return provider === "tavily" ? "news" : "web";
  }
  if (
    host === "polymarket.com" ||
    host.endsWith(".polymarket.com") ||
    url.includes("/event/")
  ) {
    return "resolution";
  }
  if (
    host === "x.com" ||
    host === "twitter.com" ||
    host.endsWith(".x.com") ||
    host.endsWith(".twitter.com")
  ) {
    return "social";
  }
  return provider === "tavily" ? "news" : "web";
}

function resultBase(
  provider: AgentSearchProvider,
  query: string,
  row: Record<string, unknown>
): AgentSearchResult | null {
  const url = cleanText(row.url, 500);
  if (!url) return null;
  const title = cleanText(row.title, 180) || url;
  const fetchedAt = new Date().toISOString();
  return {
    provider,
    kind: classifySearchResult(provider, url),
    query,
    url,
    title,
    excerpt: "",
    publishedAt: cleanText(row.publishedDate ?? row.published_at, 80) || null,
    fetchedAt,
    score: finiteScore(row.score),
  };
}

function normalizeTavily(
  data: unknown,
  query: string,
  limit: number
): AgentSearchResult[] {
  const results =
    data &&
    typeof data === "object" &&
    Array.isArray((data as { results?: unknown }).results)
      ? (data as { results: unknown[] }).results
      : [];
  return results
    .slice(0, limit)
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const base = resultBase("tavily", query, row as Record<string, unknown>);
      if (!base) return null;
      return {
        ...base,
        excerpt: cleanText((row as Record<string, unknown>).content),
      };
    })
    .filter((result): result is AgentSearchResult => !!result);
}

function normalizeExa(
  data: unknown,
  query: string,
  limit: number
): AgentSearchResult[] {
  const results =
    data &&
    typeof data === "object" &&
    Array.isArray((data as { results?: unknown }).results)
      ? (data as { results: unknown[] }).results
      : [];
  return results
    .slice(0, limit)
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const obj = row as Record<string, unknown>;
      const base = resultBase("exa", query, obj);
      if (!base) return null;
      const highlights = Array.isArray(obj.highlights)
        ? obj.highlights.map((entry) => cleanText(entry, 300)).filter(Boolean)
        : [];
      return {
        ...base,
        excerpt: highlights.join(" [...] ") || cleanText(obj.text),
      };
    })
    .filter((result): result is AgentSearchResult => !!result);
}

function normalizeFirecrawl(
  data: unknown,
  query: string,
  limit: number
): AgentSearchResult[] {
  const webResults =
    data &&
    typeof data === "object" &&
    (data as { data?: unknown }).data &&
    typeof (data as { data?: unknown }).data === "object" &&
    Array.isArray((data as { data: { web?: unknown } }).data.web)
      ? (data as { data: { web: unknown[] } }).data.web
      : [];
  return webResults
    .slice(0, limit)
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const obj = row as Record<string, unknown>;
      const base = resultBase("firecrawl", query, obj);
      if (!base) return null;
      return {
        ...base,
        excerpt:
          cleanText(obj.description) ||
          cleanText(obj.markdown) ||
          cleanText(obj.content),
      };
    })
    .filter((result): result is AgentSearchResult => !!result);
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildSearchQuery(item: AgentWatchlistItem): string {
  const parts = [
    item.question,
    item.outcomeLabel ? `outcome ${item.outcomeLabel}` : "",
    item.marketSlug ? `Polymarket ${item.marketSlug}` : "Polymarket",
  ].filter(Boolean);
  return parts.join(" ");
}

async function searchProvider(
  provider: AgentSearchProvider,
  query: string,
  limit: number,
  timeoutMs: number
): Promise<AgentSearchResult[]> {
  const apiKey = apiKeyForProvider(provider);
  if (!apiKey) return [];
  if (provider === "tavily") {
    const data = await fetchJson(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          max_results: limit,
          search_depth: "basic",
          topic: "news",
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        }),
      },
      timeoutMs
    );
    return normalizeTavily(data, query, limit);
  }
  if (provider === "exa") {
    const data = await fetchJson(
      "https://api.exa.ai/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          query,
          type: "auto",
          numResults: limit,
          contents: {
            highlights: true,
          },
        }),
      },
      timeoutMs
    );
    return normalizeExa(data, query, limit);
  }
  const data = await fetchJson(
    "https://api.firecrawl.dev/v2/search",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit,
        sources: [{ type: "web" }],
        scrapeOptions: {
          formats: ["markdown"],
          onlyMainContent: true,
        },
      }),
    },
    timeoutMs
  );
  return normalizeFirecrawl(data, query, limit);
}

export async function collectSearchEvidence(
  item: AgentWatchlistItem
): Promise<AgentSearchResult[]> {
  return (await collectSearchEvidenceWithDiagnostics(item)).results;
}

export async function collectSearchEvidenceWithDiagnostics(
  item: AgentWatchlistItem
): Promise<AgentSearchEvidenceCollection> {
  const query = buildSearchQuery(item);
  const limit = configuredMaxResults();
  const timeoutMs = configuredTimeoutMs();
  const mode = configuredWebSearchMode();
  const directEnabled = configuredDirectSearchEnabled();
  const selectedProviders = configuredProviders();
  const diagnostics: AgentSearchDiagnostics = {
    enabled: directEnabled && selectedProviders.length > 0,
    mode,
    query: directEnabled ? query : null,
    maxResults: limit,
    timeoutMs,
    providers: [],
  };

  if (!directEnabled) {
    log.info("direct_search.skipped", { mode, reason: "disabled" });
    return { results: [], diagnostics };
  }

  if (selectedProviders.length === 0) {
    log.warn("direct_search.skipped", { mode, reason: "no_providers" });
    return { results: [], diagnostics };
  }

  const readyProviders = selectedProviders.filter((provider) => {
    const ready = Boolean(apiKeyForProvider(provider));
    if (!ready) {
      diagnostics.providers.push({
        provider,
        ready: false,
        status: "missing-key",
        durationMs: 0,
        resultCount: 0,
        errorMessage: `${apiKeyName(provider)} is not configured`,
      });
    }
    return ready;
  });

  if (readyProviders.length === 0) {
    log.warn("direct_search.skipped", {
      mode,
      query,
      providers: selectedProviders,
      reason: "missing_keys",
    });
    return { results: [], diagnostics };
  }

  log.info("direct_search.started", {
    mode,
    query,
    providers: readyProviders,
    maxResults: limit,
    timeoutMs,
  });

  const settled = await Promise.allSettled(
    readyProviders.map(async (provider) => {
      const startedAt = Date.now();
      const results = await searchProvider(provider, query, limit, timeoutMs);
      return { provider, results, durationMs: Date.now() - startedAt };
    })
  );
  const results = settled.flatMap((result, index) => {
    const provider = readyProviders[index];
    if (result.status === "fulfilled") {
      diagnostics.providers.push({
        provider: result.value.provider,
        ready: true,
        status: "ok",
        durationMs: result.value.durationMs,
        resultCount: result.value.results.length,
      });
      log.info("direct_search.provider.completed", {
        provider: result.value.provider,
        durationMs: result.value.durationMs,
        resultCount: result.value.results.length,
      });
      return result.value.results;
    }
    const errorMessage =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    diagnostics.providers.push({
      provider,
      ready: true,
      status: "failed",
      durationMs: 0,
      resultCount: 0,
      errorMessage,
    });
    log.warn("provider.search.failed", {
      provider,
      error: result.reason,
    });
    return [];
  });
  log.info("direct_search.completed", {
    mode,
    query,
    providers: readyProviders,
    resultCount: results.length,
    evidenceCount: results.length,
  });
  return { results, diagnostics };
}
