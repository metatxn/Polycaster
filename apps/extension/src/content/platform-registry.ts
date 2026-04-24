// ============================================
// PLATFORM REGISTRY
// Manages platform adapters for different social networks
// ============================================

import { createLogger } from "@knoww/logger";
import type { InjectionPoint, PlatformAdapter } from "../types/platform";

const log = createLogger("extension.platform-registry");

// Re-export types for consumers
export type {
  CardStyles,
  InjectionPoint,
  PlatformAdapter,
  ThemeStyles,
} from "../types/platform";

// Registry of all platform adapters
const platformAdapters = new Map<string, PlatformAdapter>();

// Current active platform adapter (cached)
let currentPlatformAdapter: PlatformAdapter | null = null;

/**
 * Register a platform adapter
 */
function registerPlatform(adapter: PlatformAdapter): void {
  if (!adapter?.name) {
    log.error("register.missing_name");
    return;
  }
  platformAdapters.set(adapter.name, adapter);
}

/**
 * Detect and return the current platform adapter based on hostname
 */
function detectPlatform(): PlatformAdapter | null {
  if (currentPlatformAdapter) {
    return currentPlatformAdapter;
  }

  const hostname =
    (typeof window !== "undefined" && window.location?.hostname) || "";

  for (const [_name, adapter] of platformAdapters) {
    if (adapter.hostPatterns && Array.isArray(adapter.hostPatterns)) {
      for (const pattern of adapter.hostPatterns) {
        if (pattern.test(hostname)) {
          currentPlatformAdapter = adapter;
          return adapter;
        }
      }
    }
  }

  return null;
}

/**
 * Get the current platform adapter (detects if not cached)
 */
function getCurrentPlatform(): PlatformAdapter | null {
  return currentPlatformAdapter || detectPlatform();
}

/**
 * Get platform adapter by name
 */
function getPlatform(name: string): PlatformAdapter | null {
  return platformAdapters.get(name) || null;
}

/**
 * Get all registered platform names
 */
function getRegisteredPlatforms(): string[] {
  return Array.from(platformAdapters.keys());
}

/**
 * Check if current site is a supported platform
 */
function isSupportedPlatform(): boolean {
  return detectPlatform() !== null;
}

/**
 * Get selectors for the current platform
 */
function getSelectors(): { item: string; container: string; text?: string } {
  const platform = getCurrentPlatform();
  if (!platform) {
    return {
      item: "article",
      container: "main",
      text: "p",
    };
  }
  return platform.selectors;
}

/**
 * Extract text from a post using the current platform adapter
 */
function extractPostText(postElement: Element): string {
  const platform = getCurrentPlatform();
  if (!platform || typeof platform.extractPostText !== "function") {
    return (postElement?.textContent || "").trim();
  }
  return platform.extractPostText(postElement);
}

/**
 * Find injection point for a post using the current platform adapter
 */
function findInjectionPoint(postElement: Element): InjectionPoint | null {
  const platform = getCurrentPlatform();
  if (!platform || typeof platform.findInjectionPoint !== "function") {
    return null;
  }
  return platform.findInjectionPoint(postElement);
}

/**
 * Get platform-specific card styles
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCardStyles(): any {
  const platform = getCurrentPlatform();
  if (!platform || typeof platform.getCardStyles !== "function") {
    return {};
  }
  return platform.getCardStyles();
}

/**
 * Get platform name
 */
function getPlatformName(): string {
  const platform = getCurrentPlatform();
  return platform?.name || "unknown";
}

/**
 * Reset cached platform (useful for testing)
 */
function resetPlatformCache(): void {
  currentPlatformAdapter = null;
}

/**
 * Register an adapter with retry logic.
 *
 * NOTE: With the deterministic import order in content/index.ts,
 * the registry is always available before adapters register. This function
 * is kept only as a defensive fallback — prefer direct registerPlatform() calls.
 *
 * Reduced max retries from 100 to 10 and interval from 50ms to 100ms
 * to avoid 5 seconds of polling when something is genuinely broken.
 */
function registerAdapterWithRetry(
  adapter: PlatformAdapter,
  maxRetries = 10,
  interval = 100
): void {
  // Fast path: registry is already available (normal case)
  if (
    window.KNOWW_PLATFORM &&
    typeof window.KNOWW_PLATFORM.registerPlatform === "function"
  ) {
    window.KNOWW_PLATFORM.registerPlatform(adapter);
    return;
  }

  // Slow path: retry if registry is somehow not ready
  let retryCount = 0;

  function attemptRegistration(): void {
    if (
      window.KNOWW_PLATFORM &&
      typeof window.KNOWW_PLATFORM.registerPlatform === "function"
    ) {
      window.KNOWW_PLATFORM.registerPlatform(adapter);
    } else if (retryCount < maxRetries) {
      retryCount++;
      setTimeout(attemptRegistration, interval);
    }
  }

  attemptRegistration();
}

// Export platform registry
export const KNOWW_PLATFORM = {
  // Registration
  registerPlatform,
  registerAdapterWithRetry,

  // Detection
  detectPlatform,
  getCurrentPlatform,
  getPlatform,
  getRegisteredPlatforms,
  isSupportedPlatform,
  getPlatformName,

  // Platform-delegated methods
  getSelectors,
  extractPostText,
  findInjectionPoint,
  getCardStyles,

  // Utilities
  resetPlatformCache,
};

window.KNOWW_PLATFORM = KNOWW_PLATFORM;

export { registerAdapterWithRetry };
