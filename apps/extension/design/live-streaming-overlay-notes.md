# Live Markets Card — Streaming-platform surface (Twitch/YouTube)

Investigation notes + required extension changes for the "Live Markets Card"
design (from Claude Design handoff bundle `live-streaming-card`).

**Scope:** a NEW surface for live-streaming platforms (Twitch first, then
YouTube / others). This is **not** a redesign or overhaul of the existing
extension. The existing feed-injection cards and notification stack are
untouched.

**Brand:** reuse current faces only — no new fonts.
- `KnowwMono` (JetBrains Mono 500) → all mono labels / metadata / prices-as-labels
- `KnowwEditorial` (Fraunces italic 500) → editorial copy only (e.g. the empty
  state line), per the italic-restraint rule
- system sans (`--knoww-font`) → functional titles, big price numbers, buttons

Reference screenshots captured live (1512×810):
`twitch_live.png` (live channel), `twitch_channel.png` (offline channel).

---

## 1. Why streaming is a different surface (key finding)

Every existing platform adapter is **feed-based**: it walks a list of posts and
injects one market card per post via `findInjectionPoint(post)`
(`src/types/platform.ts`, `src/content/injection.ts`). Twitch/YouTube have **no
feed of posts** — there is one stream. The market relevance key is not "this
post's text" but **"what is being streamed right now"** (the game/category +
title).

So the streaming surface is a **single persistent companion card**, not
per-item injection. It maps directly to the design: one floating, draggable,
minimizable Live Markets card that lists the markets relevant to the current
stream and supports one-click trading.

---

## 2. Twitch layout map (measured @ 1512×810, default non-theatre)

| Region | Stable selector(s) | Box (x,y,w,h) | Notes |
|---|---|---|---|
| Left nav rail | `.side-nav`, `nav` | 0,50,240,… | collapsible follow list |
| Player container | `[data-a-target="video-player"]`, `.persistent-player` | 240,50,932,524 | the player column |
| `<video>` (letterboxed) | `video`, `.video-player__overlay` | 240,92,782,440 | actual pixels; pillarboxed inside container |
| Player overlay (click/controls layer) | `[data-a-target="player-overlay-click-handler"]` | 240,92,782,440 | **`pointer-events: auto`** — intercepts clicks |
| Top overlay bar | `.top-bar` | 240,92,782,60 | live badge / viewer count appear here |
| Bottom controls bar | `.player-controls__right-control-group` | ~706,534,458,32 | seek + volume + settings + fullscreen |
| Settings button | `[data-a-target="player-settings-button"]` | 1068,534,32,32 | bottom-right cluster |
| Fullscreen button | `[data-a-target="player-fullscreen-button"]` | 1132,534,32,32 | bottom-right cluster |
| Channel info / About (below player) | `.channel-info-content` | 240,574,932,tall | scrolls with page |
| **Right chat column** | `.stream-chat`, `[data-test-selector="chat-room-component-layout"]` | **1173,50,340,703** | fixed-height companion column |
| Chat header | `.stream-chat-header` | 1173,50,340,40 | |
| Whole channel root | `.channel-root` | 240,50,1272,… | |

### Stream-context extraction (the market query key) — confirmed working
| Signal | Selector | Example value |
|---|---|---|
| **Game / category** (primary) | `[data-a-target="stream-game-link"]` | `VALORANT` → href `/directory/category/valorant` |
| Stream title (secondary) | `[data-a-target="stream-title"]` | `happy happy happy` |
| Tags | `[href*="/directory/"]` / tag chips | `VALORANT, FPS, English, …` |
| Viewer count | `[data-a-target="animated-channel-viewers-count"]` | `7,002` |

→ Read the **game/category** to fetch that game's markets (e.g. DOTA2 stream →
DOTA2/esports markets). Title + tags are extra relevance signal.

---

## 3. Where the card can live — options

**A. Floating card docked to the player's bottom-right (over the video).**
Closest to the mock's "floating over the stream" look. But the player overlay
has `pointer-events: auto`, the bottom controls bar sits at y≈534, and the card
is tall (~384px wide, ~tall) so it would cover a meaningful slice of video and
compete with controls/subtitles. Requires auto-hide-on-idle + shrink in
theatre/fullscreen. Highest visual fidelity, highest friction.

**B. Companion panel docked to the top of the right chat column (≈340px).**
`.stream-chat` is 340px wide — almost exactly the card width. Inject a
collapsible markets panel between `.stream-chat-header` and the message list.
Never covers the video, persists naturally, matches a "live-stream companion"
mental model (this is where Twitch's own extensions/panels live). Lowest
friction. The adapter already has a `findSidebarInjectionPoint?()` hook
(`src/types/platform.ts`) built for exactly this kind of inline docking.

**C. Strip below the player in `.channel-info-content`.** Non-invasive but
below the fold and loses the "live, always-visible" feel. Weakest.

### Recommendation
A **viewport-fixed floating draggable card** (independent of Twitch's DOM, so it
survives their frequent class churn and SPA route changes) that **defaults to
the bottom-right, snapped just inside the chat column**, is draggable anywhere,
minimizes to the pill from the design, and in **fullscreen/theatre** collapses
to the pill or auto-hides on cursor idle. This is both the closest match to the
mock (draggable + minimize + fullscreen behavior are all specified there) and
the closest reuse of the extension's existing floating `notification-stack`
drag/minimize pattern (`src/content/ui.ts createNotificationStack`). Offer
"dock to chat column" (option B) as the alternate position in settings.

---

## 4. Constraints to design around

- **Player overlay intercepts pointer events** (`pointer-events: auto`). A card
  floating over the player must sit above the overlay and must not swallow
  player clicks outside its own bounds.
- **Controls safe-zone:** keep clear of the top bar (y 92–152) and the bottom
  controls bar (y ≈ 534+), especially the bottom-right settings/fullscreen
  cluster.
- **Theatre mode & fullscreen** change geometry: in fullscreen the player is the
  fullscreen element; a normal fixed overlay won't show. Must either render into
  the fullscreen element or collapse to the minimized pill + auto-hide-on-idle
  (both behaviors are called for in the design brief, section 11).
- **SPA navigation:** Twitch is a client-side-routed SPA. Channel changes don't
  reload the page → must observe route/`stream-game-link` changes and re-query
  markets (re-detect stream context), not rely on a one-time injection.
- **Per-channel live state:** offline channels (e.g. `dota2ti` when not live)
  have no game link → card should show the empty/idle state, not error.

---

## 5. Required extension changes (note-down list)

Concrete, minimal, additive — nothing here modifies the feed-injection path.

1. **Manifest matches/host_permissions** (`manifest.json`, generated via
   webpack — host list is `__GENERATED_BY_WEBPACK_BUILD__`): add
   `*://*.twitch.tv/*` (and later `*://*.youtube.com/*`) to content-script
   matches + host permissions so the content script runs there.

2. **New streaming adapter(s)** under `src/content/platforms/` (e.g.
   `twitch.ts`) registered via the existing registry
   (`src/content/platform-registry.ts`). It is a *different shape* of adapter:
   - `hostPatterns: [/(^|\.)twitch\.tv$/]`
   - Instead of feed `selectors`/`findInjectionPoint`, it exposes
     **stream-context** accessors: `getStreamContext()` →
     `{ game, gameSlug, title, tags, isLive }` read from the selectors in §2.
   - A mount hook for the companion surface (reuse/extend
     `findSidebarInjectionPoint?()` for option B, or a no-op for the fixed
     floating card in option A/recommendation).

3. **Adapter mode flag.** Add an optional `surface: "feed" | "stream"` (default
   `"feed"`) to `PlatformAdapter` (`src/types/platform.ts`). The content
   bootstrap (`src/content/main.ts` / `index.ts`) branches: `feed` → existing
   injection scanner; `stream` → mount the single Live Markets card and skip the
   post scanner entirely.

4. **New Live Markets card module** (e.g.
   `src/content/streaming/live-markets-card.ts`), vanilla DOM + CSS to match the
   existing extension (the React prototype is reference only). Reuses:
   - the floating/drag/minimize mechanics from `createNotificationStack`
     (`src/content/ui.ts`),
   - the trading flow from `src/content/trading/trading-panel.ts` for the
     one-click order,
   - market types from `src/types/market.ts`,
   - market fetch/scoring from `src/content/api.ts`
     (`searchMarkets`/`scoreMarkets`) — query seeded by the stream's
     game/category instead of post text.

5. **Card CSS** appended to `src/content/knoww-inline.css` under a new
   `.knoww-live-markets-*` namespace, using existing brand tokens and the two
   bundled faces only (no new fonts). A dark/streaming theme variant
   (`--knoww-*` overrides) since Twitch is dark by default.

6. **One-click trade settings.** The design's one-click UX needs pre-collected
   prefs (default trade amount, confirm-before-trade, card position). Surface
   these in the existing options/settings store so the card can place a single
   tap order. (Settings panel UI itself is deferred per current scope.)

7. **Lifecycle/SPA handling.** Watch for channel/route changes (observe
   `stream-game-link` + `popstate`/history) to re-detect context and refetch;
   handle fullscreen/theatre transitions (collapse to pill / render into
   fullscreen element).

---

## 6. Generalizing to YouTube / other platforms

Same `surface: "stream"` adapter shape; only the context selectors differ:
- **YouTube Live:** game/title from `#title h1`, `ytd-watch-metadata`, and the
  "Live now" badge; chat dock at `#chat`. Player is `.html5-video-player`.
- Any streaming site = implement `getStreamContext()` + pick a mount; the card
  module and CSS are shared.

---

## 7. Open questions for product

- Default placement: floating-over-player (A) vs docked-in-chat (B)? (Rec: fixed
  floating, default snapped by the chat column, with B as a settings option.)
- Market source for esports/sports games — do Polymarket/Kalshi have enough
  live per-game (DOTA2/VALORANT) market coverage to seed from the category, or
  do we need a curated game→market mapping?
- Fullscreen behavior: pill vs fully hidden until cursor move?
