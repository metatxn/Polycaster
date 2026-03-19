/**
 * Lightweight personalization model types.
 * All data stays in chrome.storage.local (never synced, never sent to server).
 */

export interface TopicPreference {
  clickCount: number;
  ignoreCount: number;
  lastInteraction: number;
}

export interface UserPreferences {
  topics: Record<string, TopicPreference>;
  sources: Record<string, TopicPreference>;
  categories: Record<string, TopicPreference>;
  totalClicks: number;
  totalIgnores: number;
  lastUpdated: number;
}

export const MAX_TOPIC_ENTRIES = 50;
export const MAX_CATEGORY_ENTRIES = 15;
export const MAX_SOURCE_ENTRIES = 5;

export const MIN_CLICKS_FOR_BOOST = 3;
export const MAX_PREFERENCE_BOOST = 0.15;

export const PREFERENCE_BOOST_WEIGHTS = {
  topic: 0.05,
  source: 0.03,
  category: 0.04,
} as const;

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  topics: {},
  sources: {},
  categories: {},
  totalClicks: 0,
  totalIgnores: 0,
  lastUpdated: 0,
};

export const PREFERENCES_STORAGE_KEY = "knowwPreferences";
