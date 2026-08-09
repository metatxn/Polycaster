import {
  IndexNowSubmissionError,
  type IndexNowSubmissionResult,
  isValidIndexNowKey,
  normalizeIndexNowUrls,
  submitIndexNow,
} from "./indexnow";

export const INDEXNOW_CRON_EXPRESSION = "0 * * * *";

const INDEXNOW_SITEMAP_INDEX_URL = "https://knoww.app/sitemap.xml";
// v2 intentionally starts a clean baseline after market-feed timestamps were
// removed from sitemap entries. Reusing v1 would submit every market once as
// an artificial lastmod-only update during deployment.
const INDEXNOW_SNAPSHOT_KEY = "indexnow:sitemap-snapshot:v2";
const INDEXNOW_RATE_LIMIT_KEY = "indexnow:rate-limit:v1";
const INDEXNOW_BATCH_SIZE = 10_000;
const MIN_RATE_LIMIT_DELAY_MS = 60 * 1000;
const DEFAULT_RATE_LIMIT_DELAY_MS = 12 * 60 * 60 * 1000;
const MAX_RATE_LIMIT_DELAY_MS = 48 * 60 * 60 * 1000;
const MAX_RATE_LIMIT_ATTEMPT = 8;
const MAX_RATE_LIMIT_STATE_BYTES = 1024;
const MAX_SITEMAP_SEGMENTS = 20;
const MAX_SITEMAP_URLS = 50_000;
const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_LAST_MODIFIED_LENGTH = 128;
const REQUEST_TIMEOUT_MS = 15_000;

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

type Submitter = (
  urls: readonly string[],
  key: string,
  fetcher?: Fetcher
) => Promise<IndexNowSubmissionResult>;

export interface IndexNowStateStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface IndexNowSnapshotEntry {
  url: string;
  lastModified: string | null;
}

export interface IndexNowSnapshot {
  version: 1;
  entries: IndexNowSnapshotEntry[];
}

export interface IndexNowSnapshotDiff {
  added: string[];
  updated: string[];
  removed: string[];
  changed: string[];
}

interface IndexNowRateLimitState {
  version: 1;
  attempt: number;
  retryAt: string;
}

export interface IndexNowCronResult {
  outcome: "baseline" | "unchanged" | "submitted" | "rate_limited" | "cooldown";
  discovered: number;
  added: number;
  updated: number;
  removed: number;
  submitted: number;
  batches: number;
  retryAt?: string;
}

interface RunIndexNowSitemapCronOptions {
  state: IndexNowStateStore;
  key: string | undefined;
  fetcher?: Fetcher;
  submit?: Submitter;
  now?: () => number;
}

export function shouldRunIndexNowCron(
  cron: string,
  enabled: string | undefined
): boolean {
  return enabled === "true" && cron === INDEXNOW_CRON_EXPRESSION;
}

export function diffIndexNowSitemapSnapshots(
  previous: IndexNowSnapshot,
  current: IndexNowSnapshot
): IndexNowSnapshotDiff {
  const previousEntries = new Map(
    previous.entries.map((entry) => [entry.url, entry.lastModified])
  );
  const currentEntries = new Map(
    current.entries.map((entry) => [entry.url, entry.lastModified])
  );

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const [url, lastModified] of currentEntries) {
    if (!previousEntries.has(url)) {
      added.push(url);
    } else if (previousEntries.get(url) !== lastModified) {
      updated.push(url);
    }
  }

  for (const url of previousEntries.keys()) {
    if (!currentEntries.has(url)) {
      removed.push(url);
    }
  }

  added.sort();
  updated.sort();
  removed.sort();

  return {
    added,
    updated,
    removed,
    changed: [...added, ...updated, ...removed].sort(),
  };
}

export async function runIndexNowSitemapCron({
  state,
  key,
  fetcher = fetch,
  submit = submitIndexNow,
  now = Date.now,
}: RunIndexNowSitemapCronOptions): Promise<IndexNowCronResult> {
  if (!isValidIndexNowKey(key)) {
    throw new Error("IndexNow key is unavailable or invalid");
  }

  const [serializedPrevious, serializedRateLimit] = await Promise.all([
    state.get(INDEXNOW_SNAPSHOT_KEY),
    state.get(INDEXNOW_RATE_LIMIT_KEY),
  ]);
  const previous = serializedPrevious
    ? parseStoredSnapshot(serializedPrevious)
    : null;
  const rateLimit = serializedRateLimit
    ? parseStoredRateLimit(serializedRateLimit)
    : null;
  if (rateLimit && Date.parse(rateLimit.retryAt) > now()) {
    return {
      ...buildResult("cooldown", previous?.entries.length ?? 0),
      retryAt: rateLimit.retryAt,
    };
  }

  const current = await fetchCurrentSitemapSnapshot(fetcher);
  const serializedCurrent = serializeSnapshot(current);

  if (!previous) {
    await state.put(INDEXNOW_SNAPSHOT_KEY, serializedCurrent);
    if (rateLimit) {
      await state.delete(INDEXNOW_RATE_LIMIT_KEY);
    }
    return buildResult("baseline", current.entries.length);
  }

  const diff = diffIndexNowSitemapSnapshots(previous, current);
  if (diff.changed.length === 0) {
    if (rateLimit) {
      await state.delete(INDEXNOW_RATE_LIMIT_KEY);
    }
    return buildResult("unchanged", current.entries.length);
  }

  const submitWithTimeout: Fetcher = (input, init) =>
    fetchWithTimeout(fetcher, input, init);
  let submitted = 0;
  let batches = 0;

  for (
    let offset = 0;
    offset < diff.changed.length;
    offset += INDEXNOW_BATCH_SIZE
  ) {
    const batch = diff.changed.slice(offset, offset + INDEXNOW_BATCH_SIZE);
    try {
      const result = await submit(batch, key, submitWithTimeout);
      submitted += result.submitted;
      batches += 1;
    } catch (error) {
      if (!(error instanceof IndexNowSubmissionError) || error.status !== 429) {
        throw error;
      }

      const nextRateLimit = buildRateLimitState(
        rateLimit,
        error.retryAfterMs,
        now()
      );
      await state.put(INDEXNOW_RATE_LIMIT_KEY, JSON.stringify(nextRateLimit));
      return {
        outcome: "rate_limited",
        discovered: current.entries.length,
        added: diff.added.length,
        updated: diff.updated.length,
        removed: diff.removed.length,
        submitted,
        batches,
        retryAt: nextRateLimit.retryAt,
      };
    }
  }

  await state.put(INDEXNOW_SNAPSHOT_KEY, serializedCurrent);
  if (rateLimit) {
    await state.delete(INDEXNOW_RATE_LIMIT_KEY);
  }

  return {
    outcome: "submitted",
    discovered: current.entries.length,
    added: diff.added.length,
    updated: diff.updated.length,
    removed: diff.removed.length,
    submitted,
    batches,
  };
}

function buildResult(
  outcome: "baseline" | "unchanged" | "cooldown",
  discovered: number
): IndexNowCronResult {
  return {
    outcome,
    discovered,
    added: 0,
    updated: 0,
    removed: 0,
    submitted: 0,
    batches: 0,
  };
}

function buildRateLimitState(
  previous: IndexNowRateLimitState | null,
  providerDelayMs: number | null,
  nowMs: number
): IndexNowRateLimitState {
  const attempt = Math.min(
    (previous?.attempt ?? 0) + 1,
    MAX_RATE_LIMIT_ATTEMPT
  );
  const fallbackDelayMs = Math.min(
    DEFAULT_RATE_LIMIT_DELAY_MS * 2 ** (attempt - 1),
    MAX_RATE_LIMIT_DELAY_MS
  );
  const requestedDelayMs =
    providerDelayMs !== null &&
    Number.isFinite(providerDelayMs) &&
    providerDelayMs >= 0
      ? providerDelayMs
      : fallbackDelayMs;
  const delayMs = Math.min(
    Math.max(requestedDelayMs, MIN_RATE_LIMIT_DELAY_MS),
    MAX_RATE_LIMIT_DELAY_MS
  );

  return {
    version: 1,
    attempt,
    retryAt: new Date(nowMs + delayMs).toISOString(),
  };
}

function parseStoredRateLimit(serialized: string): IndexNowRateLimitState {
  if (
    new TextEncoder().encode(serialized).byteLength > MAX_RATE_LIMIT_STATE_BYTES
  ) {
    throw new Error("IndexNow rate-limit state is malformed");
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("IndexNow rate-limit state is malformed");
  }

  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Number.isInteger(value.attempt) ||
    (value.attempt as number) < 1 ||
    (value.attempt as number) > MAX_RATE_LIMIT_ATTEMPT ||
    typeof value.retryAt !== "string"
  ) {
    throw new Error("IndexNow rate-limit state is malformed");
  }

  const retryAtMs = Date.parse(value.retryAt);
  if (
    Number.isNaN(retryAtMs) ||
    new Date(retryAtMs).toISOString() !== value.retryAt
  ) {
    throw new Error("IndexNow rate-limit state is malformed");
  }

  return {
    version: 1,
    attempt: value.attempt as number,
    retryAt: value.retryAt,
  };
}

async function fetchCurrentSitemapSnapshot(
  fetcher: Fetcher
): Promise<IndexNowSnapshot> {
  const indexXml = await fetchXml(fetcher, INDEXNOW_SITEMAP_INDEX_URL);
  const segmentUrls = parseSitemapIndex(indexXml);
  const segmentEntries = await Promise.all(
    segmentUrls.map(async (url) => parseUrlSet(await fetchXml(fetcher, url)))
  );
  const entriesByUrl = new Map<string, IndexNowSnapshotEntry>();

  for (const entry of segmentEntries.flat()) {
    if (entriesByUrl.has(entry.url)) {
      throw new Error("Sitemap contains a duplicate canonical URL");
    }
    entriesByUrl.set(entry.url, entry);
  }

  if (entriesByUrl.size === 0) {
    throw new Error("Sitemap contains no indexable URLs");
  }
  if (entriesByUrl.size > MAX_SITEMAP_URLS) {
    throw new Error("Sitemap URL limit exceeded");
  }

  return {
    version: 1,
    entries: [...entriesByUrl.values()].sort((left, right) =>
      left.url.localeCompare(right.url)
    ),
  };
}

async function fetchXml(fetcher: Fetcher, url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/xml, text/xml;q=0.9" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status !== 200) {
      throw new Error(`Sitemap request failed (${response.status})`);
    }

    const contentLength = response.headers.get("content-length");
    if (
      contentLength &&
      Number.isFinite(Number(contentLength)) &&
      Number(contentLength) > MAX_SITEMAP_BYTES
    ) {
      throw new Error("Sitemap response size limit exceeded");
    }

    return await readBoundedText(response);
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    bytesRead += value.byteLength;
    if (bytesRead > MAX_SITEMAP_BYTES) {
      await reader.cancel();
      throw new Error("Sitemap response size limit exceeded");
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

async function fetchWithTimeout(
  fetcher: Fetcher,
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseSitemapIndex(xml: string): string[] {
  assertSafeXml(xml, "sitemapindex");
  const segmentUrls = extractBlocks(xml, "sitemap").map((block) => {
    const rawUrl = extractRequiredTagText(block, "loc");
    if (rawUrl.length > MAX_URL_LENGTH || !isAllowedSegmentUrl(rawUrl)) {
      throw new Error("Sitemap index contains an invalid segment URL");
    }
    return rawUrl;
  });

  if (segmentUrls.length === 0) {
    throw new Error("Sitemap index contains no segments");
  }
  if (segmentUrls.length > MAX_SITEMAP_SEGMENTS) {
    throw new Error("Sitemap segment limit exceeded");
  }

  return [...new Set(segmentUrls)];
}

function parseUrlSet(xml: string): IndexNowSnapshotEntry[] {
  assertSafeXml(xml, "urlset");
  const blocks = extractBlocks(xml, "url");
  if (blocks.length > MAX_SITEMAP_URLS) {
    throw new Error("Sitemap URL limit exceeded");
  }

  return blocks.map((block) => {
    const rawUrl = extractRequiredTagText(block, "loc");
    if (rawUrl.length > MAX_URL_LENGTH) {
      throw new Error("Sitemap contains an invalid canonical URL");
    }

    let url: string;
    try {
      [url] = normalizeIndexNowUrls([rawUrl]);
    } catch {
      throw new Error("Sitemap contains an invalid canonical URL");
    }

    return {
      url,
      lastModified: normalizeLastModified(extractTagText(block, "lastmod")),
    };
  });
}

function assertSafeXml(xml: string, rootName: "sitemapindex" | "urlset"): void {
  if (
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    !new RegExp(`<${rootName}(?:\\s|>)`, "i").test(xml)
  ) {
    throw new Error("Sitemap XML is malformed");
  }
}

function extractBlocks(xml: string, tagName: "sitemap" | "url"): string[] {
  const pattern = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}\\s*>`,
    "gi"
  );
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? "");
}

function extractRequiredTagText(block: string, tagName: "loc"): string {
  const value = extractTagText(block, tagName);
  if (!value) {
    throw new Error("Sitemap XML is malformed");
  }
  return value;
}

function extractTagText(
  block: string,
  tagName: "loc" | "lastmod"
): string | null {
  const pattern = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}\\s*>`,
    "i"
  );
  const match = pattern.exec(block);
  if (!match) return null;

  return decodeXmlText(match[1] ?? "").trim();
}

function decodeXmlText(value: string): string {
  const decoded = value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        default: {
          const radix = entity[2]?.toLowerCase() === "x" ? 16 : 10;
          const start = radix === 16 ? 3 : 2;
          const codePoint = Number.parseInt(entity.slice(start, -1), radix);
          return Number.isSafeInteger(codePoint) &&
            codePoint >= 0 &&
            codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : "";
        }
      }
    }
  );

  if (decoded.includes("&") || decoded.includes("<") || decoded.includes(">")) {
    throw new Error("Sitemap XML text is malformed");
  }
  return decoded;
}

function isAllowedSegmentUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return (
    url.protocol === "https:" &&
    url.hostname === "knoww.app" &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/sitemaps\/[a-z0-9-]+\.xml$/.test(url.pathname)
  );
}

function normalizeLastModified(value: string | null): string | null {
  if (value === null || value === "") return null;
  if (value.length > MAX_LAST_MODIFIED_LENGTH) {
    throw new Error("Sitemap contains an invalid lastmod value");
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error("Sitemap contains an invalid lastmod value");
  }
  return new Date(timestamp).toISOString();
}

function parseStoredSnapshot(serialized: string): IndexNowSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("IndexNow snapshot is malformed");
  }

  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.entries)
  ) {
    throw new Error("IndexNow snapshot is malformed");
  }
  if (value.entries.length > MAX_SITEMAP_URLS) {
    throw new Error("IndexNow snapshot is malformed");
  }

  const seen = new Set<string>();
  const entries = value.entries.map((entry): IndexNowSnapshotEntry => {
    if (
      !isRecord(entry) ||
      typeof entry.url !== "string" ||
      (entry.lastModified !== null && typeof entry.lastModified !== "string")
    ) {
      throw new Error("IndexNow snapshot is malformed");
    }

    let url: string;
    try {
      [url] = normalizeIndexNowUrls([entry.url]);
    } catch {
      throw new Error("IndexNow snapshot is malformed");
    }
    if (
      url !== entry.url ||
      seen.has(url) ||
      normalizeLastModified(entry.lastModified) !== entry.lastModified
    ) {
      throw new Error("IndexNow snapshot is malformed");
    }
    seen.add(url);

    return { url, lastModified: entry.lastModified };
  });

  return { version: 1, entries };
}

function serializeSnapshot(snapshot: IndexNowSnapshot): string {
  const serialized = JSON.stringify(snapshot);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error("IndexNow snapshot size limit exceeded");
  }
  return serialized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
