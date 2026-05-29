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
