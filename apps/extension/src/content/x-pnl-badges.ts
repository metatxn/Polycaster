import { Decimal } from "decimal.js";

const X_HANDLE_RE = /^[a-zA-Z0-9_]{1,15}$/;
const BADGE_CACHE_TTL_MS = 5 * 60 * 1000;
const NO_MATCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SCAN_DEBOUNCE_MS = 250;

interface TraderXProfile {
  handle: string;
  proxyWallet: string;
  userName: string | null;
  pnl: number;
  vol: number;
  rank: string;
  profileImage: string | null;
  verifiedBadge: boolean;
}

interface BadgeCacheEntry {
  profile: TraderXProfile | null;
  expiresAt: number;
}

const badgeCache = new Map<string, BadgeCacheEntry>();
const badgeInFlight = new Map<string, Promise<TraderXProfile | null>>();
let observer: MutationObserver | null = null;
let scheduledScan: ReturnType<typeof setTimeout> | null = null;

export function normalizeXHandle(
  value: string | null | undefined
): string | null {
  const handle = String(value ?? "")
    .trim()
    .replace(/^@+/, "");
  if (!X_HANDLE_RE.test(handle)) return null;
  return handle.toLowerCase();
}

function getHandleFromHref(href: string | null): string | null {
  if (!href) return null;
  try {
    const baseOrigin =
      typeof window !== "undefined" ? window.location.origin : "https://x.com";
    const url = new URL(href, baseOrigin);
    if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(url.hostname)) {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1) return null;
    return normalizeXHandle(parts[0]);
  } catch {
    return null;
  }
}

export function extractXHandleFromTweet(tweet: Element): string | null {
  const userNameBlock =
    tweet.querySelector('[data-testid="User-Name"]') ?? tweet;
  const anchors = Array.from(
    userNameBlock.querySelectorAll<HTMLAnchorElement>("a[href]")
  );

  for (const anchor of anchors) {
    const handle = getHandleFromHref(anchor.getAttribute("href"));
    if (handle) return handle;
  }

  return null;
}

export function formatPnlBadgeLabel(pnl: number): string {
  const value = new Decimal(pnl);
  const sign = value.greaterThanOrEqualTo(0) ? "+" : "-";
  const abs = value.abs();

  if (abs.greaterThanOrEqualTo(1_000_000)) {
    return `${sign}$${formatScaled(abs, 1_000_000, 2)}M`;
  }

  if (abs.greaterThanOrEqualTo(10_000)) {
    return `${sign}$${formatScaled(abs, 1_000, 1)}K`;
  }

  if (abs.greaterThanOrEqualTo(1_000)) {
    return `${sign}$${formatScaled(abs, 1_000, 2)}K`;
  }

  return `${sign}$${abs.toDecimalPlaces(0).toFixed(0)}`;
}

function formatScaled(
  value: Decimal,
  divisor: number,
  decimalPlaces: number
): string {
  return value
    .div(divisor)
    .toDecimalPlaces(decimalPlaces)
    .toFixed(decimalPlaces)
    .replace(/\.?0+$/, "");
}

function isTraderXProfile(value: unknown): value is TraderXProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<TraderXProfile>;
  return (
    typeof profile.handle === "string" &&
    typeof profile.proxyWallet === "string" &&
    typeof profile.pnl === "number" &&
    Number.isFinite(profile.pnl) &&
    typeof profile.vol === "number" &&
    Number.isFinite(profile.vol) &&
    typeof profile.rank === "string"
  );
}

function isFetchJsonOk(
  value: unknown
): value is { ok: true; status: number; data: unknown } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === true &&
    typeof (value as { status?: unknown }).status === "number" &&
    "data" in value
  );
}

async function fetchTraderProfile(
  handle: string
): Promise<TraderXProfile | null> {
  const cached = badgeCache.get(handle);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.profile;
  }

  const existing = badgeInFlight.get(handle);
  if (existing) return existing;

  const request = fetchTraderProfileUncached(handle).finally(() => {
    badgeInFlight.delete(handle);
  });
  badgeInFlight.set(handle, request);
  return request;
}

async function fetchTraderProfileUncached(
  handle: string
): Promise<TraderXProfile | null> {
  const url = `${window.KNOWW_CONFIG.KNOWW_APP_URL}/api/trader/x-profile?handle=${encodeURIComponent(handle)}`;

  try {
    const response = await window.KNOWW_UTILS.safeSendMessage({
      type: "fetch-json",
      method: "GET",
      url,
    });

    if (!isFetchJsonOk(response) || response.status !== 200) {
      rememberBadgeCache(handle, null, NO_MATCH_CACHE_TTL_MS);
      return null;
    }

    const data = response.data as { profile?: unknown };
    const profile = isTraderXProfile(data.profile) ? data.profile : null;
    rememberBadgeCache(
      handle,
      profile,
      profile ? BADGE_CACHE_TTL_MS : NO_MATCH_CACHE_TTL_MS
    );
    return profile;
  } catch {
    return null;
  }
}

function rememberBadgeCache(
  handle: string,
  profile: TraderXProfile | null,
  ttlMs: number
): void {
  badgeCache.set(handle, {
    profile,
    expiresAt: Date.now() + ttlMs,
  });
}

function createPnlBadge(profile: TraderXProfile): HTMLElement {
  const badge = document.createElement("a");
  badge.className = `knoww-x-pnl-badge ${
    new Decimal(profile.pnl).greaterThanOrEqualTo(0)
      ? "knoww-x-pnl-positive"
      : "knoww-x-pnl-negative"
  }`;
  badge.textContent = formatPnlBadgeLabel(profile.pnl);
  badge.href = `${window.KNOWW_CONFIG.KNOWW_APP_URL}/profile/${profile.proxyWallet}`;
  badge.target = "_blank";
  badge.rel = "noopener noreferrer";
  badge.title = `Polymarket PNL for @${profile.handle}`;
  badge.setAttribute("aria-label", `Polymarket PNL ${badge.textContent}`);
  badge.setAttribute("data-knoww-x-pnl-badge", "true");
  return badge;
}

export function prepareBadgeRowForPnlBadge(
  tweet: Element,
  handle: string
): Element | null {
  const userNameBlock =
    tweet.querySelector('[data-testid="User-Name"]') ?? tweet;
  const target =
    Array.from(
      userNameBlock.querySelectorAll<HTMLAnchorElement>("a[href]")
    ).find(
      (anchor) => getHandleFromHref(anchor.getAttribute("href")) === handle
    )?.parentElement ?? null;
  target?.classList.add("knoww-x-pnl-name-row");
  return target;
}

async function processTweet(tweet: Element): Promise<void> {
  if (tweet.querySelector("[data-knoww-x-pnl-badge]")) return;
  if (tweet.getAttribute("data-knoww-x-pnl-state") === "pending") return;
  if (tweet.getAttribute("data-knoww-x-pnl-state") === "done") return;

  const handle = extractXHandleFromTweet(tweet);
  if (!handle) {
    tweet.setAttribute("data-knoww-x-pnl-state", "done");
    return;
  }

  tweet.setAttribute("data-knoww-x-pnl-state", "pending");
  const profile = await fetchTraderProfile(handle);
  if (!profile || !tweet.isConnected) {
    tweet.setAttribute("data-knoww-x-pnl-state", "done");
    return;
  }

  const target = prepareBadgeRowForPnlBadge(tweet, handle);
  if (!target || target.querySelector("[data-knoww-x-pnl-badge]")) {
    tweet.setAttribute("data-knoww-x-pnl-state", "done");
    return;
  }

  target.appendChild(createPnlBadge(profile));
  tweet.setAttribute("data-knoww-x-pnl-state", "done");
}

function scanTweets(root: ParentNode = document): void {
  const tweets = Array.from(
    root.querySelectorAll<Element>('article[data-testid="tweet"]')
  );
  for (const tweet of tweets) {
    void processTweet(tweet);
  }
}

function scheduleScan(): void {
  if (scheduledScan) return;
  scheduledScan = setTimeout(() => {
    scheduledScan = null;
    scanTweets();
  }, SCAN_DEBOUNCE_MS);
}

export function startXTraderPnlBadges(): void {
  if (observer) return;

  scanTweets();
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          scheduleScan();
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
