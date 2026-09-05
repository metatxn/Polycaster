import { SUPPORTED_MATCH_PATTERNS } from "./supported-hosts";
import { isWebmailUrl } from "./webmail";

export const SIDEPANEL_SITE_SUPPORT_REQUEST_KEY =
  "knoww_sidepanel_site_support_request";
export const SHOW_SITE_SUPPORT_REQUEST_MESSAGE =
  "KNOWW_SHOW_SITE_SUPPORT_REQUEST";
export const OPEN_SITE_SUPPORT_PROMPT_MESSAGE =
  "KNOWW_OPEN_SITE_SUPPORT_PROMPT";

const PUBLIC_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeSiteSupportHostname(hostname: string): string | null {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");

  if (!PUBLIC_HOSTNAME_PATTERN.test(normalized)) return null;
  return normalized;
}

export function getRequestableSiteHostname(
  urlString: string | undefined
): string | null {
  if (!urlString) return null;

  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return normalizeSiteSupportHostname(url.hostname);
  } catch {
    return null;
  }
}

function wildcardPathMatches(pathPattern: string, pathname: string): boolean {
  const escaped = pathPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*")}$`).test(pathname);
}

function matchesChromePattern(url: URL, pattern: string): boolean {
  const match = pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/);
  if (!match) return false;

  const [, scheme, hostPattern, pathPattern] = match;
  if (scheme !== "*" && `${scheme}:` !== url.protocol) return false;

  const hostname = url.hostname.toLowerCase();
  const normalizedHostPattern = hostPattern.toLowerCase();
  const hostMatches = normalizedHostPattern.startsWith("*.")
    ? hostname === normalizedHostPattern.slice(2) ||
      hostname.endsWith(`.${normalizedHostPattern.slice(2)}`)
    : normalizedHostPattern === "*" || hostname === normalizedHostPattern;

  return hostMatches && wildcardPathMatches(pathPattern, url.pathname);
}

export function isSupportedSiteUrl(
  urlString: string | undefined,
  patterns: readonly string[] = SUPPORTED_MATCH_PATTERNS
): boolean {
  if (!urlString) return false;

  try {
    const url = new URL(urlString);
    return patterns.some((pattern) => matchesChromePattern(url, pattern));
  } catch {
    return false;
  }
}

export function getUnsupportedSiteHostname(
  urlString: string | undefined,
  patterns: readonly string[] = SUPPORTED_MATCH_PATTERNS
): string | null {
  if (isWebmailUrl(urlString)) return null;
  const hostname = getRequestableSiteHostname(urlString);
  if (!hostname || isSupportedSiteUrl(urlString, patterns)) return null;
  return hostname;
}
