// ============================================
// TWITCH — streaming-surface platform adapter
// ============================================
// Twitch has no feed of posts. Instead of injecting a card per post, the
// extension surfaces a single companion "Live Markets" card seeded by the
// game/category being watched (e.g. a Dota 2 stream → Dota 2 markets). This
// adapter declares `surface: "stream"` and exposes `getStreamContext()`; the
// feed-only methods exist only to satisfy the PlatformAdapter contract (the
// bootstrap branches before `watchFeed`).
//
// We support every Twitch surface that has a game/category, not just live
// streams — the game link lives in a different place on each:
//   • live channel  [data-a-target="stream-game-link"]
//   • VOD / video    [data-a-target="video-info-game-boxart-link"]
//   • offline channel  a[href*="/directory/category/"] inside .channel-info-content
// All resolve to a /directory/category/<slug> (or /game/<slug>) href, which is
// the stable signal; the visible text is sometimes empty (boxart icon), so we
// fall back to the boxart alt text and finally to a slug-derived name.
// (Stray category links — chat badges, the left nav rail — are avoided by
// scoping to the selectors above rather than a global query.)
// ============================================

import { createLogger } from "@knoww/logger";
import type { PlatformAdapter, StreamContext } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";

const log = createLogger("extension.twitch");

// Game/category link selectors, in priority order (live → VOD → offline).
const GAME_LINK_SELECTORS = [
  '[data-a-target="stream-game-link"]',
  '[data-a-target="video-info-game-boxart-link"]',
  '.channel-info-content a[href*="/directory/category/"]',
  '.channel-info-content a[href*="/directory/game/"]',
  '[data-a-target="video-info-bar"] a[href*="/directory/category/"]',
];

const TITLE_SELECTORS = [
  '[data-a-target="stream-title"]',
  '[data-a-target="video-info-bar-title"]',
];

const VIEWER_COUNT = '[data-a-target="animated-channel-viewers-count"]';

function slugToName(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .trim();
}

function firstText(selectors: string[]): string {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = (el?.textContent || "").trim();
    if (text) return text;
  }
  return "";
}

/** Resolve the current game/category across live / VOD / offline surfaces. */
function findGame(): { game: string; slug?: string } | null {
  for (const sel of GAME_LINK_SELECTORS) {
    const el = document.querySelector(sel);
    if (!el) continue;

    const href = el.getAttribute("href") || "";
    const slug = href.match(/\/directory\/(?:category|game)\/([^/?#]+)/i)?.[1];

    const text =
      (el.textContent || "").trim() ||
      el.querySelector("img")?.getAttribute("alt")?.trim() ||
      (slug ? slugToName(slug) : "");

    if (text || slug) {
      return { game: text || (slug ? slugToName(slug) : ""), slug };
    }
  }
  return null;
}

// Surface what we read off the Twitch DOM in debug mode. Deduped on change so
// frequent stream-context polling does not spam repeated rows.
let lastStreamDebugKey = "";
function logStreamContextDebug(ctx: StreamContext): void {
  const key = `${ctx.game}|${ctx.gameSlug || ""}|${ctx.title}|${ctx.isLive}`;
  if (key === lastStreamDebugKey) return;
  lastStreamDebugKey = key;
  const gameLinkCandidates = GAME_LINK_SELECTORS.map((selector) => {
    const el = document.querySelector(selector);
    return {
      selector,
      found: !!el,
      href: el?.getAttribute("href") || null,
      text: (el?.textContent || "").trim() || null,
      imgAlt: el?.querySelector("img")?.getAttribute("alt")?.trim() || null,
    };
  });
  log.debug("stream.context", {
    url: location.href,
    game: ctx.game,
    gameSlug: ctx.gameSlug,
    title: ctx.title,
    tags: ctx.tags,
    isLive: ctx.isLive,
    gameLinkCandidates,
  });
}

function getStreamContext(): StreamContext | null {
  const found = findGame();
  const title = firstText(TITLE_SELECTORS);
  const isLive = !!document.querySelector(VIEWER_COUNT);

  const tags = Array.from(
    document.querySelectorAll('a[href*="/directory/all/tags/"]')
  )
    .map((el) => (el.textContent || "").trim())
    .filter(Boolean)
    .slice(0, 8);

  // No game and no title → nothing to query (e.g. the browse/following pages).
  const ctx: StreamContext =
    !found?.game && !title
      ? { game: "", title: "", tags, isLive }
      : {
          game: found?.game || "",
          gameSlug: found?.slug,
          title,
          tags,
          isLive,
        };

  logStreamContextDebug(ctx);
  return ctx;
}

const TwitchAdapter: PlatformAdapter = {
  name: "twitch",
  hostPatterns: [/(^|\.)twitch\.tv$/],
  surface: "stream",
  getStreamContext,

  // Stream context is short game names, not English prose — skip the gate.
  bypassEnglishCheck: true,

  // The Live Markets card should list every relevant market for the stream,
  // so lift the default per-stack caps.
  maxActiveNotificationItems: 24,
  maxNotificationItems: 24,

  // Theme: Twitch is dark by default.
  detectTheme: () => "dark",
  isDarkMode: () => true,

  // --- Feed-only contract methods (unused on a stream surface) ---
  selectors: { item: "article", container: "main", text: "p" },
  extractPostText: () => "",
  findInjectionPoint: () => null,
};

registerAdapterWithRetry(TwitchAdapter, 100, 50);

export { TwitchAdapter };
