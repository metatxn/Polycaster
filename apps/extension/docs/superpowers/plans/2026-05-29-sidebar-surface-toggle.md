# Side Panel ↔ Notification Panel Surface Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chosen panel surface sticky so restoring Knoww's side panel after another extension evicts it takes a single toolbar-icon click, and add an in-sidebar button to switch back to the floating notification panel.

**Architecture:** A single persisted setting (`notificationPanelSurface`) is the source of truth. The background service worker persists the surface on every switch and the existing `storage.onChanged` → `applySidePanelActionBehavior` pipeline flips Chrome's `openPanelOnActionClick`. A new pure helper gates the floating teaser auto-show, and a new side-panel header button performs the reverse switch.

**Tech Stack:** TypeScript, Chrome Extension MV3 APIs (`chrome.sidePanel`, `chrome.storage.sync`, `chrome.action`), webpack build, `node:test` + `node:assert/strict` test runner.

**Reference spec:** [docs/superpowers/specs/2026-05-29-sidebar-surface-toggle-design.md](../specs/2026-05-29-sidebar-surface-toggle-design.md)

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `src/content/notification-surface.ts` | Create | Pure decision: should the floating teaser auto-show given `showNotificationStack` + surface |
| `tests/content/notification-surface.test.ts` | Create | Unit tests for the pure decision |
| `tsconfig.tests.json` | Modify | Add the new pure module to the test compile `include` |
| `src/content/config.ts` | Modify | `isNotificationStackEnabled()` delegates to the pure helper (surface-aware) |
| `src/background.ts` | Modify | Persist surface on switch; new `persistNotificationPanelSurface` helper; handle reverse-switch message |
| `src/sidepanel.ts` | Modify | New "Switch to floating panel" header button + handler |
| `tests/content/surface-toggle.test.ts` | Create | Source-wiring regex tests for background + sidepanel changes (matches existing `sidepanel-controls.test.ts` style) |

**Conventions to follow (verified in repo):**
- Pure, importable logic modules under `src/content/` are unit-tested by direct import (see `src/content/scoring-policy.ts` + `tests/content/scoring-policy.test.ts`). Such modules must be added to `tsconfig.tests.json` `include`.
- DOM/`chrome`-bound wiring (background.ts, sidepanel.ts) is verified by reading source text and asserting regex patterns (see `tests/content/sidepanel-controls.test.ts`).
- Tests run with `pnpm run test` (alias of `test:scoring`): `rm -rf .test-dist && tsc -p tsconfig.tests.json && node --test .test-dist/apps/extension/tests/**/*.test.js`.

---

## Task 1: Surface-aware auto-show gate (pure helper)

**Files:**
- Create: `src/content/notification-surface.ts`
- Create: `tests/content/notification-surface.test.ts`
- Modify: `tsconfig.tests.json` (add include entry)
- Modify: `src/content/config.ts:203-208` (use helper) and import near `src/content/config.ts:6-11`

- [ ] **Step 1: Write the failing test**

Create `tests/content/notification-surface.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { shouldAutoShowNotificationStack } from "../../src/content/notification-surface";

test("auto-shows the floating teaser when surface is floating and stack enabled", () => {
  assert.equal(shouldAutoShowNotificationStack(true, "floating"), true);
});

test("suppresses the floating teaser when surface is sidebar", () => {
  assert.equal(shouldAutoShowNotificationStack(true, "sidebar"), false);
});

test("never auto-shows when the notification stack is disabled", () => {
  assert.equal(shouldAutoShowNotificationStack(false, "floating"), false);
  assert.equal(shouldAutoShowNotificationStack(false, "sidebar"), false);
});
```

- [ ] **Step 2: Add the module to the test compile include**

Modify `tsconfig.tests.json` — add `"src/content/notification-surface.ts"` to the `include` array (alongside `"src/content/scoring-policy.ts"`):

```json
  "include": [
    "src/background/unified-clob-client.ts",
    "src/content/scoring-policy.ts",
    "src/content/notification-surface.ts",
    "src/background/score-markets-core.ts",
    "src/types/**/*.ts",
    "tests/**/*.ts"
  ],
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm run test`
Expected: FAIL — compile error / `Cannot find module '../../src/content/notification-surface'` (file does not exist yet).

- [ ] **Step 4: Write the minimal implementation**

Create `src/content/notification-surface.ts`:

```ts
// Pure decision for whether the floating notification stack should auto-show
// on page load. Extracted so it can be unit-tested without chrome/DOM deps.

import type { UserSettings } from "../types/settings";

/**
 * The floating teaser auto-shows only when the notification stack is enabled
 * AND the user's home surface is the floating panel. When the user has chosen
 * the side panel, the teaser stays out of the way — the toolbar icon is the
 * one-click entry point instead.
 */
export function shouldAutoShowNotificationStack(
  showNotificationStack: boolean,
  surface: UserSettings["notificationPanelSurface"]
): boolean {
  return showNotificationStack && surface !== "sidebar";
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm run test`
Expected: PASS — the three `notification-surface` tests pass (existing scoring/content tests still pass).

- [ ] **Step 6: Wire the helper into config.ts**

In `src/content/config.ts`, add the import next to the existing settings import (currently `src/content/config.ts:6-11`):

```ts
import {
  type Config,
  DEFAULT_USER_SETTINGS,
  type EnabledSources,
  type UserSettings,
} from "../types/settings";
import { shouldAutoShowNotificationStack } from "./notification-surface";
```

Replace `isNotificationStackEnabled` (currently `src/content/config.ts:203-208`):

```ts
function isNotificationStackEnabled(): boolean {
  return shouldAutoShowNotificationStack(
    USER_SETTINGS.showNotificationStack ??
      DEFAULT_USER_SETTINGS.showNotificationStack,
    USER_SETTINGS.notificationPanelSurface ??
      DEFAULT_USER_SETTINGS.notificationPanelSurface
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS — no errors.

- [ ] **Step 8: Commit**

```bash
git add src/content/notification-surface.ts tests/content/notification-surface.test.ts tsconfig.tests.json src/content/config.ts
git commit -m "feat(extension): suppress floating teaser when sidebar is home surface"
```

---

## Task 2: Persist the surface on every switch (background)

**Files:**
- Modify: `src/background.ts` — add `persistNotificationPanelSurface` helper near `readUserSettings` (after `src/background.ts:115`)
- Modify: `src/background.ts:795-824` — `KNOWW_OPEN_EXTENSION_SIDEPANEL` handler persists `"sidebar"`
- Modify: `src/background.ts` — add a new `KNOWW_SET_NOTIFICATION_PANEL_SURFACE` message handler (place it directly after the `KNOWW_CLOSE_EXTENSION_SIDEPANEL` handler block, currently ending at `src/background.ts:843`)
- Create: `tests/content/surface-toggle.test.ts` (background assertions in Step 1; sidepanel assertions added in Task 3)

- [ ] **Step 1: Write the failing test**

Create `tests/content/surface-toggle.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

declare const process: { cwd(): string };
declare function require(moduleName: string): unknown;

const { readFileSync } = require("node:fs") as {
  readFileSync(path: string, options: { encoding: "utf8" }): string;
};
const { join } = require("node:path") as {
  join(...parts: string[]): string;
};

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), { encoding: "utf8" });
}

test("background persists the surface preference on every switch", () => {
  const background = readSource("src/background.ts");

  // A single helper centralizes the storage.sync write.
  assert.equal(
    /function persistNotificationPanelSurface/.test(background),
    true
  );
  // Forward switch (Show in sidebar) makes the sidebar choice sticky.
  assert.equal(
    /KNOWW_OPEN_EXTENSION_SIDEPANEL[\s\S]*persistNotificationPanelSurface\(\s*"sidebar"\s*\)/.test(
      background
    ),
    true
  );
  // Reverse switch message persists the floating choice.
  assert.equal(
    /KNOWW_SET_NOTIFICATION_PANEL_SURFACE/.test(background),
    true
  );
  assert.equal(
    /persistNotificationPanelSurface\(\s*"floating"\s*\)/.test(background),
    true
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run test`
Expected: FAIL — `persistNotificationPanelSurface`, the `"sidebar"` persist call, and `KNOWW_SET_NOTIFICATION_PANEL_SURFACE` are not present yet.

- [ ] **Step 3: Add the persistence helper**

In `src/background.ts`, immediately after `readUserSettings` (which ends at `src/background.ts:115`), add:

```ts
async function persistNotificationPanelSurface(
  surface: UserSettings["notificationPanelSurface"]
): Promise<void> {
  const settings = await readUserSettings();
  if (settings.notificationPanelSurface === surface) return;
  await new Promise<void>((resolve) => {
    chrome.storage.sync.set(
      {
        [SETTINGS_STORAGE_KEY]: {
          ...settings,
          notificationPanelSurface: surface,
        },
      },
      () => {
        void chrome.runtime.lastError;
        resolve();
      }
    );
  });
}
```

Note: writing `SETTINGS_STORAGE_KEY` fires the existing `chrome.storage.onChanged` listener (`src/background.ts:1474`), which calls `updateNotificationPanelSurfaceFromSettings` → `applySidePanelActionBehavior`, flipping `openPanelOnActionClick`. No extra wiring needed.

- [ ] **Step 4: Persist "sidebar" in the open-sidepanel handler**

In `src/background.ts`, in the `KNOWW_OPEN_EXTENSION_SIDEPANEL` handler (currently `src/background.ts:795-824`), make the sidebar choice sticky by persisting before opening. Replace the handler body's opening lines:

```ts
    if (msg?.type === "KNOWW_OPEN_EXTENSION_SIDEPANEL") {
      void persistNotificationPanelSurface("sidebar");
      void openKnowwSidePanel({
        ...(typeof sender.tab?.id === "number" ? { tabId: sender.tab.id } : {}),
        ...(typeof sender.tab?.windowId === "number"
          ? { windowId: sender.tab.windowId }
          : {}),
      })
        .then(() => {
          if (typeof sender.tab?.id === "number") {
            chrome.tabs.sendMessage(
              sender.tab.id,
              {
                type: "KNOWW_SET_NOTIFICATION_STACK_VISIBILITY",
                visible: false,
              },
              () => {
                void chrome.runtime.lastError;
              }
            );
          }
          sendResponse({ ok: true, data: null } as BackgroundResponse);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } as BackgroundResponse);
        });
      return true;
    }
```

(Only the added `void persistNotificationPanelSurface("sidebar");` line is new — the rest is unchanged from the current handler.)

- [ ] **Step 5: Add the reverse-switch message handler**

In `src/background.ts`, directly after the `KNOWW_CLOSE_EXTENSION_SIDEPANEL` handler block (currently ending at `src/background.ts:843`), add:

```ts
    if (
      msg?.type === "KNOWW_SET_NOTIFICATION_PANEL_SURFACE" &&
      (msg.surface === "sidebar" || msg.surface === "floating")
    ) {
      const surface = msg.surface;
      void persistNotificationPanelSurface(surface)
        .then(() =>
          sendResponse({ ok: true, data: null } as BackgroundResponse)
        )
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } as BackgroundResponse);
        });
      return true;
    }
```

Add `surface` to the inline `msg` type used at the top of the `onMessage` listener (currently the object type declared at `src/background.ts:758-779`) by adding this field alongside the others:

```ts
      surface?: "sidebar" | "floating";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm run test`
Expected: PASS — the background assertions in `surface-toggle.test.ts` now pass.

- [ ] **Step 7: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS — no errors.

- [ ] **Step 8: Commit**

```bash
git add src/background.ts tests/content/surface-toggle.test.ts
git commit -m "feat(extension): persist panel surface on switch for one-click sidebar restore"
```

---

## Task 3: "Switch to floating panel" button (side panel)

**Files:**
- Modify: `src/sidepanel.ts` — add `switchToFloatingPanel` helper after `closeSidePanel` (`src/sidepanel.ts:474-478`)
- Modify: `src/sidepanel.ts:1890` — add the new header button before the close button
- Modify: `src/sidepanel.ts:2034-2035` — wire the new button's click handler
- Modify: `tests/content/surface-toggle.test.ts` — add sidepanel assertions

- [ ] **Step 1: Write the failing test**

Append to `tests/content/surface-toggle.test.ts`:

```ts
test("side panel offers a dedicated switch-to-floating control", () => {
  const sidepanel = readSource("src/sidepanel.ts");

  // Dedicated button distinct from the existing close button.
  assert.equal(/class="knoww-stack-popout"/.test(sidepanel), true);
  assert.equal(/Switch to floating panel/.test(sidepanel), true);

  // Handler persists floating, shows the page panel, and closes the side panel.
  assert.equal(/function switchToFloatingPanel/.test(sidepanel), true);
  assert.equal(
    /KNOWW_SET_NOTIFICATION_PANEL_SURFACE[\s\S]*surface:\s*"floating"/.test(
      sidepanel
    ),
    true
  );
  assert.equal(
    /switchToFloatingPanel[\s\S]*setPagePanelVisibility\(true\)/.test(
      sidepanel
    ),
    true
  );
  assert.equal(
    /switchToFloatingPanel[\s\S]*closeSidePanel\(\)/.test(sidepanel),
    true
  );

  // The new control is wired to a click listener.
  assert.equal(
    /querySelector<HTMLButtonElement>\("\.knoww-stack-popout"\)/.test(
      sidepanel
    ),
    true
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run test`
Expected: FAIL — `knoww-stack-popout`, `switchToFloatingPanel`, and the surface message are not in `sidepanel.ts` yet.

- [ ] **Step 3: Add the `switchToFloatingPanel` helper**

In `src/sidepanel.ts`, immediately after `closeSidePanel` (currently `src/sidepanel.ts:474-478`), add:

```ts
async function switchToFloatingPanel(): Promise<void> {
  // 1. Persist floating as the home surface (flips openPanelOnActionClick back).
  await sendRuntimeMessage({
    type: "KNOWW_SET_NOTIFICATION_PANEL_SURFACE",
    surface: "floating",
  });
  // 2. Show the notification panel on the current page right away.
  await setPagePanelVisibility(true);
  // 3. Close the side panel last, so a close failure (Chrome < 141) still
  //    leaves the user on the restored page panel.
  await closeSidePanel();
}
```

- [ ] **Step 4: Add the header button**

In `src/sidepanel.ts`, insert the new button before the existing close button (currently `src/sidepanel.ts:1890`). The close button stays unchanged; add this block directly above it:

```html
          <button type="button" class="knoww-stack-popout" title="Switch to floating panel" aria-label="Switch to floating panel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M15 3h6v6"></path>
              <path d="M10 14 21 3"></path>
              <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path>
            </svg>
          </button>
```

- [ ] **Step 5: Wire the button's click handler**

In `src/sidepanel.ts`, next to the existing close-button wiring (currently `src/sidepanel.ts:2034-2035`):

```ts
  root
    .querySelector<HTMLButtonElement>(".knoww-stack-close")
    ?.addEventListener("click", () => void closeSidePanel());
  root
    .querySelector<HTMLButtonElement>(".knoww-stack-popout")
    ?.addEventListener("click", () => void switchToFloatingPanel());
```

(The first block already exists — add only the second block.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm run test`
Expected: PASS — sidepanel assertions in `surface-toggle.test.ts` now pass; all other tests still pass.

- [ ] **Step 7: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS — no errors.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel.ts tests/content/surface-toggle.test.ts
git commit -m "feat(extension): add switch-to-floating button in side panel header"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm run test`
Expected: PASS — all tests, including the three new `notification-surface` tests and the `surface-toggle` wiring tests.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS — no type errors; Biome reports no new issues.

- [ ] **Step 3: Production build**

Run: `pnpm run build`
Expected: PASS — webpack builds and `assert-production-bundle.mjs` succeeds.

- [ ] **Step 4: Manual smoke test (load unpacked `dist/` in Chrome)**

Verify each spec scenario:

1. Fresh state (surface defaults to `floating`): open a supported page → floating notification panel auto-appears. Click **Show in sidebar** → side panel opens, floating panel hides.
2. Reload the supported page → floating teaser does **not** auto-appear (sidebar is now home).
3. Open another side-panel extension (e.g. MetaMask) to evict Knoww → click the Knoww toolbar icon **once** → Knoww's side panel reopens (native `openPanelOnActionClick`, no floating-panel detour).
4. In the side panel, click **Switch to floating panel** → the notification panel returns on the current page and the side panel closes. Reload the page → floating teaser auto-shows again; clicking the toolbar icon opens the floating panel.
5. Options page surface dropdown still toggles both directions consistently.

- [ ] **Step 5: Hand off for manual commit**

Per repository preference, the implementer commits per task above. Leave the working tree in a reviewed, building state for the user.

---

## Self-Review

**Spec coverage:**
- Floating → Sidebar persistence → Task 2 (Steps 3–4). ✓
- One-click native restore via `openPanelOnActionClick` → relies on existing `storage.onChanged` pipeline triggered by Task 2's write; verified in manual test Step 4.3. ✓
- Suppress floating teaser when sidebar is home → Task 1. ✓
- Sidebar → Floating (persist + show page panel + close) → Task 3. ✓
- Dedicated button distinct from Close → Task 3 (Step 4) + assertion in Step 1. ✓
- Chrome < 141 graceful close → Task 3 helper orders close last; `closeSidePanel` resolves (never throws) per `sendRuntimeMessage`. ✓
- Options dropdown unchanged → manual test Step 4.5. ✓
- No new storage keys → reuses `notificationPanelSurface` / `SETTINGS_STORAGE_KEY`. ✓

**Placeholder scan:** No TBD/TODO; every code step includes full code. ✓

**Type consistency:** `persistNotificationPanelSurface(surface: UserSettings["notificationPanelSurface"])`, message type `KNOWW_SET_NOTIFICATION_PANEL_SURFACE` with `surface: "sidebar" | "floating"`, helper `shouldAutoShowNotificationStack(boolean, surface)`, and `switchToFloatingPanel()` are named identically across all tasks and tests. ✓
