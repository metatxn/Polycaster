import type { Market } from "../types/market";
import type { TopicPreference, UserPreferences } from "../types/preferences";
import {
  DEFAULT_USER_PREFERENCES,
  MAX_CATEGORY_ENTRIES,
  MAX_PREFERENCE_BOOST,
  MAX_SOURCE_ENTRIES,
  MAX_TOPIC_ENTRIES,
  MIN_CLICKS_FOR_BOOST,
  PREFERENCE_BOOST_WEIGHTS,
  PREFERENCES_STORAGE_KEY,
} from "../types/preferences";

let preferences: UserPreferences = { ...DEFAULT_USER_PREFERENCES };
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const SAVE_DEBOUNCE_MS = 2000;

function canUseLocalStorage(): boolean {
  try {
    return (
      typeof chrome !== "undefined" &&
      !!chrome.runtime?.id &&
      !!chrome.storage?.local
    );
  } catch {
    return false;
  }
}

// ============================================
// PERSISTENCE
// ============================================

async function loadPreferences(): Promise<UserPreferences> {
  return new Promise((resolve) => {
    if (!canUseLocalStorage()) {
      preferences = { ...DEFAULT_USER_PREFERENCES };
      resolve(preferences);
      return;
    }

    try {
      chrome.storage.local.get(
        { [PREFERENCES_STORAGE_KEY]: DEFAULT_USER_PREFERENCES },
        (result) => {
          const stored = result[PREFERENCES_STORAGE_KEY] as
            | Partial<UserPreferences>
            | undefined;
          preferences = {
            ...DEFAULT_USER_PREFERENCES,
            ...(stored || {}),
          };
          resolve(preferences);
        }
      );
    } catch {
      preferences = { ...DEFAULT_USER_PREFERENCES };
      resolve(preferences);
    }
  });
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (canUseLocalStorage()) {
      try {
        chrome.storage.local.set(
          { [PREFERENCES_STORAGE_KEY]: preferences },
          () => {
            if (chrome.runtime.lastError) {
              // Save failed silently — nothing actionable for the user
            }
          }
        );
      } catch {
        // Extension context invalidated; ignore deferred saves from stale scripts
      }
    }
  }, SAVE_DEBOUNCE_MS);
}

async function resetPreferences(): Promise<void> {
  preferences = { ...DEFAULT_USER_PREFERENCES };
  if (canUseLocalStorage()) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(PREFERENCES_STORAGE_KEY, () => {
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }
}

function getPreferences(): UserPreferences {
  return preferences;
}

// ============================================
// EVICTION — remove oldest entries when at capacity
// ============================================

function evict(
  bucket: Record<string, TopicPreference>,
  maxEntries: number
): void {
  const keys = Object.keys(bucket);
  if (keys.length <= maxEntries) return;

  const sorted = keys.sort(
    (a, b) => bucket[a].lastInteraction - bucket[b].lastInteraction
  );
  const toRemove = sorted.slice(0, keys.length - maxEntries);
  for (const key of toRemove) {
    delete bucket[key];
  }
}

// ============================================
// SIGNAL EXTRACTION — derive slugs from a Market object
// ============================================

function extractTagSlugs(market: Market): string[] {
  const slugs: string[] = [];
  if (market.tags) {
    for (const tag of market.tags) {
      if (tag.slug) slugs.push(tag.slug.toLowerCase());
    }
  }
  return slugs;
}

function extractCategory(market: Market): string | null {
  if (market.category) return market.category.toLowerCase();
  if (market.tags && market.tags.length > 0) {
    const first = market.tags[0];
    if (first.slug) return first.slug.toLowerCase();
  }
  return null;
}

// ============================================
// RECORD SIGNALS
// ============================================

function updateBucket(
  bucket: Record<string, TopicPreference>,
  key: string,
  type: "click" | "ignore",
  maxEntries: number
): void {
  const now = Date.now();
  if (!bucket[key]) {
    bucket[key] = { clickCount: 0, ignoreCount: 0, lastInteraction: now };
  }
  const entry = bucket[key];
  if (type === "click") {
    entry.clickCount++;
  } else {
    entry.ignoreCount++;
  }
  entry.lastInteraction = now;
  evict(bucket, maxEntries);
}

function recordClick(market: Market): void {
  const now = Date.now();

  for (const slug of extractTagSlugs(market)) {
    updateBucket(preferences.topics, slug, "click", MAX_TOPIC_ENTRIES);
  }

  updateBucket(preferences.sources, market.source, "click", MAX_SOURCE_ENTRIES);

  const cat = extractCategory(market);
  if (cat) {
    updateBucket(preferences.categories, cat, "click", MAX_CATEGORY_ENTRIES);
  }

  preferences.totalClicks++;
  preferences.lastUpdated = now;
  scheduleSave();

  // Prevent this market from being counted as "ignored" by the visibility observer
  (window as any).KNOWW_INJECTION?.markClicked?.(market.id);
}

function recordIgnore(market: Market): void {
  const now = Date.now();

  for (const slug of extractTagSlugs(market)) {
    updateBucket(preferences.topics, slug, "ignore", MAX_TOPIC_ENTRIES);
  }

  updateBucket(
    preferences.sources,
    market.source,
    "ignore",
    MAX_SOURCE_ENTRIES
  );

  const cat = extractCategory(market);
  if (cat) {
    updateBucket(preferences.categories, cat, "ignore", MAX_CATEGORY_ENTRIES);
  }

  preferences.totalIgnores++;
  preferences.lastUpdated = now;
  scheduleSave();
}

// ============================================
// PREFERENCE BOOST — small nudge added to relevance score
// ============================================

function clickRatio(pref: TopicPreference): number {
  const total = pref.clickCount + pref.ignoreCount;
  if (total === 0) return 0;
  return Math.min(pref.clickCount / total, 1.0);
}

function getPreferenceBoost(market: Market): number {
  if (preferences.totalClicks < MIN_CLICKS_FOR_BOOST) return 0;

  let boost = 0;

  for (const slug of extractTagSlugs(market)) {
    const pref = preferences.topics[slug];
    if (pref && pref.clickCount > 0) {
      boost += PREFERENCE_BOOST_WEIGHTS.topic * clickRatio(pref);
    }
  }

  const sourcePref = preferences.sources[market.source];
  if (sourcePref && sourcePref.clickCount > 0) {
    boost += PREFERENCE_BOOST_WEIGHTS.source * clickRatio(sourcePref);
  }

  const cat = extractCategory(market);
  if (cat) {
    const catPref = preferences.categories[cat];
    if (catPref && catPref.clickCount > 0) {
      boost += PREFERENCE_BOOST_WEIGHTS.category * clickRatio(catPref);
    }
  }

  return Math.min(boost, MAX_PREFERENCE_BOOST);
}

// ============================================
// EXPORT
// ============================================

export const KNOWW_PREFERENCES = {
  loadPreferences,
  getPreferences,
  recordClick,
  recordIgnore,
  getPreferenceBoost,
  resetPreferences,
};

if (typeof window !== "undefined") {
  window.KNOWW_PREFERENCES = KNOWW_PREFERENCES;
  loadPreferences();
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (
      message: { type: string },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: { success: boolean }) => void
    ) => {
      if (message.type === "KNOWW_PREFERENCES_RESET") {
        resetPreferences().then(() => {
          sendResponse({ success: true });
        });
        return true; // keep message channel open for async sendResponse
      }
    }
  );
}
