# Side Panel ↔ Notification Panel Surface Toggle

**Date:** 2026-05-29
**Status:** Approved (design) — pending implementation plan

## Problem

When the user shows Knoww in the Chrome side panel and then opens another
side-panel extension (e.g. MetaMask), Chrome replaces Knoww's panel — only one
side panel can be open per window. Restoring Knoww currently costs **two
clicks**:

1. Click the toolbar icon → opens the **floating notification panel** (because
   the persisted surface is still `"floating"`).
2. Click **"Show in sidebar"** in that panel → opens the side panel.

The root cause: the "Show in sidebar" button
([content/ui.ts](../../../src/content/ui.ts) `openSidePanelFromNotificationStack`)
fires a one-off `KNOWW_OPEN_EXTENSION_SIDEPANEL` and **never persists** the
surface choice. The setting `notificationPanelSurface` defaults to `"floating"`
([types/settings.ts:144](../../../src/types/settings.ts)), so
[`applySidePanelActionBehavior`](../../../src/background.ts) keeps
`openPanelOnActionClick = false` and the toolbar icon keeps opening the floating
panel.

## Chrome constraints (hard limits)

- Only one extension's side panel can be open per window; another extension
  opening its panel evicts ours.
- Chrome fires **no event** when our panel is replaced.
- `sidePanel.open()` requires a **user gesture** — the panel cannot be reopened
  programmatically.

Therefore fully automatic restore is impossible. The best achievable is
**one user gesture (a single toolbar-icon click)** to restore. With
`setPanelBehavior({ openPanelOnActionClick: true })`, Chrome opens our side panel
**natively** on that click (the `chrome.action.onClicked` handler does not even
fire), which is exactly the one-click restore we want.

## Design

A two-way, persisted surface toggle. The user's chosen surface becomes their
"home," and the toolbar icon always honors it.

### Floating → Sidebar

Triggered by the existing **"Show in sidebar"** button in the notification
panel.

1. **Persist** `notificationPanelSurface = "sidebar"` to `chrome.storage.sync`.
   Done centrally in the background `KNOWW_OPEN_EXTENSION_SIDEPANEL` handler
   ([background.ts:795](../../../src/background.ts)) so a single write drives all
   downstream behavior.
2. The existing [`storage.onChanged` listener](../../../src/background.ts)
   updates `cachedNotificationPanelSurface` and calls
   `applySidePanelActionBehavior`, flipping `openPanelOnActionClick = true`.
   → **Toolbar icon becomes a 1-click native side-panel restore.**
3. Open the side panel and hide the notification stack (existing behavior).

### Sidebar → Floating

Triggered by a **new dedicated button** in the side panel header.

1. **Persist** `notificationPanelSurface = "floating"`.
2. `setPagePanelVisibility(true)`
   ([sidepanel.ts:467](../../../src/sidepanel.ts)) → notification panel
   reappears on the current page immediately.
3. `closeSidePanel()` ([sidepanel.ts:474](../../../src/sidepanel.ts)) → side
   panel closes. (Requires Chrome 141+ for `sidePanel.close`; fail gracefully
   otherwise — the surface preference still persists and the page panel still
   shows.)
4. `storage.onChanged` flips `openPanelOnActionClick = false` → toolbar icon
   returns to opening the floating panel, and the teaser auto-shows on future
   pages again.

### Suppress the floating teaser when sidebar is home

The floating notification stack currently auto-shows on page load gated **only**
by the `showNotificationStack` boolean
([content/config.ts:203](../../../src/content/config.ts)
`isNotificationStackEnabled`) — it ignores `notificationPanelSurface`.

Add a surface check at the auto-show gate
([content/main.ts:63](../../../src/content/main.ts)): auto-show only when
`isNotificationStackEnabled() && notificationPanelSurface !== "sidebar"`.

- First-ever visit (default `"floating"`): teaser shows → discovery preserved.
- After choosing sidebar: teaser stays out of the way; the toolbar icon is the
  one-click entry point.
- The explicit `KNOWW_SET_NOTIFICATION_STACK_VISIBILITY` message used by the
  Sidebar→Floating switch is **not** affected by this gate — it shows the panel
  on demand regardless of surface.

### Button choice (Sidebar → Floating)

A **dedicated** button in the side panel header's right cluster
([sidepanel.ts:1874](../../../src/sidepanel.ts)), alongside settings / search /
minimize / close, with a "pop out to page" icon and a label such as
*"Switch to floating panel."*

Kept separate from the existing **Close** button to preserve a meaningful
distinction:

- **Close** — dismiss the side panel for now; *keep* sidebar as home (toolbar
  icon still reopens the sidebar).
- **Switch to floating panel** — permanently change home surface back to the
  page panel.

Overloading Close to also switch surfaces would be ambiguous; a dedicated
control is clearer.

### Switching back via Options (unchanged)

The surface dropdown in Options
([options.tsx:889](../../../src/options.tsx)) continues to work as a manual
override in both directions and shares the same `storage.onChanged` path.

## Components touched

| Unit | Change | Responsibility |
|------|--------|----------------|
| `background.ts` — `KNOWW_OPEN_EXTENSION_SIDEPANEL` handler | Persist `notificationPanelSurface = "sidebar"` before/after opening | Make the sidebar choice sticky |
| `content/config.ts` / `content/main.ts` — auto-show gate | Add `notificationPanelSurface !== "sidebar"` condition | Suppress floating teaser when sidebar is home |
| `sidepanel.ts` — header markup + handler | New "Switch to floating panel" button: persist `"floating"`, show page panel, close side panel | Reverse toggle |

No new messages or storage keys; reuses `notificationPanelSurface`,
`KNOWW_SET_NOTIFICATION_STACK_VISIBILITY`, `KNOWW_CLOSE_EXTENSION_SIDEPANEL`, and
the existing `storage.onChanged` → `applySidePanelActionBehavior` pipeline.

## Data flow

```
[Notification panel]  "Show in sidebar"
   → KNOWW_OPEN_EXTENSION_SIDEPANEL (background)
       → storage.sync.set(notificationPanelSurface = "sidebar")
           → storage.onChanged → applySidePanelActionBehavior(openPanelOnActionClick = true)
       → sidePanel.open() + hide notification stack
   ⇒ Toolbar icon now restores the side panel in ONE native click.

[Side panel]  "Switch to floating panel"
   → storage.sync.set(notificationPanelSurface = "floating")
       → storage.onChanged → applySidePanelActionBehavior(openPanelOnActionClick = false)
   → KNOWW_SET_NOTIFICATION_STACK_VISIBILITY { visible: true }  (page panel returns)
   → KNOWW_CLOSE_EXTENSION_SIDEPANEL                            (side panel closes)
   ⇒ Toolbar icon returns to opening the floating panel; teaser auto-shows again.
```

## Error handling / edge cases

- **`sidePanel.close` unavailable (< Chrome 141):** the Sidebar→Floating switch
  still persists the surface and shows the page panel; only the automatic close
  of the side panel is skipped. Surface the existing
  "requires Chrome 141 or newer" message if needed but do not block the rest.
- **Page panel cannot be shown** (no active content tab / unsupported page):
  surface preference still persists; reuse the existing toast path in the side
  panel.
- **`storage.sync` write races with manual Options change:** last write wins;
  both flow through the same `onChanged` handler, so panel behavior stays
  consistent.

## Testing

- Unit: gate logic returns `false` when surface is `"sidebar"`, `true` when
  `"floating"` (and respects `showNotificationStack`).
- Manual:
  1. Floating default → click "Show in sidebar" → reload supported page → no
     floating teaser; toolbar icon opens side panel in one click.
  2. Open another side-panel extension to evict Knoww → single toolbar-icon
     click restores Knoww's side panel.
  3. In side panel → "Switch to floating panel" → page panel returns, side panel
     closes; reload page → teaser auto-shows; toolbar icon opens floating panel.
  4. Options dropdown toggles both directions consistently.

## Out of scope

- Auto-restore without a user gesture (impossible per Chrome constraints).
- Detecting when another extension evicts our panel (no Chrome event exists).
- Any change to `showNotificationStack` semantics.
