// ============================================
// UTILITY FUNCTIONS
// ============================================

import type { BackgroundResponse } from "../types/chrome-messages";
import type { Market } from "../types/market";

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

export function escapeSelectorValue(value: string): string {
  if (typeof globalThis.CSS?.escape === "function") {
    return globalThis.CSS.escape(value);
  }

  // Fallback for runtimes without CSS.escape().
  const string = String(value);
  const length = string.length;
  const firstCodeUnit = string.charCodeAt(0);
  let index = -1;
  let output = "";

  while (++index < length) {
    const codeUnit = string.charCodeAt(index);

    if (codeUnit === 0x0000) {
      output += "\uFFFD";
      continue;
    }

    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 &&
        codeUnit >= 0x0030 &&
        codeUnit <= 0x0039 &&
        firstCodeUnit === 0x002d)
    ) {
      output += `\\${codeUnit.toString(16)} `;
      continue;
    }

    if (index === 0 && length === 1 && codeUnit === 0x002d) {
      output += `\\${string.charAt(index)}`;
      continue;
    }

    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      output += string.charAt(index);
      continue;
    }

    output += `\\${string.charAt(index)}`;
  }

  return output;
}

/**
 * Common stop words to ignore in search relevance matching.
 */
const STOP_WORDS = new Set([
  // Common English words (3+ chars)
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "had",
  "her",
  "was",
  "one",
  "our",
  "out",
  "has",
  "his",
  "how",
  "its",
  "may",
  "new",
  "now",
  "old",
  "see",
  "way",
  "who",
  "did",
  "get",
  "let",
  "put",
  "say",
  "she",
  "too",
  "use",
  "will",
  "with",
  "this",
  "that",
  "what",
  "when",
  "where",
  "which",
  "while",
  "about",
  "after",
  "before",
  "being",
  "between",
  "both",
  "each",
  "from",
  "have",
  "here",
  "just",
  "like",
  "make",
  "more",
  "most",
  "much",
  "must",
  "only",
  "other",
  "over",
  "same",
  "some",
  "such",
  "than",
  "them",
  "then",
  "there",
  "these",
  "they",
  "very",
  "would",
  "could",
  "should",
  "into",
  "been",
  "best",
  "many",
  "end",
  "top",
  "first",
  // Time-related words
  "year",
  "years",
  "week",
  "month",
  "today",
  "tomorrow",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  // Market-specific terms (too generic)
  "price",
  "market",
  "markets",
  "model",
  "company",
]);

/**
 * LRU Set: O(1) add/has/delete with automatic eviction of oldest entries.
 * Uses Map insertion order for LRU tracking — no Array.from() copies needed.
 */
class LRUSet {
  private map = new Map<string, true>();
  constructor(private maxSize: number) {}

  has(key: string): boolean {
    return this.map.has(key);
  }

  add(key: string): void {
    if (this.map.has(key)) {
      // Move to end (most recent) by re-inserting
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest entry (first key in Map iteration order)
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, true);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * Schedule a callback during idle time, with a fallback to setTimeout.
 * Eliminates repeated requestIdleCallback boilerplate throughout the codebase.
 */
function scheduleIdle(cb: () => void, timeout = 2000): void {
  if ("requestIdleCallback" in window) {
    (
      window as Window & {
        requestIdleCallback: (
          cb: () => void,
          opts?: { timeout: number }
        ) => number;
      }
    ).requestIdleCallback(cb, { timeout });
  } else {
    setTimeout(cb, 0);
  }
}

/**
 * Logger with prefix
 * Logs are shown ONLY when:
 * 1. Debug mode is enabled in settings, OR
 * 2. DEV_MODE is true in config
 *
 * Performance note: All logging is gated behind debugMode check.
 * No string operations or console output occur in production.
 */
function log(...args: unknown[]): void {
  // Early exit for production - no string operations at all
  const isDebug =
    window.KNOWW_CONFIG?.isDebugMode?.() ??
    window.KNOWW_CONFIG?.DEV_MODE ??
    false;

  if (!isDebug) return;

  console.log("[Knoww]", ...args);
}

// ============================================
// HOISTED CONSTANTS (module-scope for performance)
// Avoids re-creating Sets/RegExps on every function call
// ============================================

/** Combined non-Latin script regex — single pass instead of 10 separate patterns */
const NON_LATIN_RE =
  /[\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0400-\u04FF\u0E00-\u0E7F\u0590-\u05FF\u1100-\u11FF]/g;

/** Common English words for language detection (Set for O(1) lookup) */
const ENGLISH_INDICATORS = new Set([
  "the",
  "be",
  "to",
  "of",
  "and",
  "a",
  "in",
  "that",
  "have",
  "i",
  "it",
  "for",
  "not",
  "on",
  "with",
  "he",
  "as",
  "you",
  "do",
  "at",
  "this",
  "but",
  "his",
  "by",
  "from",
  "they",
  "we",
  "say",
  "her",
  "she",
  "or",
  "an",
  "will",
  "my",
  "one",
  "all",
  "would",
  "there",
  "their",
  "what",
  "so",
  "up",
  "out",
  "if",
  "about",
  "who",
  "get",
  "which",
  "go",
  "me",
  "when",
  "make",
  "can",
  "like",
  "time",
  "no",
  "just",
  "him",
  "know",
  "take",
  "people",
  "into",
  "year",
  "your",
  "good",
  "some",
  "could",
  "them",
  "see",
  "other",
  "than",
  "then",
  "now",
  "look",
  "only",
  "come",
  "its",
  "over",
  "think",
  "also",
  "back",
  "after",
  "use",
  "two",
  "how",
  "our",
  "work",
  "first",
  "well",
  "way",
  "even",
  "new",
  "want",
  "because",
  "any",
  "these",
  "give",
  "day",
  "most",
  "us",
]);

/**
 * Detect if text is English (UK, US, AUS)
 *
 * PERFORMANCE: Uses a single combined regex for non-Latin detection
 * and a hoisted Set for O(1) English word lookups.
 */
function isEnglishText(text: string): boolean {
  if (!text || text.length < 10) return false;

  // Single-pass non-Latin character detection (replaces 10 separate regex tests)
  NON_LATIN_RE.lastIndex = 0; // Reset global regex state
  const nonLatinMatches = text.match(NON_LATIN_RE);
  if (nonLatinMatches && nonLatinMatches.length > text.length * 0.1) {
    return false;
  }

  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return false;
  }

  let englishWordCount = 0;

  for (const word of words) {
    const cleanWord = word.replace(/[^a-z]/g, "");
    if (ENGLISH_INDICATORS.has(cleanWord)) {
      englishWordCount++;
    }
  }

  const englishRatio = englishWordCount / words.length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const latinRatio = text.length > 0 ? latinChars / text.length : 0;

  return englishRatio >= 0.15 && latinRatio >= 0.5;
}

/**
 * Check if extension context is still valid
 */
function isExtensionContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

/**
 * Safe wrapper for chrome.runtime.sendMessage
 */
function safeSendMessage(message: unknown): Promise<BackgroundResponse> {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      log("Extension context invalidated, skipping API call");
      resolve({ ok: false, error: "Extension context invalidated" });
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (data: BackgroundResponse) => {
        if (chrome.runtime.lastError) {
          log("Runtime error:", chrome.runtime.lastError.message);
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Unknown error",
          });
          return;
        }
        resolve(data || { ok: false, error: "No response" });
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log("SendMessage error:", error);
      resolve({ ok: false, error });
    }
  });
}

/**
 * Extract text content from a post element
 * Delegates to the platform adapter for platform-specific extraction
 */
function extractPostText(postElement: Element): string {
  try {
    // Use platform adapter if available
    if (
      window.KNOWW_PLATFORM &&
      typeof window.KNOWW_PLATFORM.extractPostText === "function"
    ) {
      return window.KNOWW_PLATFORM.extractPostText(postElement);
    }

    // Fallback: Try Twitter-specific selector first (backwards compatibility)
    const tweetTextEl = postElement.querySelector(
      'div[data-testid="tweetText"]'
    );
    if (tweetTextEl) {
      return (tweetTextEl.textContent || "").trim();
    }

    // Fallback: Try LinkedIn-specific selectors
    const linkedInSelectors = [
      ".feed-shared-text",
      ".update-components-text",
      ".feed-shared-update-v2__description",
    ];
    for (const selector of linkedInSelectors) {
      const el = postElement.querySelector(selector);
      if (el) {
        return (el.textContent || "").trim();
      }
    }

    // Final fallback: get any text content
    return (postElement.textContent || "").trim().slice(0, 500);
  } catch {
    return "";
  }
}

/**
 * Get emoji for market category
 */
function getEventEmoji(event: Market): string {
  const title = (event.title || "").toLowerCase();
  const tags = (event.tags || []).map((t) =>
    (t.slug || t.label || "").toLowerCase()
  );
  const allText = `${title} ${tags.join(" ")}`;

  if (
    /trump|biden|election|president|congress|democrat|republican|vote|kamala/.test(
      allText
    )
  )
    return "🗳️";
  if (/bitcoin|btc|ethereum|eth|crypto|solana|doge/.test(allText)) return "₿";
  if (/nfl|football|super bowl|touchdown/.test(allText)) return "🏈";
  if (/nba|basketball|lakers|celtics/.test(allText)) return "🏀";
  if (/mlb|baseball|world series/.test(allText)) return "⚾";
  if (/soccer|premier league|champions league|fifa/.test(allText)) return "⚽";
  if (/tennis|wimbledon/.test(allText)) return "🎾";
  if (/ufc|mma|boxing/.test(allText)) return "🥊";
  if (/apple|google|microsoft|amazon|meta|tesla|nvidia|ai/.test(allText))
    return "💻";
  if (/fed|interest rate|inflation|recession|stock/.test(allText)) return "📈";
  if (/oscar|grammy|emmy|movie|music/.test(allText)) return "🎬";
  if (/ukraine|russia|china|war|military/.test(allText)) return "🌍";
  if (/nasa|spacex|mars|moon|space/.test(allText)) return "🚀";
  if (/covid|vaccine|health/.test(allText)) return "🏥";

  return "📊";
}

// Export utilities
export const KNOWW_UTILS = {
  log,
  isEnglishText,
  isExtensionContextValid,
  safeSendMessage,
  extractPostText,
  getEventEmoji,
  STOP_WORDS,
  scheduleIdle,
  LRUSet,
};

window.KNOWW_UTILS = KNOWW_UTILS;

// Re-export for direct ES module imports
export { LRUSet, scheduleIdle };
