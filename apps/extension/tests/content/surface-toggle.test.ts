import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

declare const process: { cwd(): string };

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
  // Reverse switch handler validates the surface union...
  assert.equal(
    /msg\.surface === "sidebar" \|\| msg\.surface === "floating"/.test(
      background
    ),
    true
  );
  // ...and persists whatever surface the message carries.
  assert.equal(
    /KNOWW_SET_NOTIFICATION_PANEL_SURFACE[\s\S]{0,400}persistNotificationPanelSurface\(\s*msg\.surface\s*\)/.test(
      background
    ),
    true
  );
});

test("background opens the side panel before async view persistence", () => {
  const background = readSource("src/background.ts");
  const handlerStart = background.indexOf(
    'if (msg?.type === "KNOWW_OPEN_EXTENSION_SIDEPANEL")'
  );
  assert.notEqual(handlerStart, -1);

  const handlerSource = background.slice(handlerStart, handlerStart + 1400);
  const openIndex = handlerSource.indexOf("openKnowwSidePanel(");
  const viewPersistIndex = handlerSource.indexOf("setRequestedSidePanelView(");

  assert.notEqual(openIndex, -1);
  assert.notEqual(viewPersistIndex, -1);
  assert.equal(openIndex < viewPersistIndex, true);
  assert.equal(
    /then\(\(\)\s*=>\s*openKnowwSidePanel/.test(handlerSource),
    false
  );
});

test("side panel offers a dedicated switch-to-floating control", () => {
  const sidepanel = readSource("src/sidepanel/markets.ts");

  // Dedicated button distinct from the existing close button, mirroring the
  // floating panel's "move to sidebar" affordance.
  assert.equal(/class="knoww-stack-popout"/.test(sidepanel), true);
  assert.equal(/Move to floating panel/.test(sidepanel), true);

  // Positioned right after settings and before search (matching the floating
  // panel's switch button placement), not jammed next to close.
  assert.equal(
    /class="knoww-stack-popout"[\s\S]{0,800}class="knoww-search-toggle"/.test(
      sidepanel
    ),
    true
  );

  // Handler persists floating, shows the page panel, and closes the side panel.
  assert.equal(
    /target\?\.closest\("\.knoww-stack-popout"\)/.test(sidepanel),
    true
  );
  assert.equal(
    /KNOWW_SET_NOTIFICATION_PANEL_SURFACE[\s\S]*surface:\s*"floating"/.test(
      sidepanel
    ),
    true
  );
  // Ordering invariant: show the page panel BEFORE closing the side panel, and
  // close via window.close() (reliable from the panel's own page).
  assert.equal(
    /KNOWW_SET_NOTIFICATION_PANEL_SURFACE[\s\S]*KNOWW_SET_NOTIFICATION_STACK_VISIBILITY[\s\S]{0,300}closeWindow\(\)/.test(
      sidepanel
    ),
    true
  );

  // The new control is wired to a click listener.
  assert.equal(
    /target\?\.closest\("\.knoww-stack-popout"\)/.test(sidepanel),
    true
  );
});
