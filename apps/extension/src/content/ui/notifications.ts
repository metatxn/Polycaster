import { parseGammaStringArray } from "@knoww/shared-types/polymarket";
import { Decimal } from "decimal.js";
import type {
  InjectedMarketEntry,
  Market,
  NestedMarket,
} from "../../types/market";
import { setCspSafeImageSrc } from "../image-proxy";
import { isMarketWithinDisplayPriceCap } from "../market-price-filter";
import type { StreamBetHandle, TradingRuntime } from "../trading-runtime-types";
import { escapeSelectorValue } from "../utils";
import {
  applyPlatformStyleVariables,
  buildKalshiUrl,
  buildKnowwUrl,
  buildMarketUrl,
  getMarketEmoji,
  getSafeRuntimeUrl,
  parseGammaPriceArray,
  parseMultiOutcomeData,
  renderOutcomePrices,
  SOURCE_CONFIG,
  toDecimal,
} from "./cards";

// ============================================
// NOTIFICATION STACK COMPONENT
// ============================================

let notificationStackContainer: HTMLElement | null = null;
let notificationStackListenersAttached = false; // Guard to prevent duplicate listeners on re-init

export interface StreamTradingRuntimePort {
  load(): Promise<Pick<TradingRuntime, "hydrateStreamBet">>;
}

let streamTradingRuntimePort: StreamTradingRuntimePort | null = null;

export function configureStreamTradingRuntimePort(
  port: StreamTradingRuntimePort
): void {
  streamTradingRuntimePort = port;
}

interface StreamController {
  dispose(): void;
}

const streamControllers = new WeakMap<HTMLElement, StreamController>();

function streamShortTitle(market: Market): string {
  const title = market.title || "Market";
  return title.split(/\s[-–—|]\s/)[0].trim() || title;
}

export function createStreamBetHost(market: Market): HTMLElement {
  const host = document.createElement("div");
  host.className = "knoww-stream-bet-host";
  let handle: StreamBetHandle | null = null;
  let disposed = false;
  let attempt = 0;

  const renderLoading = (): void => {
    const status = document.createElement("div");
    status.className = "knoww-stream-bet-loading";
    status.setAttribute("role", "status");
    status.textContent = "Loading trading…";
    host.replaceChildren(status);
  };

  const startHydration = async (): Promise<void> => {
    if (disposed || !host.isConnected || !streamTradingRuntimePort) return;
    const currentAttempt = ++attempt;
    renderLoading();
    try {
      const runtime = await streamTradingRuntimePort.load();
      if (disposed || currentAttempt !== attempt || !host.isConnected) return;
      const nextHandle = runtime.hydrateStreamBet(host, {
        market,
        ui: {
          setInlineDepositActive: (active) =>
            setStreamInlineDepositActive(host, active),
          showToast: showScrollToast,
        },
      });
      if (disposed || !host.isConnected) {
        nextHandle.dispose();
        return;
      }
      handle = nextHandle;
    } catch {
      if (disposed || currentAttempt !== attempt || !host.isConnected) return;
      const error = document.createElement("div");
      error.className = "knoww-stream-bet-load-error";
      const message = document.createElement("span");
      message.textContent = "Trading controls could not be loaded.";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry loading trading";
      retry.onclick = (event) => {
        event.stopPropagation();
        void startHydration();
      };
      error.append(message, retry);
      host.replaceChildren(error);
    }
  };

  streamControllers.set(host, {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      attempt += 1;
      handle?.dispose();
      handle = null;
      streamControllers.delete(host);
    },
  });

  renderLoading();
  queueMicrotask(() => {
    void startHydration();
  });
  return host;
}

export function disposeStreamControllers(root: ParentNode): void {
  const hosts: HTMLElement[] = [];
  if (
    root instanceof HTMLElement &&
    root.classList.contains("knoww-stream-bet-host")
  ) {
    hosts.push(root);
  }
  hosts.push(...root.querySelectorAll<HTMLElement>(".knoww-stream-bet-host"));
  for (const host of hosts) streamControllers.get(host)?.dispose();
}

export function collapseStreamWidgets(root: ParentNode): void {
  for (const widget of root.querySelectorAll<HTMLElement>(
    ".knoww-stream-bet"
  )) {
    widget.dispatchEvent(new CustomEvent("knoww-stream-collapsed"));
  }
}
// Default caps; platforms can override via `maxActiveNotificationItems` and
// `maxNotificationItems` on their adapter (see `resolveNotificationCaps`).
const MAX_NOTIFICATION_ITEMS = 12;
const MAX_ACTIVE_NOTIFICATION_ITEMS = 4;

function resolveNotificationCaps(): { active: number; scrolled: number } {
  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  const activeOverride = platform?.maxActiveNotificationItems;
  const totalOverride = platform?.maxNotificationItems;

  const active =
    typeof activeOverride === "number" && activeOverride > 0
      ? Math.floor(activeOverride)
      : MAX_ACTIVE_NOTIFICATION_ITEMS;
  const total =
    typeof totalOverride === "number" && totalOverride > 0
      ? Math.floor(totalOverride)
      : MAX_NOTIFICATION_ITEMS;
  // Guarantee the scrolled-out bucket has at least one slot so the section
  // doesn't collapse when a platform sets active === total.
  const scrolled = Math.max(total - active, 0);
  return { active, scrolled };
}
const SCROLLED_OUT_GRACE_MS = 8000;

// Trending markets state
const TRENDING_FETCH_DELAY_MS = 0;
const TRENDING_SHUFFLE_INTERVAL_MS = 60_000;
const MAX_TRENDING_DISPLAY = 2;
const MAX_EXPANDED_TRENDING_DISPLAY = 10;
let trendingFetchTimer: ReturnType<typeof setTimeout> | null = null;
let trendingShuffleTimer: ReturnType<typeof setInterval> | null = null;
let trendingFetchInFlight = false;
let trendingPool: Market[] = [];
let visibleTrending: Market[] = [];

// ─── First-run welcome state ──────────────────────────────────────────
//
// On first install, users who reach the notification stack with no matched
// markets yet would otherwise see a terse "Searching for markets…" spinner
// with no indication that the extension is working correctly. A one-time
// welcome card orients them; once dismissed, we revert to the compact
// scanning state for the rest of the user's lifetime on this profile.

const WELCOME_SEEN_STORAGE_KEY = "knoww-stack-welcome-seen";

const WELCOME_SPARKLE_ICON_HTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.64 5.64l2.12 2.12M16.24 16.24l2.12 2.12M5.64 18.36l2.12-2.12M16.24 7.76l2.12-2.12"/>
  </svg>
`;

function readPersistedWelcomeSeen(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local.get(WELCOME_SEEN_STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(result?.[WELCOME_SEEN_STORAGE_KEY]));
      });
    } catch {
      resolve(false);
    }
  });
}

function persistWelcomeSeen(): void {
  try {
    chrome.storage?.local.set({ [WELCOME_SEEN_STORAGE_KEY]: true });
  } catch {
    // Non-fatal — if persistence fails, the welcome just shows again next time.
  }
}

function disconnectNotificationStackLifecyclePort(): void {
  if (notificationStackLifecycleTimer) {
    clearInterval(notificationStackLifecycleTimer);
    notificationStackLifecycleTimer = null;
  }

  if (notificationStackLifecyclePort) {
    try {
      notificationStackLifecyclePort.disconnect();
    } catch {
      // The port may already be disconnected if the background worker restarted.
    }
    notificationStackLifecyclePort = null;
  }
}

function ensureNotificationStackLifecyclePort(): void {
  if (notificationStackLifecyclePort) return;

  try {
    const port = chrome.runtime.connect({ name: NOTIFICATION_STACK_PORT_NAME });
    notificationStackLifecyclePort = port;
    port.postMessage({ type: "KNOWW_NOTIFICATION_STACK_ALIVE" });
    notificationStackLifecycleTimer = setInterval(() => {
      try {
        port.postMessage({ type: "KNOWW_NOTIFICATION_STACK_ALIVE" });
      } catch {
        disconnectNotificationStackLifecyclePort();
      }
    }, NOTIFICATION_STACK_LIFECYCLE_PING_MS);
    port.onDisconnect.addListener(() => {
      if (notificationStackLifecyclePort === port) {
        notificationStackLifecyclePort = null;
      }
      if (notificationStackLifecycleTimer) {
        clearInterval(notificationStackLifecycleTimer);
        notificationStackLifecycleTimer = null;
      }
    });
  } catch {
    notificationStackLifecyclePort = null;
  }
}

// ─── Minimize / expand state ───────────────────────────────────────────
//
// The notification stack can be collapsed to just its header when users
// want the panel out of the way. The collapsed preference is persisted
// per-origin so it survives page navigations and reloads.

const STACK_MINIMIZED_STORAGE_KEY = "knoww-stack-minimized";
const STACK_DISMISSED_STORAGE_KEY = "knoww-stack-dismissed";
const STACK_EXPANDED_SESSION_KEY = "knoww-stack-expanded";
const NOTIFICATION_STACK_VIEWPORT_MARGIN = 12;
const NOTIFICATION_STACK_PORT_NAME = "knoww-notification-stack";
const NOTIFICATION_STACK_LIFECYCLE_PING_MS = 20_000;

const STACK_MINIMIZE_ICON_HTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
`;

const STACK_EXPAND_ICON_HTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
`;

type StackFilter = "all" | "active" | "seen" | "trending";

let cachedStackMinimized = false;
let cachedStackExpanded = readPersistedStackExpanded();
let cachedStackFilter: StackFilter = "all";
let notificationStackLifecyclePort: chrome.runtime.Port | null = null;
let notificationStackLifecycleTimer: ReturnType<typeof setInterval> | null =
  null;

function readPersistedStackMinimized(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local.get(STACK_MINIMIZED_STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(result?.[STACK_MINIMIZED_STORAGE_KEY]));
      });
    } catch {
      resolve(false);
    }
  });
}

function readPersistedStackDismissed(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local.get(STACK_DISMISSED_STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(result?.[STACK_DISMISSED_STORAGE_KEY]));
      });
    } catch {
      resolve(false);
    }
  });
}

function persistStackMinimized(value: boolean): void {
  try {
    chrome.storage?.local.set({ [STACK_MINIMIZED_STORAGE_KEY]: value });
  } catch {
    // Non-fatal; the UI state stays consistent for the current session.
  }
}

function persistStackDismissed(value: boolean): void {
  try {
    chrome.storage?.local.set({ [STACK_DISMISSED_STORAGE_KEY]: value });
  } catch {
    // Non-fatal; the current page still follows the user's action.
  }
}

function readPersistedStackExpanded(): boolean {
  try {
    return sessionStorage.getItem(STACK_EXPANDED_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

function persistStackExpanded(value: boolean): void {
  try {
    sessionStorage.setItem(
      STACK_EXPANDED_SESSION_KEY,
      value ? "true" : "false"
    );
  } catch {
    // Non-fatal; expanded state is session-only convenience.
  }
}

function applyMinimizedState(
  container: HTMLElement,
  toggleBtn: HTMLElement,
  minimized: boolean
): void {
  container.classList.toggle("knoww-stack-minimized", minimized);
  toggleBtn.innerHTML = minimized
    ? STACK_EXPAND_ICON_HTML
    : STACK_MINIMIZE_ICON_HTML;
  toggleBtn.title = minimized ? "Expand" : "Minimize";
  toggleBtn.setAttribute(
    "aria-label",
    minimized ? "Expand markets panel" : "Minimize markets panel"
  );
  toggleBtn.setAttribute("aria-expanded", minimized ? "false" : "true");
}

function applyStackExpandedState(
  container: HTMLElement,
  expanded: boolean
): void {
  container.classList.toggle("knoww-stack-expanded", expanded);
}

function clampNotificationStackToViewport(container: HTMLElement): void {
  const rect = container.getBoundingClientRect();
  const maxLeft = Math.max(
    NOTIFICATION_STACK_VIEWPORT_MARGIN,
    window.innerWidth - rect.width - NOTIFICATION_STACK_VIEWPORT_MARGIN
  );
  const maxTop = Math.max(
    NOTIFICATION_STACK_VIEWPORT_MARGIN,
    window.innerHeight - rect.height - NOTIFICATION_STACK_VIEWPORT_MARGIN
  );

  let nextLeft = rect.left;
  let nextTop = rect.top;
  let shouldClamp = false;

  if (rect.right > window.innerWidth - NOTIFICATION_STACK_VIEWPORT_MARGIN) {
    nextLeft = maxLeft;
    shouldClamp = true;
  }
  if (rect.left < NOTIFICATION_STACK_VIEWPORT_MARGIN) {
    nextLeft = NOTIFICATION_STACK_VIEWPORT_MARGIN;
    shouldClamp = true;
  }
  if (rect.bottom > window.innerHeight - NOTIFICATION_STACK_VIEWPORT_MARGIN) {
    nextTop = maxTop;
    shouldClamp = true;
  }
  if (rect.top < NOTIFICATION_STACK_VIEWPORT_MARGIN) {
    nextTop = NOTIFICATION_STACK_VIEWPORT_MARGIN;
    shouldClamp = true;
  }

  if (!shouldClamp) return;

  container.style.setProperty("left", `${nextLeft}px`, "important");
  container.style.setProperty("top", `${nextTop}px`, "important");
  container.style.setProperty("right", "auto", "important");
}

function resetNotificationStackToPreferredPosition(
  container: HTMLElement
): void {
  container.style.removeProperty("left");
  container.style.removeProperty("top");
  container.style.removeProperty("right");
}

function createStackTabs(): HTMLElement {
  const tabs = document.createElement("div");
  tabs.className = "knoww-stack-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Market list filters");

  const options: Array<{ value: StackFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "seen", label: "Seen" },
    { value: "trending", label: "Trending" },
  ];

  options.forEach((option) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "knoww-stack-tab";
    tab.dataset.knowwStackFilter = option.value;
    tab.setAttribute("role", "tab");
    tab.textContent = option.label;
    tab.addEventListener("click", () => {
      cachedStackFilter = option.value;
      updateStackTabsState();
      void window.KNOWW_ANALYTICS?.track("notification_stack_filter_changed", {
        filter: cachedStackFilter,
      });
      updateNotificationStack(getStackBaseMarkets());
    });
    tabs.appendChild(tab);
  });

  updateStackTabsState(tabs);
  return tabs;
}

function updateStackTabsState(root?: HTMLElement): void {
  const tabsRoot =
    root || document.querySelector<HTMLElement>("#knoww-stack-tabs");
  if (!tabsRoot) return;

  tabsRoot
    .querySelectorAll<HTMLButtonElement>("[data-knoww-stack-filter]")
    .forEach((tab) => {
      const isActive = tab.dataset.knowwStackFilter === cachedStackFilter;
      tab.classList.toggle("knoww-stack-tab-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      tab.tabIndex = isActive ? 0 : -1;
    });
}

function setStackExpanded(container: HTMLElement, expanded: boolean): void {
  cachedStackExpanded = expanded;
  persistStackExpanded(expanded);
  applyStackExpandedState(container, expanded);
  requestAnimationFrame(() => clampNotificationStackToViewport(container));
  if (expanded) updateStackTabsState();
  updateNotificationStack(getStackBaseMarkets());
}

function handleNotificationStackKeydown(e: KeyboardEvent): void {
  if (!notificationStackContainer) return;
  if (notificationStackContainer.style.display === "none") return;

  if (e.key === "Escape") {
    if (notificationStackContainer.classList.contains("knoww-stack-expanded")) {
      setStackExpanded(notificationStackContainer, false);
      e.preventDefault();
      return;
    }

    const searchContainer = notificationStackContainer.querySelector(
      "#knoww-search-container"
    );
    const searchToggle = notificationStackContainer.querySelector<HTMLElement>(
      "#knoww-search-toggle"
    );
    if (searchContainer?.classList.contains("knoww-search-open")) {
      searchContainer.classList.remove("knoww-search-open");
      searchToggle?.classList.remove("knoww-search-active");
      e.preventDefault();
    }
    return;
  }

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const items = Array.from(
      notificationStackContainer.querySelectorAll<HTMLElement>(
        ".knoww-notification-item"
      )
    );
    if (items.length === 0) return;
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      e.key === "ArrowDown"
        ? activeIndex < 0
          ? 0
          : Math.min(activeIndex + 1, items.length - 1)
        : activeIndex < 0
          ? items.length - 1
          : Math.max(activeIndex - 1, 0);
    items[nextIndex]?.focus();
    e.preventDefault();
  }
}

// ─── Editorial helpers ─────────────────────────────────────────────────
//
// Formatting + per-row derivations used by the editorial notification
// layout: live clock in the footer, the 2–3 char category badge in the
// row thumbnail, the volume meta line, and the big serif ¢ price column.

let liveTimeTicker: ReturnType<typeof setInterval> | null = null;

function formatLiveTimeLabel(now: Date = new Date()): string {
  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
  let zone = "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZoneName: "short",
    }).formatToParts(now);
    zone = parts.find((p) => p.type === "timeZoneName")?.value || "";
  } catch {
    zone = "";
  }
  return zone ? `Live · ${time} ${zone}` : `Live · ${time}`;
}

function refreshLiveTimeLabel(): void {
  const node = document.getElementById("knoww-stack-footer-live");
  if (node) node.textContent = formatLiveTimeLabel();
}

function startLiveTimeTicker(): void {
  if (liveTimeTicker) return;
  liveTimeTicker = setInterval(refreshLiveTimeLabel, 30_000);
}

/**
 * Build a 32×32 row thumbnail. Prefers the market's image (event or first
 * nested market); falls back to a diagonal-stripe tile with the category
 * code when no image is available or the image fails to load.
 */
function renderRowThumbnail(market: Market): HTMLElement {
  const icon = document.createElement("div");
  icon.className = "knoww-notification-icon";
  const code = getCategoryCode(market);

  const imageUrl =
    market.image ||
    (market.markets?.[0] as (NestedMarket & { image?: string }) | undefined)
      ?.image;

  if (imageUrl) {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    const renderFallback = () => {
      img.remove();
      icon.classList.add("knoww-notification-icon-fallback");
      icon.textContent = code;
    };
    img.onerror = renderFallback;
    setCspSafeImageSrc(img, imageUrl, renderFallback);
    icon.appendChild(img);
  } else {
    icon.classList.add("knoww-notification-icon-fallback");
    icon.textContent = code;
  }

  return icon;
}

function getCategoryCode(market: Market): string {
  const candidates: string[] = [];
  if (market.category) candidates.push(market.category);
  const firstTag = market.tags?.[0];
  if (firstTag) candidates.push(firstTag.label || firstTag.slug || "");
  if (market.title) candidates.push(market.title);
  for (const raw of candidates) {
    const cleaned = (raw || "").replace(/[^a-zA-Z]/g, "").toUpperCase();
    if (cleaned.length >= 2) return cleaned.slice(0, 3);
  }
  return "MKT";
}

function formatMarketVolume(market: Market): string | null {
  const raw = market.volume24hr ?? market.volume ?? market.liquidity;
  const value = toDecimal(raw);
  if (!value || value.lte(0)) return null;

  const formatScaled = (divisor: number, suffix: string) =>
    `$${value
      .div(divisor)
      .toDecimalPlaces(1, Decimal.ROUND_HALF_UP)
      .toFixed(1)
      .replace(/\.0$/, "")}${suffix}`;

  if (value.gte(1_000_000_000)) return formatScaled(1_000_000_000, "B");
  if (value.gte(1_000_000)) return formatScaled(1_000_000, "M");
  if (value.gte(1_000)) return formatScaled(1_000, "K");
  return `$${value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)}`;
}

/**
 * Render the editorial price column: big serif ¢ price + mono side label.
 * `outcomes` and `prices` are already aligned and parsed by the caller.
 */
function renderEditorialPrice(
  container: HTMLElement,
  outcomes: string[],
  prices: number[]
): void {
  container.innerHTML = "";

  if (!outcomes.length || !prices.length) return;

  let leadingIdx = 0;
  let leadingPriceDecimal = toDecimal(prices[0]) ?? new Decimal(0);
  for (let i = 1; i < prices.length; i++) {
    const candidatePrice = toDecimal(prices[i]) ?? new Decimal(0);
    if (candidatePrice.gt(leadingPriceDecimal)) {
      leadingIdx = i;
      leadingPriceDecimal = candidatePrice;
    }
  }

  const leadingOutcome = (outcomes[leadingIdx] || "").trim();
  const cents = Decimal.max(0, Decimal.min(99, leadingPriceDecimal.mul(100)))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

  const numEl = document.createElement("span");
  numEl.className = "knoww-notification-price-num";
  const lower = leadingOutcome.toLowerCase();
  const isBinary = outcomes.length === 2;
  // Color when one side has a clear majority. "No" wins gets salmon; any
  // other leader (Yes, by-date, multi-outcome name) gets green.
  if (cents > 50) {
    if (isBinary && lower === "no") numEl.classList.add("no");
    else numEl.classList.add("yes");
  }

  numEl.textContent = String(cents);
  const centsGlyph = document.createElement("span");
  centsGlyph.className = "knoww-notification-price-cents";
  centsGlyph.textContent = "¢";
  numEl.appendChild(centsGlyph);

  const sideLabel = document.createElement("span");
  sideLabel.className = "knoww-notification-side-label";
  sideLabel.textContent = leadingOutcome || (isBinary ? "Yes" : "Top");

  container.appendChild(numEl);
  container.appendChild(sideLabel);
}

// Tracks whether the fullscreen listeners have been wired (once per page).
let fullscreenReparentBound = false;

/** The active fullscreen element across vendor-prefixed implementations. */
function getFullscreenElement(): Element | null {
  return (
    document.fullscreenElement ||
    // Safari/older WebKit
    (document as Document & { webkitFullscreenElement?: Element | null })
      .webkitFullscreenElement ||
    null
  );
}

/**
 * Keep the notification panel visible across fullscreen transitions by
 * re-parenting it into the fullscreen element (and back to <body> on exit).
 * A fixed-position node still anchors to the viewport inside the fullscreen
 * element, so the panel stays in its corner.
 */
function setupFullscreenReparenting(container: HTMLElement): void {
  if (fullscreenReparentBound) return;
  fullscreenReparentBound = true;

  const reparent = (): void => {
    const stack =
      notificationStackContainer ||
      document.getElementById("knoww-notification-stack") ||
      container;
    if (!stack) return;

    const fsEl = getFullscreenElement();
    const target: HTMLElement =
      fsEl instanceof HTMLElement ? fsEl : document.body;

    if (stack.parentElement !== target) {
      target.appendChild(stack);
    }
    // Player chrome can sit at very high stacking; keep the panel above it.
    stack.style.zIndex = fsEl ? "2147483647" : "";
  };

  document.addEventListener("fullscreenchange", reparent);
  document.addEventListener("webkitfullscreenchange", reparent);
}

/**
 * Create the notification stack container
 */
export function createNotificationStack(): HTMLElement {
  const { log } = window.KNOWW_UTILS;

  if (notificationStackContainer) {
    return notificationStackContainer;
  }

  // Remove any stale notification stacks left behind by a previous
  // script context (e.g. after extension hot-reload or update).
  const stale = document.querySelectorAll("#knoww-notification-stack");
  for (const el of Array.from(stale)) {
    el.remove();
    log("Removed stale notification stack from previous context");
  }

  const container = document.createElement("div");
  container.id = "knoww-notification-stack";

  const platformName = window.KNOWW_PLATFORM?.getPlatformName?.() || "unknown";

  // Detect theme - try multiple methods
  let theme: "dark" | "light" | "dim" = "dark"; // Default to dark for Twitter

  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  if (platform && typeof platform.detectTheme === "function") {
    theme = platform.detectTheme();
  } else {
    // Fallback theme detection for Twitter if platform not ready
    if (platformName === "twitter" || platformName === "unknown") {
      try {
        const bodyBg = window.getComputedStyle(document.body).backgroundColor;
        const rgbMatch = bodyBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
          const r = parseInt(rgbMatch[1], 10);
          const g = parseInt(rgbMatch[2], 10);
          const b = parseInt(rgbMatch[3], 10);
          if (r === 0 && g === 0 && b === 0) {
            theme = "dark";
          } else if (r < 30 && g < 40 && b < 50 && b > r) {
            theme = "dim";
          } else if (r > 240 && g > 240 && b > 240) {
            theme = "light";
          }
        }
      } catch {
        // Keep default dark theme
      }
    }
  }

  const themeClass = ` knoww-theme-${theme}`;
  container.className = `knoww-notification-stack knoww-notification-stack-${platformName}${themeClass}`;
  applyPlatformStyleVariables(container, platform?.getCardStyles?.(theme));

  log(
    `Creating notification stack with platform: ${platformName}, theme: ${theme}`
  );

  // Header
  const header = document.createElement("div");
  header.className = "knoww-stack-header";

  const headerTitle = document.createElement("div");
  headerTitle.className = "knoww-stack-title";
  const brandIconUrl =
    getSafeRuntimeUrl("icons/icon-128.png") || "icons/icon-128.png";
  headerTitle.innerHTML = `
    <span class="knoww-stack-icon" aria-hidden="true">
      <img src="${brandIconUrl}" alt="Knoww" width="20" height="20" />
    </span>
    <span>Markets</span>
  `;

  const headerRight = document.createElement("div");
  headerRight.className = "knoww-stack-header-right";

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "knoww-stack-settings";
  settingsBtn.type = "button";
  settingsBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5 15.08a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 5a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
    </svg>
  `;
  settingsBtn.title = "Settings";
  settingsBtn.setAttribute("aria-label", "Open extension settings");

  const sidebarBtn = document.createElement("button");
  sidebarBtn.className = "knoww-stack-sidebar";
  sidebarBtn.type = "button";
  sidebarBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <path d="M15 4v16"/>
      <path d="m10 9 3 3-3 3"/>
    </svg>
  `;
  sidebarBtn.title = "Move to browser sidebar";
  sidebarBtn.setAttribute(
    "aria-label",
    "Move markets panel to browser sidebar"
  );

  const searchToggle = document.createElement("button");
  searchToggle.className = "knoww-search-toggle";
  searchToggle.id = "knoww-search-toggle";
  searchToggle.type = "button";
  searchToggle.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"></circle>
      <path d="M21 21l-4.35-4.35"></path>
    </svg>
  `;
  searchToggle.title = "Search markets";

  const minimizeToggle = document.createElement("button");
  minimizeToggle.className = "knoww-stack-minimize";
  minimizeToggle.id = "knoww-stack-minimize";
  minimizeToggle.type = "button";
  minimizeToggle.innerHTML = STACK_MINIMIZE_ICON_HTML;
  minimizeToggle.title = "Minimize";
  minimizeToggle.setAttribute("aria-label", "Minimize");
  minimizeToggle.setAttribute("aria-expanded", "true");

  const closeBtn = document.createElement("button");
  closeBtn.className = "knoww-stack-close";
  closeBtn.id = "knoww-stack-close";
  closeBtn.type = "button";
  closeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
  `;
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close markets panel");

  headerRight.appendChild(settingsBtn);
  headerRight.appendChild(sidebarBtn);
  headerRight.appendChild(searchToggle);
  headerRight.appendChild(minimizeToggle);
  headerRight.appendChild(closeBtn);
  header.appendChild(headerTitle);
  header.appendChild(headerRight);

  // Search container
  const searchContainer = document.createElement("div");
  searchContainer.className = "knoww-search-container";
  searchContainer.id = "knoww-search-container";

  const searchInputWrapper = document.createElement("div");
  searchInputWrapper.className = "knoww-search-input-wrapper";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "knoww-search-input";
  searchInput.id = "knoww-search-input";
  searchInput.placeholder = "Search Polymarket...";

  const clearBtn = document.createElement("button");
  clearBtn.className = "knoww-search-clear";
  clearBtn.id = "knoww-search-clear";
  clearBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  `;
  clearBtn.style.display = "none";

  searchInputWrapper.appendChild(searchInput);
  searchInputWrapper.appendChild(clearBtn);

  const searchResults = document.createElement("div");
  searchResults.className = "knoww-search-results";
  searchResults.id = "knoww-search-results";

  searchContainer.appendChild(searchInputWrapper);
  searchContainer.appendChild(searchResults);

  const stackTabs = createStackTabs();
  stackTabs.id = "knoww-stack-tabs";

  // Content area — single container that holds EITHER the empty state
  // OR the market items. Never both at the same time.
  const contentArea = document.createElement("div");
  contentArea.className = "knoww-stack-content";
  contentArea.id = "knoww-stack-content";

  // Items container (hidden initially, shown when markets exist)
  const itemsContainer = document.createElement("div");
  itemsContainer.className = "knoww-stack-items";
  itemsContainer.id = "knoww-stack-items";
  itemsContainer.style.setProperty("display", "none", "important");

  // Empty state (visible initially)
  const emptyState = document.createElement("div");
  emptyState.className = "knoww-stack-empty";
  emptyState.id = "knoww-stack-empty";
  emptyState.innerHTML = `
    <div class="knoww-stack-welcome" data-knoww-welcome style="display:none !important">
      <div class="knoww-stack-welcome-icon">${WELCOME_SPARKLE_ICON_HTML}</div>
      <div class="knoww-stack-welcome-title">Knoww is listening</div>
      <p class="knoww-stack-welcome-body">
        As you browse, we surface Polymarket positions matching predictive
        claims on this page. Nothing here yet? Keep scrolling &mdash; markets
        appear the moment we find one.
      </p>
      <button type="button" class="knoww-stack-welcome-cta" data-knoww-welcome-dismiss>
        Got it
      </button>
    </div>
    <div class="knoww-stack-scanning" data-knoww-scanning>
      <div class="knoww-stack-empty-title-row">
        <span class="knoww-stack-empty-pulse" aria-hidden="true"></span>
        <span class="knoww-stack-empty-title">No markets found on this page yet</span>
        <span class="knoww-stack-empty-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </div>
      <span class="knoww-stack-empty-sub">Scroll your feed to discover matches &mdash; browse markets from the Knoww sidebar.</span>
    </div>
  `;

  contentArea.appendChild(itemsContainer);
  contentArea.appendChild(emptyState);

  // Wire up first-run welcome. If the user has never dismissed the welcome
  // card, swap the "Searching for markets…" scanning row for the richer
  // welcome message. Reverts permanently once they click "Got it".
  const welcomeEl = emptyState.querySelector<HTMLElement>(
    "[data-knoww-welcome]"
  );
  const scanningEl = emptyState.querySelector<HTMLElement>(
    "[data-knoww-scanning]"
  );
  const welcomeDismissBtn = emptyState.querySelector<HTMLButtonElement>(
    "[data-knoww-welcome-dismiss]"
  );

  const dismissWelcome = () => {
    // setProperty with "important" because .knoww-stack-welcome has
    // `display: flex !important` — a plain inline style would lose to it.
    if (welcomeEl) welcomeEl.style.setProperty("display", "none", "important");
    if (scanningEl) scanningEl.style.display = "";
    persistWelcomeSeen();
    void window.KNOWW_ANALYTICS?.track("welcome_dismissed", {});
  };

  welcomeDismissBtn?.addEventListener("click", dismissWelcome);

  void readPersistedWelcomeSeen().then((seen) => {
    if (!seen && welcomeEl && scanningEl) {
      welcomeEl.style.removeProperty("display");
      scanningEl.style.display = "none";
      void window.KNOWW_ANALYTICS?.track("welcome_shown", {});
    }
  });

  // Footer — live timestamp only; full browsing now lives in the sidebar.
  const footer = document.createElement("div");
  footer.className = "knoww-stack-footer";
  footer.id = "knoww-stack-footer";

  const liveLabel = document.createElement("span");
  liveLabel.className = "knoww-stack-footer-live";
  liveLabel.id = "knoww-stack-footer-live";
  liveLabel.textContent = formatLiveTimeLabel();

  applyStackExpandedState(container, cachedStackExpanded);

  footer.appendChild(liveLabel);

  container.appendChild(header);
  container.appendChild(searchContainer);
  container.appendChild(stackTabs);
  container.appendChild(contentArea);
  container.appendChild(footer);

  // Append to body with fixed positioning (all platforms)
  document.body.appendChild(container);
  log("Notification stack created with fixed position");

  // Keep the panel visible when the page enters fullscreen (e.g. a Twitch/
  // YouTube player). The browser only paints the fullscreen element's subtree,
  // so a body-level fixed panel would vanish — re-parent it into the
  // fullscreen element while fullscreen is active, and back to body on exit.
  setupFullscreenReparenting(container);

  startLiveTimeTicker();

  setupSearchFunctionality(
    searchToggle,
    searchContainer,
    searchInput,
    searchResults,
    clearBtn
  );

  // Apply the cached minimized state synchronously so there's no flash of
  // "expanded-then-collapsed" on subsequent stack re-creations. The initial
  // load happens asynchronously via readPersistedStackMinimized() below.
  applyMinimizedState(container, minimizeToggle, cachedStackMinimized);

  const toggleMinimized = () => {
    const next = !container.classList.contains("knoww-stack-minimized");
    cachedStackMinimized = next;
    applyMinimizedState(container, minimizeToggle, next);
    persistStackMinimized(next);
    void window.KNOWW_ANALYTICS?.track("notification_stack_toggled", {
      minimized: next,
    });
  };

  minimizeToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMinimized();
  });

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    persistStackDismissed(true);
    disconnectNotificationStackLifecyclePort();
    container.style.setProperty("display", "none", "important");
    void window.KNOWW_ANALYTICS?.track("notification_stack_closed");
  });

  const showInvalidatedRuntimeMessage = () => {
    showScrollToast("Extension updated. Refresh this page to reconnect Knoww.");
  };

  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void window.KNOWW_UTILS.safeSendMessage({
      type: "KNOWW_OPEN_EXTENSION_SETTINGS",
    }).then((response?: { ok?: boolean; error?: string }) => {
      if (/Extension context invalidated/i.test(response?.error || "")) {
        showInvalidatedRuntimeMessage();
      }
    });
    void window.KNOWW_ANALYTICS?.track("extension_settings_opened", {
      surface: "notification_stack",
    });
  });

  const openSidePanelFromNotificationStack = () => {
    void window.KNOWW_UTILS.safeSendMessage({
      type: "KNOWW_OPEN_EXTENSION_SIDEPANEL",
    }).then((response?: { ok?: boolean; error?: string }) => {
      if (response?.ok !== true) {
        if (/Extension context invalidated/i.test(response?.error || "")) {
          showInvalidatedRuntimeMessage();
          return;
        }
        showScrollToast(
          response?.error ||
            "This browser does not support Knoww in the sidebar."
        );
      }
    });
  };

  sidebarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openSidePanelFromNotificationStack();
    void window.KNOWW_ANALYTICS?.track("extension_sidepanel_opened", {
      surface: "notification_stack",
    });
  });

  // When minimized, clicking the title row (logo + "Markets" label) expands
  // the panel — matches the affordance you'd expect from a collapsed pill.
  headerTitle.addEventListener("click", () => {
    if (container.classList.contains("knoww-stack-minimized")) {
      toggleMinimized();
    }
  });

  // Streaming surface: keep the original header (icons), but slim the panel via
  // CSS — drop the footer and the "Live now" section label. The marker class is
  // the hook for those rules (see `.knoww-stack-stream` in knoww-inline.css).
  if (isStreamSurface()) {
    container.classList.add("knoww-stack-stream");
  }

  // Hydrate from persisted state on first creation.
  void readPersistedStackMinimized().then((persisted) => {
    if (persisted !== cachedStackMinimized) {
      cachedStackMinimized = persisted;
      applyMinimizedState(container, minimizeToggle, persisted);
    }
  });

  notificationStackContainer = container;
  return container;
}

/**
 * Set up search functionality
 */
function setupSearchFunctionality(
  toggleBtn: HTMLButtonElement,
  container: HTMLElement,
  input: HTMLInputElement,
  resultsContainer: HTMLElement,
  clearBtn: HTMLButtonElement
): void {
  const { log } = window.KNOWW_UTILS;

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  let isSearchOpen = false;
  let currentSearchQuery = ""; // Track current query to ignore stale results

  toggleBtn.onclick = () => {
    const stack = container.closest<HTMLElement>(".knoww-notification-stack");
    const minimizeToggle = stack?.querySelector<HTMLElement>(
      "#knoww-stack-minimize"
    );
    if (stack?.classList.contains("knoww-stack-minimized") && minimizeToggle) {
      cachedStackMinimized = false;
      applyMinimizedState(stack, minimizeToggle, false);
      persistStackMinimized(false);
    }

    isSearchOpen = !isSearchOpen;
    container.classList.toggle("knoww-search-open", isSearchOpen);
    toggleBtn.classList.toggle("knoww-search-active", isSearchOpen);

    if (isSearchOpen) {
      void window.KNOWW_ANALYTICS?.track("extension_search_opened");
      input.focus();
      clearBtn.style.display = "flex";
    } else {
      input.value = "";
      resultsContainer.innerHTML = "";
      clearBtn.style.display = "none";
      currentSearchQuery = "";
    }
  };

  clearBtn.onclick = () => {
    void window.KNOWW_ANALYTICS?.track("extension_search_cleared");
    if (input.value.trim() === "") {
      isSearchOpen = false;
      container.classList.remove("knoww-search-open");
      toggleBtn.classList.remove("knoww-search-active");
      clearBtn.style.display = "none";
      currentSearchQuery = "";
    } else {
      input.value = "";
      resultsContainer.innerHTML = "";
      input.focus();
      currentSearchQuery = "";
    }
  };

  input.oninput = () => {
    const query = input.value.trim();
    currentSearchQuery = query;

    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (query.length < 2) {
      resultsContainer.innerHTML = "";
      return;
    }

    resultsContainer.innerHTML =
      '<div class="knoww-search-loading">Searching...</div>';

    const searchQuery = query; // Capture query for this search request
    searchTimeout = setTimeout(async () => {
      try {
        const { searchPolymarketEvents } = window.KNOWW_API;
        const events = await searchPolymarketEvents(searchQuery, []);
        void window.KNOWW_ANALYTICS?.track("extension_search_query_submitted", {
          queryLength: searchQuery.length,
          resultCount: events.length,
        });

        // Ignore stale results if query has changed
        if (currentSearchQuery !== searchQuery) {
          return;
        }

        if (events.length === 0) {
          resultsContainer.innerHTML =
            '<div class="knoww-search-empty">No markets found</div>';
          return;
        }

        resultsContainer.innerHTML = "";

        events.slice(0, 5).forEach((event) => {
          const resultItem = createSearchResultItem(event);
          resultsContainer.appendChild(resultItem);
        });
      } catch (e) {
        if (currentSearchQuery !== searchQuery) {
          return;
        }
        void window.KNOWW_ANALYTICS?.track("extension_search_failed", {
          query: searchQuery,
        });
        log("Search error:", e);
        resultsContainer.innerHTML =
          '<div class="knoww-search-empty">Search failed</div>';
      }
    }, 300);
  };

  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (
      isSearchOpen &&
      !container.contains(target) &&
      !toggleBtn.contains(target)
    ) {
      void window.KNOWW_ANALYTICS?.track("extension_search_dismissed");
      isSearchOpen = false;
      container.classList.remove("knoww-search-open");
      toggleBtn.classList.remove("knoww-search-active");
    }
  });
}

/**
 * Create a search result item
 */
function createSearchResultItem(market: Market): HTMLElement {
  const { KNOWW_APP_URL } = window.KNOWW_CONFIG;

  const marketSource = market.source || "polymarket";
  const sourceConfig = SOURCE_CONFIG[marketSource] || SOURCE_CONFIG.polymarket;

  const item = document.createElement("div");
  item.className = `knoww-search-result-item knoww-source-${marketSource}`;

  const icon = document.createElement("div");
  icon.className = "knoww-search-result-icon";

  let imageUrl = market.image;
  if (!imageUrl && market.markets && market.markets.length > 0) {
    imageUrl = (market.markets[0] as NestedMarket & { image?: string }).image;
  }

  // Build a data URI fallback for when chrome.runtime is unavailable
  const kalshiFallbackIcon =
    getSafeRuntimeUrl("icons/icon-48.png") ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect fill='%234a5568' width='48' height='48' rx='8'/%3E%3Ctext x='24' y='32' font-size='24' text-anchor='middle' fill='white'%3EK%3C/text%3E%3C/svg%3E";

  if (imageUrl) {
    const img = document.createElement("img");
    img.alt = "";
    const renderFallback = () => {
      icon.innerHTML = "";
      if (marketSource === "kalshi") {
        const fallbackImg = document.createElement("img");
        fallbackImg.src = kalshiFallbackIcon;
        fallbackImg.alt = "Kalshi";
        icon.appendChild(fallbackImg);
      } else {
        icon.textContent = getMarketEmoji(market);
      }
    };
    img.onerror = renderFallback;
    setCspSafeImageSrc(img, imageUrl, renderFallback);
    icon.appendChild(img);
  } else {
    if (marketSource === "kalshi") {
      const img = document.createElement("img");
      img.src = kalshiFallbackIcon;
      img.alt = "Kalshi";
      icon.appendChild(img);
    } else {
      icon.textContent = getMarketEmoji(market);
    }
  }

  const content = document.createElement("div");
  content.className = "knoww-search-result-content";

  const title = document.createElement("div");
  title.className = "knoww-search-result-title";
  title.textContent = truncateText(market.title || "Untitled Market", 45);

  const parsed = parseMultiOutcomeData(market);
  let outcomes = parsed.outcomes;
  let priceData: number[] = parsed.prices;

  if (!parsed.isMultiOutcome && market.markets && market.markets.length > 0) {
    const firstMarket =
      market.markets[parsed.firstActiveMarketIndex] ?? market.markets[0];
    if (firstMarket.outcomePrices) {
      priceData = parseGammaPriceArray(firstMarket.outcomePrices);
    }
    if (firstMarket.outcomes) {
      outcomes = parseGammaStringArray(firstMarket.outcomes);
    }
    if (outcomes.length === 0) outcomes = ["Yes", "No"];
    if (priceData.length === 0) {
      priceData = [0.5, 0.5];
    }
  }

  const prices = document.createElement("div");
  prices.className = "knoww-search-result-prices";

  renderOutcomePrices(prices, outcomes, priceData, 2);

  content.appendChild(title);
  content.appendChild(prices);

  item.appendChild(icon);
  item.appendChild(content);

  const sourceIndicator = document.createElement("div");
  sourceIndicator.className = "knoww-search-source-indicator";
  sourceIndicator.style.backgroundColor = sourceConfig.color;
  sourceIndicator.textContent = sourceConfig.icon;
  sourceIndicator.title = sourceConfig.name;
  item.appendChild(sourceIndicator);

  item.onclick = () => {
    let marketUrl: string;

    if (marketSource === "kalshi") {
      marketUrl = buildKalshiUrl(market);
    } else {
      marketUrl = market.slug
        ? `${KNOWW_APP_URL}/events/detail/${market.slug}`
        : KNOWW_APP_URL;
    }

    void window.KNOWW_ANALYTICS?.track("extension_search_result_clicked", {
      marketId: market.id,
      source: marketSource,
    });
    window.open(marketUrl, "_blank", "noopener,noreferrer");
  };

  return item;
}

export function createNotificationItem(
  marketData: InjectedMarketEntry,
  index: number,
  isActive = true
): HTMLElement {
  const { log } = window.KNOWW_UTILS;
  const { market, cardRef, postKey } = marketData;

  const marketSource = market.source || "polymarket";

  const item = document.createElement("div");
  item.className = `knoww-notification-item knoww-source-${marketSource} ${
    isActive ? "knoww-notification-active" : "knoww-notification-unavailable"
  }`;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("data-market-id", market.id);
  item.setAttribute("data-market-source", marketSource);
  item.setAttribute("data-market-status", isActive ? "active" : "scrolled-out");
  item.setAttribute(
    "aria-label",
    isActive
      ? `Scroll to ${market.title || "market"}`
      : `Restore or open ${market.title || "market"}`
  );
  if (!isActive) {
    item.title = "Restore this market card or open the market";
  }
  item.style.animationDelay = `${index * 50}ms`;

  const icon = renderRowThumbnail(market);

  const content = document.createElement("div");
  content.className = "knoww-notification-content";

  const title = document.createElement("div");
  title.className = "knoww-notification-title";
  title.textContent = market.title || "Untitled Market";

  const meta = document.createElement("div");
  meta.className = "knoww-notification-meta";
  const categoryLabel = market.category || market.tags?.[0]?.label || "";
  const volumeLabel = formatMarketVolume(market);
  if (categoryLabel) {
    const cat = document.createElement("span");
    cat.textContent = categoryLabel;
    meta.appendChild(cat);
  }
  if (categoryLabel && volumeLabel) {
    const dot = document.createElement("span");
    dot.className = "knoww-notification-meta-dot";
    meta.appendChild(dot);
  }
  if (volumeLabel) {
    const vol = document.createElement("span");
    vol.textContent = volumeLabel;
    meta.appendChild(vol);
  }
  if (!isActive) {
    if (meta.childNodes.length > 0) {
      const dot = document.createElement("span");
      dot.className = "knoww-notification-meta-dot";
      meta.appendChild(dot);
    }
    const action = document.createElement("span");
    action.className = "knoww-notification-action-label";
    action.textContent = "Restore";
    meta.appendChild(action);
  }

  const pricesDiv = document.createElement("div");
  pricesDiv.className = "knoww-notification-prices";

  const parsed = parseMultiOutcomeData(market);
  let outcomes = parsed.outcomes;
  let priceData: number[] = parsed.prices;
  const isMultiOutcome = parsed.isMultiOutcome;

  if (!isMultiOutcome && market.markets && market.markets.length > 0) {
    const firstMarket =
      market.markets[parsed.firstActiveMarketIndex] ?? market.markets[0];

    if (firstMarket.outcomePrices) {
      priceData = parseGammaPriceArray(firstMarket.outcomePrices);
    }

    if (firstMarket.outcomes) {
      outcomes = parseGammaStringArray(firstMarket.outcomes);
    }

    if (outcomes.length === 0 || priceData.length === 0) {
      outcomes = ["Yes", "No"];
      priceData = [0.5, 0.5];
    }
  }

  if (outcomes.length === 0) {
    outcomes = ["Yes", "No"];
    priceData = [0.5, 0.5];
  }

  renderEditorialPrice(pricesDiv, outcomes, priceData);

  content.appendChild(title);
  if (meta.childNodes.length > 0) content.appendChild(meta);

  item.appendChild(icon);
  item.appendChild(content);

  const isStream = marketData.isStreamSurface === true;
  if (isStream) {
    // Stream surface: collapsed by default — the row shows the title + price
    // like a normal market. Clicking it expands the inline betting area
    // (segment selector + action button). Accordion: only one open at a time.
    item.classList.add("knoww-notification-item--stream");

    // Compact collapsed pill: the market title (+ optional holdings chip +
    // chevron). Outcome names and prices live in the expanded segments, so the
    // collapsed row stays focused on identifying the market.
    content.innerHTML = "";
    const pill = document.createElement("div");
    pill.className = "knoww-stream-pill";
    const pillTitle = document.createElement("span");
    pillTitle.className = "knoww-stream-pill-title";
    pillTitle.textContent = streamShortTitle(market);
    const holdChip = document.createElement("span");
    holdChip.className = "knoww-stream-pill-hold";
    holdChip.style.display = "none";
    const chev = document.createElement("span");
    chev.className = "knoww-stream-pill-chev";
    chev.setAttribute("aria-hidden", "true");
    chev.textContent = "⌄";
    pill.appendChild(pillTitle);
    pill.appendChild(holdChip);
    pill.appendChild(chev);
    content.appendChild(pill);

    if (!__STORE_BUILD__) {
      // The store build ships no trading runtime, so the bet host would sit
      // on "Loading trading…" forever — skip it and deep-link instead.
      item.appendChild(createStreamBetHost(market));
    }

    item.setAttribute("aria-label", `Markets for ${market.title || "market"}`);
    item.onclick = (e) => {
      if (__STORE_BUILD__) {
        window.open(buildKnowwUrl(market), "_blank", "noopener,noreferrer");
        return;
      }
      // Don't toggle when interacting with the betting controls themselves.
      if ((e.target as Element).closest(".knoww-stream-bet")) return;
      const willExpand = !item.classList.contains("expanded");
      // Accordion: collapse any other expanded market.
      const siblings = item.parentElement?.querySelectorAll(
        ".knoww-notification-item--stream.expanded"
      );
      siblings?.forEach((el) => {
        if (el !== item) {
          el.classList.remove("expanded");
          collapseStreamWidgets(el);
        }
      });
      item.classList.toggle("expanded", willExpand);
      if (willExpand) {
        item
          .querySelector(".knoww-stream-bet")
          ?.dispatchEvent(new CustomEvent("knoww-stream-expanded"));
      } else {
        collapseStreamWidgets(item);
      }
    };
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        item.click();
      }
    });
    return item;
  }
  item.appendChild(pricesDiv);

  // Click handler to scroll to the market card, or open URL if card is gone
  item.onclick = () => {
    void window.KNOWW_ANALYTICS?.track("notification_stack_item_clicked", {
      marketId: market.id,
      source: marketSource,
      itemStatus: isActive ? "active" : "scrolled_out",
    });
    if (!isActive) {
      const restored =
        postKey &&
        window.KNOWW_INJECTION?.restoreTrackedMarket?.(postKey, market.id);
      if (restored) {
        scrollToMarket(null, market.id, market, postKey);
      } else {
        const marketUrl = buildMarketUrl(market);
        log("Opening scrolled-out market directly:", marketUrl);
        window.open(marketUrl, "_blank", "noopener,noreferrer");
      }
      window.KNOWW_PREFERENCES?.recordClick(market);
      return;
    }
    scrollToMarket(
      cardRef as WeakRef<HTMLElement> | null,
      market.id,
      market,
      postKey
    );
    window.KNOWW_PREFERENCES?.recordClick(market);
  };
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      item.click();
    }
  });

  return item;
}

/**
 * Create a section header within the notification stack list.
 * `kind` controls the dot color: green for active/trending, gray otherwise.
 */
function createNotificationSectionHeader(
  title: string,
  count: number,
  kind: "active" | "scrolled-out" | "trending" = "scrolled-out"
): HTMLElement {
  const header = document.createElement("div");
  header.className = "knoww-stack-section-header";
  const countLabel = count < 10 ? `0${count}` : String(count);
  header.innerHTML = `
    <span class="knoww-stack-section-title">
      <span class="knoww-stack-section-dot ${kind}" aria-hidden="true"></span>
      <span>${title}</span>
    </span>
    <span class="knoww-stack-section-count">${countLabel}</span>
  `;
  return header;
}

/**
 * Truncate text with ellipsis
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

export function showScrollToast(message: string): void {
  const existing = document.querySelector(".knoww-scroll-toast");
  existing?.remove();

  const toast = document.createElement("div");
  toast.className = "knoww-scroll-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("knoww-toast-hide");
    setTimeout(() => toast.remove(), 350);
  }, 2600);
}

/**
 * Scroll to a market card in the feed.
 * If the card has been removed from the DOM (host site virtualization / GC),
 * opens the market URL directly in a new tab so the user is never stuck.
 */
export function scrollToMarket(
  cardRefOrElement: WeakRef<HTMLElement> | HTMLElement | null | undefined,
  marketId: string,
  market?: Market,
  postKey?: string
): void {
  const { log } = window.KNOWW_UTILS;

  let targetCard: HTMLElement | undefined | null =
    cardRefOrElement && "deref" in cardRefOrElement
      ? cardRefOrElement.deref()
      : (cardRefOrElement as HTMLElement | null);

  if (
    !targetCard ||
    !(targetCard instanceof Node) ||
    !document.body.contains(targetCard)
  ) {
    const escapedMarketId = escapeSelectorValue(marketId);
    const escapedPostKey = postKey ? escapeSelectorValue(postKey) : undefined;
    const scopedSelector = postKey
      ? `.knoww-market-card[data-knoww-market-id="${escapedMarketId}"][data-knoww-post-key="${escapedPostKey}"]`
      : `[data-knoww-market-id="${escapedMarketId}"]`;
    targetCard = document.querySelector(scopedSelector) as HTMLElement | null;
  }

  if (
    !targetCard ||
    !(targetCard instanceof Node) ||
    !document.body.contains(targetCard)
  ) {
    const restored =
      postKey &&
      window.KNOWW_INJECTION?.restoreTrackedMarket?.(postKey, marketId);
    if (restored) {
      const escapedMarketId = escapeSelectorValue(marketId);
      const escapedPostKey = postKey ? escapeSelectorValue(postKey) : undefined;
      const restoredSelector = postKey
        ? `.knoww-market-card[data-knoww-market-id="${escapedMarketId}"][data-knoww-post-key="${escapedPostKey}"]`
        : `[data-knoww-market-id="${escapedMarketId}"]`;
      targetCard = document.querySelector(
        restoredSelector
      ) as HTMLElement | null;
    }
  }

  if (
    !targetCard ||
    !(targetCard instanceof Node) ||
    !document.body.contains(targetCard)
  ) {
    // Card is no longer in the DOM — open the market URL directly
    log("Card not in DOM, opening market URL in new tab");
    if (market) {
      const url = buildMarketUrl(market);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
    }
    // Final fallback: no market data available
    log("No market data available to build URL");
    return;
  }

  targetCard.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

/**
 * Check if a card element is still in the DOM and visible
 */
function isCardStillAvailable(
  cardRef: InjectedMarketEntry["cardRef"],
  marketTitle?: string
): boolean {
  const noop = () => {};
  const { log } = window.KNOWW_UTILS || { log: noop };
  const shortTitle = marketTitle ? marketTitle.slice(0, 30) : "Unknown";

  const cardElement = cardRef?.deref?.();

  // Card was garbage collected or doesn't exist
  if (!cardElement) {
    log(`🗑️ [NotificationFilter] Card GC'd/missing: "${shortTitle}..."`);
    return false;
  }

  // Card is no longer in the DOM
  if (!document.body.contains(cardElement)) {
    log(
      `📜 [NotificationFilter] Card scrolled away (not in DOM): "${shortTitle}..."`
    );
    return false;
  }

  log(`✅ [NotificationFilter] Card still available: "${shortTitle}..."`);
  return true;
}

function isCardInViewport(cardElement: HTMLElement): boolean {
  const rect = cardElement.getBoundingClientRect();
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  if (width === 0 || height === 0) return false;

  const visibleWidth = Math.max(
    0,
    Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)
  );
  const visibleHeight = Math.max(
    0,
    Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
  );
  const visibleRatio = (visibleWidth * visibleHeight) / (width * height);

  return visibleRatio >= 0.25;
}

interface ClassifiedInjectedMarketEntry {
  entry: InjectedMarketEntry;
  status: "active" | "scrolled-out";
}

function classifyInjectedMarketEntry(
  marketData: InjectedMarketEntry,
  now: number
): ClassifiedInjectedMarketEntry {
  // Streaming-surface markets have no injected post card to track — they are
  // always "active" (the stream is what's live), so skip the DOM availability
  // checks that would otherwise classify them as scrolled-out.
  if (marketData.isStreamSurface) {
    marketData.isInViewport = true;
    marketData.lastVisibleAt = now;
    return { entry: marketData, status: "active" };
  }

  const isCardAvailable = isCardStillAvailable(
    marketData.cardRef,
    marketData.market.title
  );
  const cardElement = marketData.cardRef?.deref?.();
  const currentlyInViewport =
    !!cardElement && isCardAvailable && isCardInViewport(cardElement);

  if (currentlyInViewport) {
    marketData.isInViewport = true;
    marketData.lastVisibleAt = now;
  }

  const isVisible =
    currentlyInViewport ||
    (typeof marketData.isInViewport === "boolean"
      ? marketData.isInViewport
      : true);
  const lastVisibleAt = marketData.lastVisibleAt ?? marketData.timestamp;
  const recentlyVisible = now - lastVisibleAt <= SCROLLED_OUT_GRACE_MS;
  const status =
    isCardAvailable && (isVisible || recentlyVisible)
      ? "active"
      : "scrolled-out";

  return { entry: marketData, status };
}

function selectRepresentativeMarketEntries(markets: InjectedMarketEntry[]): {
  activeMarkets: InjectedMarketEntry[];
  scrolledOutMarkets: InjectedMarketEntry[];
} {
  const now = Date.now();
  const representatives = new Map<string, ClassifiedInjectedMarketEntry>();

  for (const marketData of markets) {
    if (!marketData?.market?.id) continue;
    if (!isMarketWithinDisplayPriceCap(marketData.market)) continue;

    const classified = classifyInjectedMarketEntry(marketData, now);
    const current = representatives.get(marketData.market.id);

    if (!current) {
      representatives.set(marketData.market.id, classified);
      continue;
    }

    if (current.status !== "active" && classified.status === "active") {
      representatives.set(marketData.market.id, classified);
      continue;
    }

    if (
      current.status === classified.status &&
      classified.entry.timestamp > current.entry.timestamp
    ) {
      representatives.set(marketData.market.id, classified);
    }
  }

  const selected = Array.from(representatives.values()).sort(
    (a, b) => a.entry.timestamp - b.entry.timestamp
  );

  return {
    activeMarkets: selected
      .filter((marketData) => marketData.status === "active")
      .map((marketData) => marketData.entry),
    scrolledOutMarkets: selected
      .filter((marketData) => marketData.status === "scrolled-out")
      .map((marketData) => marketData.entry),
  };
}

/**
 * Switch the notification stack content area between the empty state
 * and the items list. Only one is visible at a time.
 *
 * Uses setProperty with "important" because the stylesheet declares
 * display with !important to resist host-page overrides — a plain
 * inline style (element.style.display = "none") would lose to it.
 */
function showNotificationContent(view: "empty" | "items"): void {
  const itemsContainer = document.getElementById("knoww-stack-items");
  const emptyState = document.getElementById("knoww-stack-empty");
  if (!itemsContainer || !emptyState) return;

  if (view === "items") {
    emptyState.style.setProperty("display", "none", "important");
    itemsContainer.style.removeProperty("display");
  } else {
    itemsContainer.style.setProperty("display", "none", "important");
    emptyState.style.removeProperty("display");
    if (isStreamSurface()) applyStreamEmptyState(emptyState);
  }
}

/**
 * Rewrite the empty state for a streaming surface: it's not "scanning a feed",
 * it's "this game has no markets". Shows a static message and drops the feed-
 * oriented loading dots (trending is suppressed here).
 */
function applyStreamEmptyState(emptyState: HTMLElement): void {
  const welcome = emptyState.querySelector<HTMLElement>("[data-knoww-welcome]");
  const scanning = emptyState.querySelector<HTMLElement>(
    "[data-knoww-scanning]"
  );
  if (welcome) welcome.style.setProperty("display", "none", "important");
  if (scanning) scanning.style.removeProperty("display");

  const title = emptyState.querySelector(".knoww-stack-empty-title");
  if (title) title.textContent = "No markets for this stream";
  const sub = emptyState.querySelector(".knoww-stack-empty-sub");
  if (sub) {
    sub.textContent = "This game has no live prediction markets right now.";
  }
  for (const sel of [".knoww-stack-empty-dots", ".knoww-stack-empty-pulse"]) {
    emptyState
      .querySelector<HTMLElement>(sel)
      ?.style.setProperty("display", "none", "important");
  }
}

/**
 * Create a notification item for a trending market (fallback display)
 */
function createTrendingMarketItem(market: Market, index: number): HTMLElement {
  const marketSource = market.source || "polymarket";

  const item = document.createElement("div");
  item.className = `knoww-notification-item knoww-trending-item knoww-source-${marketSource} knoww-notification-active`;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("data-market-id", market.id);
  item.setAttribute("data-market-source", marketSource);
  item.setAttribute("aria-label", `Open ${market.title || "trending market"}`);
  item.style.animationDelay = `${index * 60}ms`;

  const icon = renderRowThumbnail(market);

  const content = document.createElement("div");
  content.className = "knoww-notification-content";

  const title = document.createElement("div");
  title.className = "knoww-notification-title";
  title.textContent = market.title || "Untitled Market";

  const meta = document.createElement("div");
  meta.className = "knoww-notification-meta";
  const categoryLabel = market.category || market.tags?.[0]?.label || "";
  const volumeLabel = formatMarketVolume(market);
  if (categoryLabel) {
    const cat = document.createElement("span");
    cat.textContent = categoryLabel;
    meta.appendChild(cat);
  }
  if (categoryLabel && volumeLabel) {
    const dot = document.createElement("span");
    dot.className = "knoww-notification-meta-dot";
    meta.appendChild(dot);
  }
  if (volumeLabel) {
    const vol = document.createElement("span");
    vol.textContent = volumeLabel;
    meta.appendChild(vol);
  }

  const pricesDiv = document.createElement("div");
  pricesDiv.className = "knoww-notification-prices";

  const parsed = parseMultiOutcomeData(market);
  let outcomes = parsed.outcomes;
  let priceData: number[] = parsed.prices;

  if (!parsed.isMultiOutcome && market.markets && market.markets.length > 0) {
    const firstMarket =
      market.markets[parsed.firstActiveMarketIndex] ?? market.markets[0];
    if (firstMarket.outcomePrices) {
      priceData = parseGammaPriceArray(firstMarket.outcomePrices);
    }
    if (firstMarket.outcomes) {
      outcomes = parseGammaStringArray(firstMarket.outcomes);
    }
    if (outcomes.length === 0 || priceData.length === 0) {
      outcomes = ["Yes", "No"];
      priceData = [0.5, 0.5];
    }
  }

  if (outcomes.length === 0) {
    outcomes = ["Yes", "No"];
    priceData = [0.5, 0.5];
  }

  renderEditorialPrice(pricesDiv, outcomes, priceData);

  content.appendChild(title);
  if (meta.childNodes.length > 0) content.appendChild(meta);

  item.appendChild(icon);
  item.appendChild(content);
  item.appendChild(pricesDiv);

  item.onclick = () => {
    void window.KNOWW_ANALYTICS?.track("notification_trending_clicked", {
      marketSlug: market.slug || market.id,
    });
    const marketUrl = buildMarketUrl(market);
    window.open(marketUrl, "_blank", "noopener,noreferrer");
    window.KNOWW_PREFERENCES?.recordClick(market);
  };
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      item.click();
    }
  });

  return item;
}

/**
 * Pick MAX_TRENDING_DISPLAY random markets from the pool
 * using a Fisher-Yates partial shuffle (no array copy needed).
 */
function pickRandomTrending(): Market[] {
  if (trendingPool.length <= MAX_TRENDING_DISPLAY) return [...trendingPool];

  const indices = Array.from({ length: trendingPool.length }, (_, i) => i);
  for (
    let i = indices.length - 1;
    i > indices.length - 1 - MAX_TRENDING_DISPLAY;
    i--
  ) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices
    .slice(indices.length - MAX_TRENDING_DISPLAY)
    .map((i) => trendingPool[i]);
}

/**
 * Shuffle the visible trending pair and refresh the notification stack.
 */
function shuffleTrending(): void {
  const { log } = window.KNOWW_UTILS;

  if (trendingPool.length <= MAX_TRENDING_DISPLAY) return;

  visibleTrending = pickRandomTrending();
  log(
    `🔀 [Trending] Shuffled — now showing: ${visibleTrending.map((m) => m.title?.slice(0, 30)).join(", ")}`
  );

  const currentMarkets = getStackBaseMarkets();
  updateNotificationStack(currentMarkets);
}

/**
 * Fetch trending markets, cache the full pool, pick 2 to display,
 * and start the 60-second shuffle interval.
 */
export async function fetchAndCacheTrending(): Promise<void> {
  const { log } = window.KNOWW_UTILS;

  // Streaming surfaces only show markets relevant to the stream — no trending.
  if (isStreamSurface()) return;
  if (trendingFetchInFlight) return;
  trendingFetchInFlight = true;
  log("🔥 [Trending] Fetching trending markets...");

  try {
    const { fetchTrendingMarkets } = window.KNOWW_API;
    const trending = await fetchTrendingMarkets();
    trendingPool = trending.filter(isMarketWithinDisplayPriceCap);
    visibleTrending = pickRandomTrending();
    log(
      `🔥 [Trending] Pool: ${trendingPool.length}, showing: ${visibleTrending.length}`
    );

    startTrendingShuffleTimer();

    const currentMarkets = getStackBaseMarkets();
    updateNotificationStack(currentMarkets);
  } catch (e) {
    log("🔥 [Trending] Failed to fetch trending markets:", e);
  } finally {
    trendingFetchInFlight = false;
  }
}

/**
 * Start the 60-second shuffle interval.
 */
function startTrendingShuffleTimer(): void {
  if (trendingShuffleTimer) return;
  if (trendingPool.length <= MAX_TRENDING_DISPLAY) return;

  trendingShuffleTimer = setInterval(
    shuffleTrending,
    TRENDING_SHUFFLE_INTERVAL_MS
  );
}

/**
 * Stop the shuffle interval.
 */
function stopTrendingShuffleTimer(): void {
  if (trendingShuffleTimer) {
    clearInterval(trendingShuffleTimer);
    trendingShuffleTimer = null;
  }
}

function getVisibleTrendingMarkets(
  realMarketIds: Set<string>,
  expandedTrending: boolean,
  limitOverride?: number
): Market[] {
  const requestedLimit =
    typeof limitOverride === "number" && limitOverride > 0
      ? Math.floor(limitOverride)
      : undefined;
  const limit =
    requestedLimit ??
    (expandedTrending ? MAX_EXPANDED_TRENDING_DISPLAY : MAX_TRENDING_DISPLAY);
  const cappedLimit = Math.min(limit, MAX_EXPANDED_TRENDING_DISPLAY);
  const source =
    expandedTrending || cappedLimit > MAX_TRENDING_DISPLAY
      ? trendingPool
      : visibleTrending;

  return source
    .filter(
      (market) =>
        isMarketWithinDisplayPriceCap(market) && !realMarketIds.has(market.id)
    )
    .slice(0, cappedLimit);
}

/**
 * Append the trending section to the items container.
 * Skips any trending market whose id already appears in the
 * real-market set to avoid duplicates.
 */
function appendTrendingSection(
  itemsContainer: HTMLElement,
  realMarketIds: Set<string>,
  animationIndex: number,
  expandedTrending = false
): number {
  const trendingToShow = getVisibleTrendingMarkets(
    realMarketIds,
    expandedTrending
  );

  if (trendingToShow.length === 0) return animationIndex;

  const header = createNotificationSectionHeader(
    "Trending now",
    trendingToShow.length,
    "trending"
  );
  header.classList.add("knoww-trending-header");
  itemsContainer.appendChild(header);

  trendingToShow.forEach((market, index) => {
    const item = createTrendingMarketItem(market, animationIndex + index);
    itemsContainer.appendChild(item);
  });

  return animationIndex + trendingToShow.length;
}

/**
 * Schedule the initial trending fetch on the next task so panel setup can
 * finish without withholding useful markets from the user.
 */
function startTrendingFetchTimer(): void {
  // No trending on streaming surfaces.
  if (isStreamSurface()) return;
  if (trendingPool.length > 0 || trendingFetchTimer || trendingFetchInFlight) {
    return;
  }

  trendingFetchTimer = setTimeout(() => {
    trendingFetchTimer = null;
    fetchAndCacheTrending();
  }, TRENDING_FETCH_DELAY_MS);
}

/**
 * Cancel the trending fetch timer and shuffle interval.
 */
export function cancelTrendingFetchTimer(): void {
  stopTrendingShuffleTimer();
  if (trendingFetchTimer) {
    clearTimeout(trendingFetchTimer);
    trendingFetchTimer = null;
  }
}

// On streaming surfaces (Twitch/YouTube) there is no feed scan, so the
// canonical `getInjectedMarkets()` store is empty. The streaming module pushes
// its markets here instead; when set, every internal stack refresh (trending
// fetch, shuffle, theme/resize re-render, snapshots) reads from this store so
// the stream markets are never clobbered by an empty feed store.
let streamMarketEntries: InjectedMarketEntry[] | null = null;
// True while an inline deposit owns a stream card. Suppresses the periodic
// stack rebuild so a price refresh can't wipe the in-progress deposit form.
let streamInlineDepositOwner: HTMLElement | null = null;

export function setStreamInlineDepositActive(
  owner: HTMLElement,
  active: boolean
): boolean {
  if (active) {
    streamInlineDepositOwner = owner;
    return true;
  }
  if (streamInlineDepositOwner !== owner) return false;
  streamInlineDepositOwner = null;
  return true;
}
// Whether the "Other markets" dropdown on a stream surface is expanded. Default
// collapsed; remembered across price refreshes and SPA navigation within the
// session (the content script stays alive, so a module flag is enough).
let streamOthersExpanded = false;

/**
 * Render the stream-surface active section: the watched match (entry[0]) is
 * featured on top, every other market is tucked into a collapsible "Other
 * markets" dropdown. Returns the next animation index.
 */
function renderStreamActiveSection(
  container: HTMLElement,
  entries: InjectedMarketEntry[],
  startIndex: number
): number {
  let index = startIndex;
  const featured = entries[0];
  const others = entries.slice(1);

  container.appendChild(
    createNotificationSectionHeader("Live now", entries.length, "active")
  );
  container.appendChild(createNotificationItem(featured, index++, true));

  if (others.length === 0) return index;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "knoww-stream-others-toggle";
  toggle.innerHTML = `
    <span class="knoww-stream-others-label">
      <span class="knoww-stream-others-chevron" aria-hidden="true">▾</span>
      <span>Other markets</span>
    </span>
    <span class="knoww-stream-others-count">${others.length}</span>
  `;

  const list = document.createElement("div");
  list.className = "knoww-stream-others-list";
  others.forEach((entry) => {
    list.appendChild(createNotificationItem(entry, index++, true));
  });

  const applyExpanded = (): void => {
    toggle.classList.toggle("expanded", streamOthersExpanded);
    list.classList.toggle("expanded", streamOthersExpanded);
    toggle.setAttribute("aria-expanded", String(streamOthersExpanded));
    // Expanding grows the list past the stack's max-height, but the scroll
    // class is only set during updateNotificationStack (when collapsed → fits).
    // Re-evaluate now so the expanded list is actually scrollable.
    const items = document.getElementById("knoww-stack-items");
    if (items) {
      items.classList.toggle(
        "knoww-has-overflow",
        items.scrollHeight > items.clientHeight
      );
    }
  };
  applyExpanded();

  toggle.onclick = (e) => {
    e.stopPropagation();
    streamOthersExpanded = !streamOthersExpanded;
    if (!streamOthersExpanded) collapseStreamWidgets(list);
    applyExpanded();
  };

  container.appendChild(toggle);
  container.appendChild(list);
  return index;
}

/** True on streaming surfaces (Twitch/YouTube). Trending is suppressed there. */
function isStreamSurface(): boolean {
  return window.KNOWW_PLATFORM?.getCurrentPlatform?.()?.surface === "stream";
}

function getStackBaseMarkets(): InjectedMarketEntry[] {
  if (streamMarketEntries) return streamMarketEntries;
  return window.KNOWW_INJECTION?.getInjectedMarkets?.() || [];
}

/**
 * Set the markets for a streaming surface and render them. This is the entry
 * point the streaming module calls instead of feeding the per-post scan.
 */
export function setStreamMarkets(markets: InjectedMarketEntry[]): void {
  streamMarketEntries = markets;
  updateNotificationStack(markets);
}

/**
 * Update the notification stack with current markets
 */
export function updateNotificationStack(markets: InjectedMarketEntry[]): void {
  const { log } = window.KNOWW_UTILS;

  // Don't rebuild the stack while an inline deposit is mid-flow — it would
  // destroy the deposit form's DOM (and state) on the next price refresh.
  if (streamInlineDepositOwner !== null) {
    log("📋 [NotificationStack] Skipped rebuild — inline deposit active");
    return;
  }

  log(`\n📋 [NotificationStack] ========== UPDATE START ==========`);
  log(
    `📋 [NotificationStack] Total markets in tracking array: ${markets.length}`
  );

  if (!notificationStackContainer) {
    createNotificationStack();
  }

  const itemsContainer = document.getElementById("knoww-stack-items");
  const emptyState = document.getElementById("knoww-stack-empty");

  if (!itemsContainer || !emptyState) {
    log(`⏳ [NotificationStack] Containers not ready, retrying in 100ms...`);
    setTimeout(() => updateNotificationStack(markets), 100);
    return;
  }

  log(
    `🔍 [NotificationFilter] Checking availability for ${markets.length} tracked entries:`
  );

  // Deduplicate by market id (prefer visible active cards).
  const { activeMarkets, scrolledOutMarkets } =
    selectRepresentativeMarketEntries(markets);

  // Keep bounded lists for readability (platform-aware caps)
  const caps = resolveNotificationCaps();
  const recentActiveMarkets = cachedStackExpanded
    ? [...activeMarkets].reverse()
    : activeMarkets.slice(-caps.active).reverse();
  const recentScrolledMarkets = cachedStackExpanded
    ? [...scrolledOutMarkets].reverse()
    : scrolledOutMarkets.slice(-caps.scrolled).reverse();
  const activeFilter = cachedStackExpanded ? cachedStackFilter : "all";
  const showActiveSection = activeFilter === "all" || activeFilter === "active";
  const showSeenSection = activeFilter === "all" || activeFilter === "seen";
  const showTrendingSection =
    !isStreamSurface() &&
    (activeFilter === "all" || activeFilter === "trending");
  const displayedActiveMarkets = showActiveSection ? recentActiveMarkets : [];
  const displayedScrolledMarkets = showSeenSection ? recentScrolledMarkets : [];

  const totalDisplayed =
    displayedActiveMarkets.length + displayedScrolledMarkets.length;

  if (
    totalDisplayed === 0 &&
    (!showTrendingSection || visibleTrending.length === 0)
  ) {
    log(`📭 [NotificationStack] No markets to show, displaying empty state`);
    disposeStreamControllers(itemsContainer);
    itemsContainer.innerHTML = "";
    showNotificationContent("empty");
    log(`📋 [NotificationStack] ========== UPDATE END ==========\n`);
    return;
  }

  // Markets to display (real and/or trending)
  disposeStreamControllers(itemsContainer);
  itemsContainer.innerHTML = "";
  showNotificationContent("items");

  log(`\n📊 [NotificationFilter] SUMMARY:`);
  log(`   • Total markets tracked: ${markets.length}`);
  log(
    `   • Unique markets tracked: ${activeMarkets.length + scrolledOutMarkets.length}`
  );
  log(`   • Active markets: ${activeMarkets.length}`);
  log(`   • Scrolled-out markets: ${scrolledOutMarkets.length}`);
  log(`   • Displayed in stack: ${totalDisplayed}`);

  let animationIndex = 0;

  if (displayedActiveMarkets.length > 0) {
    if (isStreamSurface()) {
      // Stream: feature the watched match, collapse the rest into a dropdown.
      animationIndex = renderStreamActiveSection(
        itemsContainer,
        displayedActiveMarkets,
        animationIndex
      );
    } else {
      itemsContainer.appendChild(
        createNotificationSectionHeader(
          "Active now",
          displayedActiveMarkets.length,
          "active"
        )
      );
      displayedActiveMarkets.forEach((marketData) => {
        const item = createNotificationItem(marketData, animationIndex, true);
        animationIndex++;
        itemsContainer.appendChild(item);
      });
    }
  }

  // Trending appears between active markets and seen-earlier markets.
  // Collect real market IDs so we can skip duplicates.
  const realMarketIds = new Set<string>();
  for (const entry of [...activeMarkets, ...scrolledOutMarkets]) {
    realMarketIds.add(entry.market.id);
  }
  if (showTrendingSection) {
    animationIndex = appendTrendingSection(
      itemsContainer,
      realMarketIds,
      animationIndex,
      cachedStackExpanded && activeFilter === "trending"
    );
  }

  if (displayedScrolledMarkets.length > 0) {
    itemsContainer.appendChild(
      createNotificationSectionHeader(
        "Seen earlier",
        displayedScrolledMarkets.length,
        "scrolled-out"
      )
    );
    displayedScrolledMarkets.forEach((marketData) => {
      const item = createNotificationItem(marketData, animationIndex, false);
      animationIndex++;
      itemsContainer.appendChild(item);
    });
  }

  setTimeout(() => {
    if (itemsContainer.scrollHeight > itemsContainer.clientHeight) {
      itemsContainer.classList.add("knoww-has-overflow");
    } else {
      itemsContainer.classList.remove("knoww-has-overflow");
    }
  }, 50);

  log(`📋 [NotificationStack] ========== UPDATE END ==========\n`);
}

/**
 * Update the notification stack theme based on current platform theme
 */
export function updateNotificationStackTheme(): void {
  if (!notificationStackContainer) return;

  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  if (!platform || typeof platform.detectTheme !== "function") return;

  const theme = platform.detectTheme();
  const platformName = window.KNOWW_PLATFORM?.getPlatformName?.() || "unknown";

  // Remove existing theme classes
  notificationStackContainer.classList.remove(
    "knoww-theme-dark",
    "knoww-theme-light",
    "knoww-theme-dim"
  );

  // Add the current theme class
  notificationStackContainer.classList.add(`knoww-theme-${theme}`);
  applyPlatformStyleVariables(
    notificationStackContainer,
    platform.getCardStyles?.(theme)
  );

  // Ensure the platform class is set
  if (
    !notificationStackContainer.classList.contains(
      `knoww-notification-stack-${platformName}`
    )
  ) {
    notificationStackContainer.classList.add(
      `knoww-notification-stack-${platformName}`
    );
  }
}

function openNotificationStack(
  log: (...args: unknown[]) => void,
  created = false
): void {
  ensureNotificationStackLifecyclePort();

  if (!notificationStackContainer) {
    createNotificationStack();
    created = true;
  } else {
    notificationStackContainer.style.removeProperty("display");
  }

  if (created) {
    void window.KNOWW_ANALYTICS?.track("notification_stack_opened");
    log("Notification stack initialized");
  }

  // Start trending discovery on the next task. Feed-discovered markets keep
  // display priority when both sources have results.
  startTrendingFetchTimer();
  log("Trending markets fetch scheduled immediately");

  // Update theme immediately after creation (DOM might be more ready now)
  setTimeout(() => {
    updateNotificationStackTheme();
    log("Notification stack theme updated");
  }, 100);

  // Also update theme after a longer delay to catch late theme detection
  setTimeout(() => {
    updateNotificationStackTheme();
  }, 1000);

  // Guard: only attach global listeners/observers once to prevent accumulation on re-init
  if (!notificationStackListenersAttached) {
    notificationStackListenersAttached = true;
    document.addEventListener("keydown", handleNotificationStackKeydown);

    // PERFORMANCE: Debounce theme observer — theme changes are rare,
    // but body class/style mutations fire frequently on Twitter.
    let themeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedThemeUpdate = (): void => {
      if (themeDebounceTimer) clearTimeout(themeDebounceTimer);
      themeDebounceTimer = setTimeout(updateNotificationStackTheme, 500);
    };

    // Watch for theme changes via MutationObserver on body/html
    const observer = new MutationObserver(debouncedThemeUpdate);

    // Observe body for class/style changes (Twitter changes body background for themes)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    // Also observe html element
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }

    // Watch for prefers-color-scheme changes
    if (window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", debouncedThemeUpdate);
    }

    window.addEventListener("resize", () => {
      if (notificationStackContainer) {
        clampNotificationStackToViewport(notificationStackContainer);
      }
    });

    // ============================================
    // DRAGGABLE NOTIFICATION STACK (all platforms)
    // ============================================
    setupDraggable(log);
  }
}

/**
 * Initialize the notification stack
 */
export function setNotificationStackVisibility(visible: boolean): void {
  if (visible) {
    persistStackDismissed(false);
    ensureNotificationStackLifecyclePort();
    openNotificationStack(window.KNOWW_UTILS.log);
    if (notificationStackContainer) {
      resetNotificationStackToPreferredPosition(notificationStackContainer);
    }
    return;
  }

  persistStackDismissed(true);
  disconnectNotificationStackLifecyclePort();
  if (notificationStackContainer) {
    notificationStackContainer.style.setProperty(
      "display",
      "none",
      "important"
    );
  }
}

function summarizeSnapshotMarket(
  market: Market,
  status: "active" | "seen" | "trending"
): Record<string, string> {
  const parsed = parseMultiOutcomeData(market);
  let outcomes = parsed.outcomes;
  let prices = parsed.prices;

  if (!parsed.isMultiOutcome && market.markets?.length) {
    const firstMarket =
      market.markets[parsed.firstActiveMarketIndex] ?? market.markets[0];
    if (firstMarket.outcomePrices) {
      prices = parseGammaPriceArray(firstMarket.outcomePrices);
    }
    if (firstMarket.outcomes) {
      outcomes = parseGammaStringArray(firstMarket.outcomes);
    }
  }

  let leadingIdx = 0;
  let leadingPriceDecimal = toDecimal(prices[0]) ?? new Decimal(0);
  for (let i = 1; i < prices.length; i++) {
    const candidatePrice = toDecimal(prices[i]) ?? new Decimal(0);
    if (candidatePrice.gt(leadingPriceDecimal)) {
      leadingIdx = i;
      leadingPriceDecimal = candidatePrice;
    }
  }
  const priceCents = Decimal.max(
    0,
    Decimal.min(99, leadingPriceDecimal.mul(100))
  )
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toString();
  const priceSideLabel =
    outcomes[leadingIdx] || (outcomes.length === 2 ? "Yes" : "Top");

  return {
    id: market.id,
    title: market.title || "Untitled market",
    source: market.source || "polymarket",
    imageUrl: market.image || "",
    volume: formatMarketVolume(market) || "",
    category: market.category || market.tags?.[0]?.label || "",
    priceCents,
    priceSideLabel,
    status,
    url: buildMarketUrl(market),
  };
}

function summarizeNotificationMarket(
  entry: InjectedMarketEntry,
  status: "active" | "seen"
): Record<string, string> {
  return summarizeSnapshotMarket(entry.market, status);
}

export function getNotificationStackSnapshot(
  trendingLimit?: number
): Record<string, unknown> {
  startTrendingFetchTimer();
  const markets = getStackBaseMarkets();
  const { activeMarkets, scrolledOutMarkets } =
    selectRepresentativeMarketEntries(markets);
  const realMarketIds = new Set<string>();
  for (const entry of [...activeMarkets, ...scrolledOutMarkets]) {
    realMarketIds.add(entry.market.id);
  }
  const trendingMarkets = getVisibleTrendingMarkets(
    realMarketIds,
    false,
    trendingLimit
  );
  return {
    platform: window.KNOWW_PLATFORM?.getPlatformName?.() || "unknown",
    active: activeMarkets
      .slice(-8)
      .reverse()
      .map((entry) => summarizeNotificationMarket(entry, "active")),
    seen: scrolledOutMarkets
      .slice(-8)
      .reverse()
      .map((entry) => summarizeNotificationMarket(entry, "seen")),
    trending: trendingMarkets.map((market) =>
      summarizeSnapshotMarket(market, "trending")
    ),
  };
}

export async function searchNotificationStackMarkets(
  query: string
): Promise<Record<string, string>[]> {
  const events = await window.KNOWW_API.searchPolymarketEvents(query, []);
  return events
    .filter(isMarketWithinDisplayPriceCap)
    .slice(0, 5)
    .map((market) => summarizeSnapshotMarket(market, "trending"));
}

export function focusNotificationStackMarket(marketId: string): boolean {
  const markets = getStackBaseMarkets();
  const { activeMarkets, scrolledOutMarkets } =
    selectRepresentativeMarketEntries(markets);
  const injectedEntry = [...activeMarkets, ...scrolledOutMarkets].find(
    (entry) => entry.market.id === marketId
  );

  if (injectedEntry) {
    void window.KNOWW_ANALYTICS?.track("notification_sidepanel_item_clicked", {
      marketId,
      source: injectedEntry.market.source || "polymarket",
    });
    scrollToMarket(
      injectedEntry.cardRef as WeakRef<HTMLElement> | null,
      injectedEntry.market.id,
      injectedEntry.market,
      injectedEntry.postKey
    );
    window.KNOWW_PREFERENCES?.recordClick(injectedEntry.market);
    return true;
  }

  const trendingMarket = [...visibleTrending, ...trendingPool].find(
    (market) => market.id === marketId
  );
  if (trendingMarket) {
    void window.KNOWW_ANALYTICS?.track(
      "notification_sidepanel_trending_clicked",
      {
        marketSlug: trendingMarket.slug || trendingMarket.id,
      }
    );
    window.open(
      buildMarketUrl(trendingMarket),
      "_blank",
      "noopener,noreferrer"
    );
    window.KNOWW_PREFERENCES?.recordClick(trendingMarket);
    return true;
  }

  return false;
}

export function initNotificationStack(): void {
  const { log } = window.KNOWW_UTILS;

  void readPersistedStackDismissed().then((dismissed) => {
    if (dismissed) return;
    createNotificationStack();
    openNotificationStack(log, true);
  });
}

export interface NotificationUiMessage {
  type?: string;
  marketId?: string;
  query?: string;
  visible?: boolean;
  trendingLimit?: number;
}

export function handleNotificationMessage(
  message: NotificationUiMessage,
  sendResponse: (response: { success: boolean; data?: unknown }) => void
): boolean | null {
  if (message?.type === "KNOWW_OPEN_EXTENSION") {
    setNotificationStackVisibility(true);
    sendResponse({ success: true });
    return true;
  }

  if (message?.type === "KNOWW_SET_NOTIFICATION_STACK_VISIBILITY") {
    setNotificationStackVisibility(message.visible !== false);
    sendResponse({ success: true });
    return true;
  }

  if (message?.type === "KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT") {
    sendResponse({
      success: true,
      data: getNotificationStackSnapshot(message.trendingLimit),
    });
    return true;
  }

  if (message?.type === "KNOWW_FOCUS_NOTIFICATION_MARKET") {
    sendResponse({
      success:
        typeof message.marketId === "string" &&
        focusNotificationStackMarket(message.marketId),
    });
    return true;
  }

  if (message?.type === "KNOWW_SEARCH_NOTIFICATION_MARKETS") {
    const query = typeof message.query === "string" ? message.query : "";
    void searchNotificationStackMarkets(query)
      .then((data) => sendResponse({ success: true, data }))
      .catch(() => sendResponse({ success: false, data: [] }));
    return true;
  }

  return null;
}

// ============================================
// DRAGGABLE NOTIFICATION STACK
// Makes the notification stack draggable via its header
// ============================================

/**
 * Make the notification stack draggable via its header.
 */
function setupDraggable(log: (...args: unknown[]) => void): void {
  if (!notificationStackContainer) return;

  const header = notificationStackContainer.querySelector(
    ".knoww-stack-header"
  ) as HTMLElement | null;
  if (!header) return;

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let activePointerId: number | null = null;

  // Pointer Events + setPointerCapture: unlike document-level mousemove, this
  // keeps every move event routed to the header even while the cursor passes
  // over the video player / iframes / other pointer-capturing elements (which
  // is exactly what swallows a mouse-event drag on Twitch/YouTube).
  header.addEventListener("pointerdown", (e: PointerEvent) => {
    if (!notificationStackContainer || e.button !== 0) return;

    // Don't drag when starting on a button inside the header.
    if ((e.target as Element).closest("button")) return;

    const rect = notificationStackContainer.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    isDragging = true;
    activePointerId = e.pointerId;
    try {
      header.setPointerCapture(e.pointerId);
    } catch {
      // capture is best-effort
    }

    notificationStackContainer.classList.add("knoww-dragging");
    e.preventDefault();
  });

  header.addEventListener("pointermove", (e: PointerEvent) => {
    if (!isDragging || !notificationStackContainer) return;

    const rect = notificationStackContainer.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width;
    const maxTop = window.innerHeight - rect.height;
    const newLeft = Math.max(0, Math.min(e.clientX - dragOffsetX, maxLeft));
    const newTop = Math.max(0, Math.min(e.clientY - dragOffsetY, maxTop));

    // setProperty with 'important' beats the !important top/right in CSS.
    // Also neutralize right/bottom so the box moves instead of stretching.
    const style = notificationStackContainer.style;
    style.setProperty("left", `${newLeft}px`, "important");
    style.setProperty("top", `${newTop}px`, "important");
    style.setProperty("right", "auto", "important");
    style.setProperty("bottom", "auto", "important");

    e.preventDefault();
  });

  const endDrag = (): void => {
    if (!isDragging || !notificationStackContainer) return;
    isDragging = false;
    if (activePointerId !== null) {
      try {
        header.releasePointerCapture(activePointerId);
      } catch {
        // ignore
      }
      activePointerId = null;
    }
    notificationStackContainer.classList.remove("knoww-dragging");
  };

  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  log("Draggable behavior initialized on notification stack header");
}
