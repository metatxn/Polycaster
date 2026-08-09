const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_HOST = "knoww.app";
const INDEXNOW_KEY_LOCATION = `https://${INDEXNOW_HOST}/indexnow-key.txt`;
const INDEXNOW_MAX_URLS = 10_000;
const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const NON_INDEXABLE_PREFIXES = ["/api", "/_next"];
const NON_INDEXABLE_PATHS = new Set([
  "/indexnow-key.txt",
  "/robots.txt",
  "/sitemap.xml",
]);
const STATIC_ASSET_EXTENSION =
  /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|txt|webp|xml|woff2?)$/i;

export interface IndexNowPayload {
  host: typeof INDEXNOW_HOST;
  key: string;
  keyLocation: typeof INDEXNOW_KEY_LOCATION;
  urlList: string[];
}

export interface IndexNowSubmissionResult {
  status: number;
  submitted: number;
}

type FetchIndexNow = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export function parseIndexNowCliUrls(args: readonly string[]): string[] {
  return args[0] === "--" ? args.slice(1) : [...args];
}

export function isValidIndexNowKey(key: string | undefined): key is string {
  return typeof key === "string" && INDEXNOW_KEY_PATTERN.test(key.trim());
}

function normalizeIndexNowUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid IndexNow URL");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== INDEXNOW_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Non-canonical IndexNow URL");
  }

  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const lowerPathname = pathname.toLowerCase();
  const isNonIndexablePrefix = NON_INDEXABLE_PREFIXES.some(
    (prefix) =>
      lowerPathname === prefix || lowerPathname.startsWith(`${prefix}/`)
  );

  if (
    isNonIndexablePrefix ||
    NON_INDEXABLE_PATHS.has(lowerPathname) ||
    lowerPathname.startsWith("/sitemaps/") ||
    STATIC_ASSET_EXTENSION.test(lowerPathname)
  ) {
    throw new Error("Non-indexable IndexNow URL");
  }

  return `https://${INDEXNOW_HOST}${pathname}`;
}

export function normalizeIndexNowUrls(values: readonly string[]): string[] {
  if (values.length === 0) {
    throw new Error("At least one IndexNow URL is required");
  }

  return [...new Set(values.map(normalizeIndexNowUrl))];
}

/**
 * Build the official IndexNow batch payload.
 * Source: https://www.indexnow.org/documentation#submit-a-set-of-urls
 */
export function buildIndexNowPayload(
  urls: readonly string[],
  key: string
): IndexNowPayload {
  const normalizedKey = key.trim();
  if (!isValidIndexNowKey(normalizedKey)) {
    throw new Error("IndexNow key must be 8-128 letters, numbers, or dashes");
  }

  const urlList = normalizeIndexNowUrls(urls);
  if (urlList.length > INDEXNOW_MAX_URLS) {
    throw new Error("IndexNow accepts at most 10,000 URLs per submission");
  }

  return {
    host: INDEXNOW_HOST,
    key: normalizedKey,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList,
  };
}

/**
 * Return the UTF-8 ownership response required by IndexNow without revealing
 * configuration errors or runtime details.
 * Source: https://www.indexnow.org/documentation#verifying-ownership-via-the-key
 */
export function createIndexNowKeyResponse(
  configuredKey: string | undefined
): Response {
  if (!isValidIndexNowKey(configuredKey)) {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  return new Response(configuredKey.trim(), {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function submitIndexNow(
  urls: readonly string[],
  key: string,
  fetchIndexNow: FetchIndexNow = fetch
): Promise<IndexNowSubmissionResult> {
  const payload = buildIndexNowPayload(urls, key);
  const response = await fetchIndexNow(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow submission failed (${response.status})`);
  }

  return {
    status: response.status,
    submitted: payload.urlList.length,
  };
}
