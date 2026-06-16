import assert from "node:assert/strict";
import { test } from "vitest";

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
