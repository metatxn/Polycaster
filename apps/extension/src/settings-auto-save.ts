import type { UserSettings } from "./types/settings";

export const SETTINGS_AUTO_SAVE_DELAY_MS = 250;

export function scheduleSettingsSave(
  settings: UserSettings,
  save: (settings: UserSettings) => void
): () => void {
  const timer = setTimeout(() => save(settings), SETTINGS_AUTO_SAVE_DELAY_MS);

  return () => clearTimeout(timer);
}
