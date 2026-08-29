import { afterEach, expect, test, vi } from "vitest";
import {
  SETTINGS_AUTO_SAVE_DELAY_MS,
  scheduleSettingsSave,
} from "../src/settings-auto-save";
import {
  DEFAULT_USER_SETTINGS,
  type UserSettings,
} from "../src/types/settings";

afterEach(() => {
  vi.useRealTimers();
});

test("auto-save keeps only the latest settings change during the delay", () => {
  vi.useFakeTimers();
  const save = vi.fn<(settings: UserSettings) => void>();
  const firstSettings = {
    ...DEFAULT_USER_SETTINGS,
    showNotificationStack: false,
  };
  const latestSettings = {
    ...firstSettings,
    usageAnalyticsEnabled: true,
  };

  const cancelFirstSave = scheduleSettingsSave(firstSettings, save);
  cancelFirstSave();
  scheduleSettingsSave(latestSettings, save);

  vi.advanceTimersByTime(SETTINGS_AUTO_SAVE_DELAY_MS - 1);
  expect(save).not.toHaveBeenCalled();

  vi.advanceTimersByTime(1);
  expect(save).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith(latestSettings);
});
