// ============================================
// TIMELINE INJECTION LOGIC
// ============================================

import type {
  ContextGateResult,
  ScoreMarketsSuccessResponse,
} from "../types/chrome-messages";
import type {
  InjectedMarketEntry,
  Market,
  MarketSearchResult,
} from "../types/market";
import {
  type RelevanceTelemetryCandidate,
  recordRelevanceTelemetry,
} from "./relevance-telemetry";
import {
  buildMarketGateText,
  determineScoringMode,
  evaluateCandidateGate,
  FAIL_OPEN_FLOOR,
  getEffectiveThreshold,
  naiveContextGate,
  type ScoringMode,
  shouldFailOpen,
} from "./scoring-policy";
import {
  escapeSelectorValue,
  LRUSet,
  safeSendMessage,
  scheduleIdle,
} from "./utils";

/**
 * Injection point for market cards (local type to avoid circular import)
 */
interface InjectionPoint {
  container: Element;
  cellInnerDiv?: Element;
  postWrapper?: Element;
  cleanup?: () => void;
  referenceElement?: Element | null | undefined;
  insertPosition: "append" | "before" | "after";
}

// State management
const analyzedPosts = new WeakSet<Element>();
const injectedMarketIds = new Set<string>();
const injectedPostMarketPairs = new Set<string>();
const activePostKeysByMarket = new Map<string, Set<string>>();
const MAX_ACTIVE_POSTS_PER_MARKET = 3; // Allow same market on up to 3 active posts at once
const MAX_CANDIDATES_PER_POST = 2; // Keep a small fallback pool per post without increasing render density
// Default per-scan cap. Platforms can raise this by setting
// `maxInjectionsPerBatch` on their adapter (see `resolveMaxInjectionsPerBatch`).
const MAX_INJECTIONS_PER_BATCH = 5;
const XENCODER_AB_PREFIX = "[XENCODER-AB]";
const XENCODER_RERANK_TOP_K = 5;
const XENCODER_STATS_INTERVAL = 20;

const xencoderStats = {
  calls: 0,
  skippedSingleCandidate: 0,
  totalCandidates: 0,
  elapsedMs: [] as number[],
  queueWaitMs: [] as number[],
};

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function recordXencoderResult(
  candidateCount: number,
  elapsedMs: number,
  queueWaitMs: number
): void {
  xencoderStats.calls++;
  xencoderStats.totalCandidates += candidateCount;
  xencoderStats.elapsedMs.push(elapsedMs);
  xencoderStats.queueWaitMs.push(queueWaitMs);
}

function maybeLogXencoderStats(log: (...args: unknown[]) => void): void {
  const observed = xencoderStats.calls + xencoderStats.skippedSingleCandidate;
  if (observed === 0 || observed % XENCODER_STATS_INTERVAL !== 0) return;

  log(`${XENCODER_AB_PREFIX} stats`, {
    calls: xencoderStats.calls,
    skippedSingleCandidate: xencoderStats.skippedSingleCandidate,
    avgCandidates:
      xencoderStats.calls === 0
        ? 0
        : Number(
            (xencoderStats.totalCandidates / xencoderStats.calls).toFixed(2)
          ),
    p50Ms: percentile(xencoderStats.elapsedMs, 50),
    p95Ms: percentile(xencoderStats.elapsedMs, 95),
    maxMs: Math.max(0, ...xencoderStats.elapsedMs),
    p50QueueWaitMs: percentile(xencoderStats.queueWaitMs, 50),
    p95QueueWaitMs: percentile(xencoderStats.queueWaitMs, 95),
  });
}

function resolveMaxInjectionsPerBatch(): number {
  const override =
    window.KNOWW_PLATFORM?.getCurrentPlatform?.()?.maxInjectionsPerBatch;
  if (typeof override === "number" && override > 0) {
    return Math.floor(override);
  }
  return MAX_INJECTIONS_PER_BATCH;
}
const ANALYZE_BATCH_CONCURRENCY = 3;
const POST_CANDIDATE_SCORE_GAP = 0.08; // Don't keep weak fallback candidates for a post
const injectedIntoPosts = new WeakSet<Element>(); // Track which posts have cards
const injectedMarkets: InjectedMarketEntry[] = []; // Track injected markets with WeakRef to DOM elements for notification stack
const liveInjectedCardRefs = new Map<string, LiveInjectedCardRef>();
let postsSinceLastInjection = 0;
let totalPostsProcessed = 0;
let isAnalyzing = false;
let invalidExtensionContextLogged = false;
// PERFORMANCE: LRU Set replaces plain Set — O(1) eviction, no Array.from() copies
const processedPostKeys = new LRUSet(150);
const MAX_INJECTED_MARKETS = 20; // Keep bounded recent history for notification stack (active + scrolled-out)
let lastMemoryCleanup = Date.now();
const MEMORY_CLEANUP_INTERVAL = 30000; // Run memory cleanup every 30 seconds
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let cardVisibilityObserver: IntersectionObserver | null = null;
let notificationStackUpdateDebounce: ReturnType<typeof setTimeout> | null =
  null;
const FEED_READY_MIN_POSTS = 1;
const FEED_READY_CHECK_INTERVAL_MS = 250;
const INITIAL_SCAN_IDLE_TIMEOUT_MS = 500;
const QUEUED_POST_PROCESS_IDLE_TIMEOUT_MS = 250;
const PERIODIC_QUEUE_DRAIN_IDLE_TIMEOUT_MS = 500;
const PERIODIC_SCAN_IDLE_TIMEOUT_MS = 1000;
const SCROLL_SCAN_IDLE_TIMEOUT_MS = 500;
const RESUME_QUEUE_DRAIN_IDLE_TIMEOUT_MS = 250;
const RESUME_INITIAL_SCAN_IDLE_TIMEOUT_MS = 500;

const IGNORE_VISIBILITY_THRESHOLD_MS = 5000;
const clickedMarketIds = new Set<string>();
const cardFirstVisibleAt = new Map<string, number>();

interface BestBySourceEntry {
  market: Market | null;
  score: number;
  allScores: Array<{
    title: string | undefined;
    score: string;
    meetsThreshold: boolean;
  }>;
}

interface AnalysisResult {
  markets: MarketSearchResult[];
  topics: string[];
  postText: string;
}

interface BatchCandidateSelection {
  post: Element;
  postKey: string;
  topics: string[];
  markets: MarketSearchResult[];
}

interface AllocatedInjection {
  post: Element;
  postKey: string;
  topics: string[];
  market: MarketSearchResult;
}

interface PendingPostEntry {
  post: Element;
  key: string | null;
}

function hasValidExtensionContextForProcessing(context: string): boolean {
  const isValid = window.KNOWW_UTILS?.isExtensionContextValid?.() ?? true;
  if (isValid) {
    invalidExtensionContextLogged = false;
    return true;
  }

  if (!invalidExtensionContextLogged) {
    window.KNOWW_UTILS?.log(
      `🛑 [${context}] Extension context invalidated. Reload this page after updating or reloading Knoww to reconnect market search.`
    );
    invalidExtensionContextLogged = true;
  }

  window.KNOWW_INJECTION_WATCHER?.stop?.();
  return false;
}

function isScoreMarketsSuccessResponse(
  response: unknown
): response is ScoreMarketsSuccessResponse {
  return (
    !!response &&
    typeof response === "object" &&
    "ok" in response &&
    response.ok === true &&
    "similarities" in response &&
    Array.isArray(response.similarities) &&
    "bm25Scores" in response &&
    Array.isArray(response.bm25Scores)
  );
}

interface LiveInjectedCardRef {
  marketId: string;
  cardRef: WeakRef<HTMLElement>;
}

interface ReinjectionCandidate {
  postKey: string;
  market: Market;
  score: number;
  topics: string[];
  timestamp: number;
}

const reinjectionCandidatesByTrackingKey = new Map<
  string,
  ReinjectionCandidate
>();
const reinjectionTrackingKeysByPostKey = new Map<string, Set<string>>();

function applyPlatformStyleVariables(
  element: HTMLElement,
  styles: Record<string, unknown> | null | undefined
): void {
  if (!styles) return;

  const styleMap: Record<string, string> = {
    "--knoww-bg": "backgroundColor",
    "--knoww-border": "borderColor",
    "--knoww-text": "textColor",
    "--knoww-text-secondary": "secondaryTextColor",
    "--knoww-card-bg": "cardBg",
    "--knoww-accent": "accentColor",
    "--knoww-font": "fontFamily",
    "--knoww-radius": "borderRadius",
  };

  for (const [cssVariable, key] of Object.entries(styleMap)) {
    const value = styles[key];
    if (typeof value === "string" && value) {
      element.style.setProperty(cssVariable, value);
    }
  }
}

function getCardTrackingKey(
  card: HTMLElement | null,
  marketId: string
): string {
  const postKey = card?.getAttribute("data-knoww-post-key");
  return postKey ? getPostMarketPairKey(postKey, marketId) : marketId;
}

function getPostMarketPairKey(postKey: string, marketId: string): string {
  return JSON.stringify([postKey, marketId]);
}

function rememberReinjectionCandidate(
  postKey: string,
  market: Market,
  score: number,
  topics: string[]
): void {
  const trackingKey = getPostMarketPairKey(postKey, market.id);
  reinjectionCandidatesByTrackingKey.set(trackingKey, {
    postKey,
    market,
    score,
    topics: [...topics],
    timestamp: Date.now(),
  });

  let trackingKeys = reinjectionTrackingKeysByPostKey.get(postKey);
  if (!trackingKeys) {
    trackingKeys = new Set<string>();
    reinjectionTrackingKeysByPostKey.set(postKey, trackingKeys);
  }
  trackingKeys.add(trackingKey);
}

function forgetReinjectionCandidate(
  postKey: string | undefined,
  marketId: string
): void {
  if (!postKey) return;

  const trackingKey = getPostMarketPairKey(postKey, marketId);
  reinjectionCandidatesByTrackingKey.delete(trackingKey);

  const trackingKeys = reinjectionTrackingKeysByPostKey.get(postKey);
  if (!trackingKeys) return;

  trackingKeys.delete(trackingKey);
  if (trackingKeys.size === 0) {
    reinjectionTrackingKeysByPostKey.delete(postKey);
  }
}

function getReinjectionCandidatesForPost(
  postKey: string
): ReinjectionCandidate[] {
  const trackingKeys = reinjectionTrackingKeysByPostKey.get(postKey);
  if (!trackingKeys || trackingKeys.size === 0) {
    return [];
  }

  return Array.from(trackingKeys)
    .map((trackingKey) => reinjectionCandidatesByTrackingKey.get(trackingKey))
    .filter((candidate): candidate is ReinjectionCandidate => !!candidate)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function getActivePostCountForMarket(marketId: string): number {
  return activePostKeysByMarket.get(marketId)?.size ?? 0;
}

function isMarketInjectableForPost(postKey: string, marketId: string): boolean {
  return (
    !injectedPostMarketPairs.has(getPostMarketPairKey(postKey, marketId)) &&
    getActivePostCountForMarket(marketId) < MAX_ACTIVE_POSTS_PER_MARKET
  );
}

function selectTopCandidatesForPost(
  candidates: MarketSearchResult[]
): MarketSearchResult[] {
  if (candidates.length === 0) return [];

  const sorted = [...candidates].sort((a, b) => {
    if (
      typeof a.rerankScore === "number" &&
      typeof b.rerankScore === "number"
    ) {
      return b.rerankScore - a.rerankScore;
    }
    return b.score - a.score;
  });
  const topScore = sorted[0].score;
  const minimumScore = Math.max(0, topScore - POST_CANDIDATE_SCORE_GAP);

  return sorted
    .filter((entry) => entry.score >= minimumScore)
    .slice(0, MAX_CANDIDATES_PER_POST);
}

function syncInjectedCardTrackingFromDom(): void {
  injectedMarketIds.clear();
  injectedPostMarketPairs.clear();
  activePostKeysByMarket.clear();
  const liveTrackingKeys = new Set<string>();

  for (const [trackingKey, entry] of Array.from(
    liveInjectedCardRefs.entries()
  )) {
    const card = entry.cardRef.deref();
    if (!card?.isConnected) {
      liveInjectedCardRefs.delete(trackingKey);
      continue;
    }

    const marketId =
      card.getAttribute("data-knoww-market-id") || entry.marketId;
    if (!marketId) continue;

    injectedMarketIds.add(marketId);
    liveTrackingKeys.add(trackingKey);

    const postKey = card.getAttribute("data-knoww-post-key");
    if (!postKey) continue;

    injectedPostMarketPairs.add(trackingKey);

    let activePosts = activePostKeysByMarket.get(marketId);
    if (!activePosts) {
      activePosts = new Set<string>();
      activePostKeysByMarket.set(marketId, activePosts);
    }
    activePosts.add(postKey);
  }

  for (const marketId of Array.from(clickedMarketIds)) {
    if (!injectedMarketIds.has(marketId)) {
      clickedMarketIds.delete(marketId);
    }
  }

  for (const trackingKey of Array.from(cardFirstVisibleAt.keys())) {
    if (
      !liveTrackingKeys.has(trackingKey) &&
      !injectedMarketIds.has(trackingKey)
    ) {
      cardFirstVisibleAt.delete(trackingKey);
    }
  }
}

function allocateBatchInjections(
  selections: BatchCandidateSelection[]
): AllocatedInjection[] {
  if (selections.length === 0) return [];

  syncInjectedCardTrackingFromDom();

  const orderedSelections = [...selections].sort(
    (a, b) => (b.markets[0]?.score ?? 0) - (a.markets[0]?.score ?? 0)
  );

  const planned: AllocatedInjection[] = [];
  const plannedPostMarketPairs = new Set<string>();
  const plannedPostKeys = new Set<string>();
  const plannedActiveCounts = new Map<string, number>();
  const maxInjections = resolveMaxInjectionsPerBatch();

  for (const [marketId, activePosts] of activePostKeysByMarket.entries()) {
    plannedActiveCounts.set(marketId, activePosts.size);
  }

  for (const selection of orderedSelections) {
    if (planned.length >= maxInjections) break;
    if (plannedPostKeys.has(selection.postKey)) continue;

    const chosenMarket = selection.markets.find(({ market }) => {
      const pairKey = getPostMarketPairKey(selection.postKey, market.id);
      if (plannedPostMarketPairs.has(pairKey)) return false;
      if (!isMarketInjectableForPost(selection.postKey, market.id))
        return false;

      return (
        (plannedActiveCounts.get(market.id) ??
          getActivePostCountForMarket(market.id)) < MAX_ACTIVE_POSTS_PER_MARKET
      );
    });

    if (!chosenMarket) continue;

    const chosenPairKey = getPostMarketPairKey(
      selection.postKey,
      chosenMarket.market.id
    );
    plannedPostMarketPairs.add(chosenPairKey);
    plannedPostKeys.add(selection.postKey);
    plannedActiveCounts.set(
      chosenMarket.market.id,
      (plannedActiveCounts.get(chosenMarket.market.id) ??
        getActivePostCountForMarket(chosenMarket.market.id)) + 1
    );

    planned.push({
      post: selection.post,
      postKey: selection.postKey,
      topics: selection.topics,
      market: chosenMarket,
    });
  }

  return planned;
}

const cooldownPendingPosts: PendingPostEntry[] = [];

function enqueueCooldownPendingPosts(posts: PendingPostEntry[]): number {
  let added = 0;

  for (const entry of posts) {
    if (!entry.post.isConnected) continue;

    const exists = entry.key
      ? cooldownPendingPosts.some((pending) => pending.key === entry.key)
      : cooldownPendingPosts.some((pending) => pending.post === entry.post);

    if (exists) continue;

    cooldownPendingPosts.push(entry);
    added++;
  }

  return added;
}

function dequeueCooldownPendingPosts(itemSelector: string): PendingPostEntry[] {
  const drained = cooldownPendingPosts.splice(0, cooldownPendingPosts.length);
  const ready: PendingPostEntry[] = [];

  for (const entry of drained) {
    const { post, key } = entry;
    if (!post.isConnected) continue;

    const parentPost = post.parentElement?.closest(itemSelector);
    if (parentPost && parentPost !== post) continue;

    if (key && processedPostKeys.has(key)) continue;
    if (analyzedPosts.has(post)) continue;

    ready.push(entry);
  }

  return ready;
}

async function scoreMarketsBatch(
  postText: string,
  marketTexts: string[],
  gateTexts: string[],
  features: {
    includeEmbeddings?: boolean;
    includeBm25?: boolean;
    includeContextGate?: boolean;
    includeRerank?: boolean;
  } = {}
): Promise<{
  similarities: number[];
  bm25Scores: number[];
  rerankScores: number[];
  rerankMetrics?: ScoreMarketsSuccessResponse["rerankMetrics"];
  contextGateResults: ContextGateResult[];
  usedEmbeddings: boolean;
  usedRerank: boolean;
  source: "offscreen" | "fallback";
}> {
  const {
    includeEmbeddings = true,
    includeBm25 = true,
    includeContextGate = true,
    includeRerank = false,
  } = features;

  try {
    const response = await safeSendMessage({
      type: "score-markets",
      postText,
      marketTexts,
      gateTexts,
      includeEmbeddings,
      includeBm25,
      includeContextGate,
      includeRerank,
    });

    if (isScoreMarketsSuccessResponse(response)) {
      const contextGateResults = Array.isArray(response.contextGateResults)
        ? response.contextGateResults
        : [];
      return {
        similarities: response.similarities,
        bm25Scores: response.bm25Scores,
        rerankScores: response.rerankScores ?? [],
        rerankMetrics: response.rerankMetrics,
        contextGateResults,
        usedEmbeddings: response.usedEmbeddings ?? true,
        usedRerank: response.usedRerank ?? false,
        source: "offscreen",
      };
    }
  } catch {
    // fall through to fallback path
  }

  const fallbackScores = new Array<number>(marketTexts.length).fill(0);
  const fallbackGateResults: ContextGateResult[] = includeContextGate
    ? gateTexts.map((gateText) => naiveContextGate(postText, gateText))
    : [];
  return {
    similarities: fallbackScores,
    bm25Scores: fallbackScores,
    rerankScores: [],
    contextGateResults: fallbackGateResults,
    usedEmbeddings: false,
    usedRerank: false,
    source: "fallback",
  };
}

/**
 * Best-effort logical identity for a post element.
 * LinkedIn reuses DOM nodes, so rely on data-urn/data-id when present,
 * otherwise fall back to a lightweight text snippet hash.
 * Reddit uses id attribute on shreddit-post elements (e.g., "t3_1qawn4w")
 *
 * PERFORMANCE: Uses textContent (not innerText) for fallback to avoid
 * triggering expensive layout/style computations.
 */
function getPostIdentityKey(post: Element): string | null {
  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  if (platform && typeof platform.getPostId === "function") {
    const platformPostId = platform.getPostId(post);
    if (platformPostId) {
      return `${platform.name}:${platformPostId}`;
    }
  }

  // Reddit: shreddit-post has id="t3_xxxxx" directly on the element
  if (post.tagName?.toLowerCase() === "shreddit-post") {
    const redditId = post.getAttribute("id") || post.getAttribute("post-id");
    if (redditId) return `reddit:${redditId}`;
  }

  // LinkedIn/Twitter: data-urn, data-id, data-entity-urn
  const attrKey =
    post.getAttribute("data-urn") ||
    post.getAttribute("data-id") ||
    post.getAttribute("data-entity-urn") ||
    post.querySelector?.("[data-urn]")?.getAttribute("data-urn") ||
    post.querySelector?.("[data-id]")?.getAttribute("data-id");

  if (attrKey) return attrKey;

  // Twitter/X: Extract stable tweet ID from status link (e.g., /status/1234567890)
  // This is more reliable than text content and avoids expensive DOM reads
  const statusLink = post.querySelector('a[href*="/status/"]');
  if (statusLink) {
    const href = statusLink.getAttribute("href") || "";
    const match = href.match(/\/status\/(\d+)/);
    if (match) return `tweet:${match[1]}`;
  }

  // Fallback: small text snippet using textContent (NOT innerText)
  // textContent is much cheaper as it doesn't trigger layout/style calculations
  const snippet = ((post as HTMLElement).textContent || "")
    .slice(0, 160)
    .trim();
  return snippet ? `txt:${snippet}` : null;
}

function getCurrentItemSelector(): string | null {
  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  if (platform?.getDynamicSelectors) {
    return platform.getDynamicSelectors().itemSelector;
  }

  return window.KNOWW_PLATFORM?.getSelectors?.().item || null;
}

function findPostByKey(
  postKey: string,
  posts?: Array<{ post: Element; key: string | null }>
): Element | null {
  const itemSelector = getCurrentItemSelector();
  const candidates = posts
    ? posts.map(({ post, key }) => ({
        post,
        key: key ?? getPostIdentityKey(post),
      }))
    : itemSelector
      ? Array.from(document.querySelectorAll(itemSelector)).map((post) => ({
          post,
          key: getPostIdentityKey(post),
        }))
      : [];

  for (const candidate of candidates) {
    if (candidate.key === postKey) {
      return candidate.post;
    }
  }

  return null;
}

function upsertInjectedMarketEntry(
  postKey: string,
  market: Market,
  card: HTMLElement
): void {
  const now = Date.now();
  const existingEntry = injectedMarkets.find(
    (entry) => entry.postKey === postKey && entry.market.id === market.id
  );

  if (existingEntry) {
    existingEntry.market = market;
    existingEntry.cardRef = new WeakRef(card);
    existingEntry.postKey = postKey;
    existingEntry.timestamp = now;
    existingEntry.isInViewport = true;
    existingEntry.lastVisibleAt = now;
    return;
  }

  injectedMarkets.push({
    market,
    cardRef: new WeakRef(card),
    postKey,
    timestamp: now,
    isInViewport: true,
    lastVisibleAt: now,
  });
}

function refreshLiveTrackingForPost(post: Element, postKey: string): void {
  const cards = post.querySelectorAll<HTMLElement>(".knoww-market-card");
  if (cards.length === 0) return;

  for (const card of Array.from(cards)) {
    const marketId = card.getAttribute("data-knoww-market-id");
    if (!marketId) continue;

    const trackingKey = getPostMarketPairKey(postKey, marketId);
    liveInjectedCardRefs.set(trackingKey, {
      marketId,
      cardRef: new WeakRef(card),
    });
    injectedMarketIds.add(marketId);
    injectedPostMarketPairs.add(trackingKey);

    let activePosts = activePostKeysByMarket.get(marketId);
    if (!activePosts) {
      activePosts = new Set<string>();
      activePostKeysByMarket.set(marketId, activePosts);
    }
    activePosts.add(postKey);

    const trackedMarket =
      reinjectionCandidatesByTrackingKey.get(trackingKey)?.market ||
      injectedMarkets.find(
        (entry) => entry.postKey === postKey && entry.market.id === marketId
      )?.market;

    if (trackedMarket) {
      upsertInjectedMarketEntry(postKey, trackedMarket, card);
    }

    ensureCardVisibilityObserver();
    cardVisibilityObserver?.observe(card);
  }
}

function restoreTrackedMarketsOnPost(post: Element, postKey: string): boolean {
  const trackedMarkets = getReinjectionCandidatesForPost(postKey);
  if (trackedMarkets.length === 0) return false;

  refreshLiveTrackingForPost(post, postKey);

  const alreadyInjected = post.querySelector(
    ".knoww-market-card[data-knoww-market-id]"
  );
  if (alreadyInjected) {
    return true;
  }

  const [latestMarket] = trackedMarkets;
  return injectMarketCards(
    post,
    [
      {
        market: latestMarket.market,
        score: latestMarket.score,
        source: latestMarket.market.source || "polymarket",
      },
    ],
    latestMarket.topics,
    { postKey }
  );
}

function restoreTrackedMarket(postKey: string, marketId: string): boolean {
  syncInjectedCardTrackingFromDom();

  const targetPost = findPostByKey(postKey);
  if (!targetPost) return false;

  refreshLiveTrackingForPost(targetPost, postKey);

  const escapedMarketId = escapeSelectorValue(marketId);
  const existingCard = targetPost.querySelector<HTMLElement>(
    `.knoww-market-card[data-knoww-market-id="${escapedMarketId}"]`
  );
  if (existingCard) {
    return true;
  }

  const candidate = reinjectionCandidatesByTrackingKey.get(
    getPostMarketPairKey(postKey, marketId)
  );
  if (!candidate) {
    return false;
  }

  return injectMarketCards(
    targetPost,
    [
      {
        market: candidate.market,
        score: candidate.score,
        source: candidate.market.source || "polymarket",
      },
    ],
    candidate.topics,
    { postKey }
  );
}

/**
 * Prune stale entries from injectedMarkets array.
 * Delegates to the unified runMemoryCleanup which handles all cleanup tasks.
 */
function pruneStaleMarkets(): void {
  runMemoryCleanup(true);
}

/**
 * Start periodic pruning (lifecycle-managed)
 */
function startCleanupInterval(): void {
  if (cleanupIntervalId) return;
  cleanupIntervalId = setInterval(() => {
    pruneStaleMarkets();
    runMemoryCleanup();
  }, MEMORY_CLEANUP_INTERVAL);
}

/**
 * Stop periodic pruning (lifecycle-managed)
 */
function stopCleanupInterval(): void {
  if (!cleanupIntervalId) return;
  clearInterval(cleanupIntervalId);
  cleanupIntervalId = null;
}

/**
 * Debounced notification stack refresh to avoid thrashing on rapid visibility changes.
 */
function scheduleNotificationStackUpdate(): void {
  if (!window.KNOWW_UI?.updateNotificationStack) return;
  if (notificationStackUpdateDebounce) {
    clearTimeout(notificationStackUpdateDebounce);
  }
  notificationStackUpdateDebounce = setTimeout(() => {
    notificationStackUpdateDebounce = null;
    window.KNOWW_UI.updateNotificationStack(injectedMarkets);
  }, 120);
}

/**
 * Observe injected cards so we can classify "active" (in viewport) vs "scrolled out".
 */
function ensureCardVisibilityObserver(): void {
  if (cardVisibilityObserver || typeof IntersectionObserver === "undefined") {
    return;
  }

  cardVisibilityObserver = new IntersectionObserver(
    (entries) => {
      let hasStateChange = false;

      const marketIndex = new Map<string, number>();
      for (let i = 0; i < injectedMarkets.length; i++) {
        const trackedCard = injectedMarkets[i].cardRef?.deref?.();
        if (!trackedCard?.isConnected) continue;

        const trackedMarketId =
          trackedCard.getAttribute("data-knoww-market-id") ||
          injectedMarkets[i].market.id;
        marketIndex.set(getCardTrackingKey(trackedCard, trackedMarketId), i);
      }

      for (const observerEntry of entries) {
        const card = observerEntry.target as HTMLElement | null;
        const marketId = card?.getAttribute?.("data-knoww-market-id");
        if (!marketId) continue;

        const trackingKey = getCardTrackingKey(card, marketId);
        const idx = marketIndex.get(trackingKey);
        if (idx === undefined) continue;

        const tracked = injectedMarkets[idx];
        const isInViewport =
          observerEntry.isIntersecting &&
          observerEntry.intersectionRatio >= 0.25;

        const wasInViewport = tracked.isInViewport === true;

        if (tracked.isInViewport !== isInViewport) {
          tracked.isInViewport = isInViewport;
          hasStateChange = true;
        }

        if (isInViewport) {
          tracked.lastVisibleAt = Date.now();
          if (!cardFirstVisibleAt.has(trackingKey)) {
            cardFirstVisibleAt.set(trackingKey, Date.now());
          }
        }

        if (wasInViewport && !isInViewport) {
          const firstSeen = cardFirstVisibleAt.get(trackingKey);
          if (
            firstSeen &&
            Date.now() - firstSeen >= IGNORE_VISIBILITY_THRESHOLD_MS &&
            !clickedMarketIds.has(marketId)
          ) {
            window.KNOWW_PREFERENCES?.recordIgnore(tracked.market);
            void window.KNOWW_ANALYTICS?.track("market_card_ignored", {
              marketId,
              source: tracked.market.source || "polymarket",
              visibleDurationMs: Date.now() - firstSeen,
            });
          }
          cardFirstVisibleAt.delete(trackingKey);
        }
      }

      if (hasStateChange) {
        scheduleNotificationStackUpdate();
      }
    },
    {
      root: null,
      threshold: [0, 0.25, 0.5],
    }
  );
}

/**
 * Analyze a SINGLE post and find matching markets from ALL sources
 * Returns the best market from EACH source (Polymarket, Kalshi, etc.)
 * This enables showing stacked cards from multiple sources
 */
async function analyzePostAndFindMarket(
  post: Element
): Promise<AnalysisResult | null> {
  const { log, isEnglishText, extractPostText } = window.KNOWW_UTILS;
  const {
    extractSearchKeywords,
    searchAllMarkets,
    calculateRelevanceScore,
    resolvePolymarketMarketsFromHints,
  } = window.KNOWW_API;
  const { CONFIG, ENABLED_SOURCES } = window.KNOWW_CONFIG;
  const currentPlatform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  const isDebug =
    window.KNOWW_CONFIG?.isDebugMode?.() ??
    window.KNOWW_CONFIG?.DEV_MODE ??
    false;

  const extractedText = extractPostText(post);
  const linkHints =
    currentPlatform
      ?.extractMarketLinkHints?.(post)
      ?.filter((hint) => hint.source === "polymarket") || [];
  const directMarkets =
    linkHints.length > 0
      ? await resolvePolymarketMarketsFromHints(linkHints)
      : [];
  const directMarketText = directMarkets
    .map((market) => market.title)
    .filter(Boolean)
    .join(" ");
  const hintText = linkHints
    .map((hint) => hint.title)
    .filter(Boolean)
    .join(" ");
  const text = [extractedText, directMarketText, hintText]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const postKey = getPostIdentityKey(post) ?? undefined;

  if ((!text || text.length < 20) && directMarkets.length === 0) {
    log("Post text too short:", text?.slice(0, 30));
    return null;
  }

  if (
    directMarkets.length === 0 &&
    !currentPlatform?.bypassEnglishCheck &&
    !isEnglishText(text)
  ) {
    log("Skipping non-English post:", `${text.slice(0, 50)}...`);
    return null;
  }

  if (isDebug) {
    log("Analyzing single post:", `${text.slice(0, 100)}...`);
  }

  const result = await extractSearchKeywords(text);

  if (
    !result.keywords?.trim() &&
    result.matchedTags.length === 0 &&
    directMarkets.length === 0
  ) {
    log("No keywords or tags extracted from post");
    return null;
  }

  if (isDebug) {
    log("Extracted:", {
      keywords: result.keywords.slice(0, 80),
      tags: result.matchedTags,
    });
  }

  // Search ALL enabled sources (Polymarket + Kalshi), then prepend exact
  // markets from direct Polymarket link cards.
  const searchedMarkets =
    result.keywords?.trim() || result.matchedTags.length > 0
      ? await searchAllMarkets(result.keywords, result.matchedTags)
      : [];
  const directMarketIds = new Set(directMarkets.map((market) => market.id));
  const markets: Market[] = [];
  const seenMarkets = new Set<string>();
  for (const market of [...directMarkets, ...searchedMarkets]) {
    const key = market.id || market.slug || market.title;
    if (!key || seenMarkets.has(key)) continue;
    seenMarkets.add(key);
    markets.push(market);
  }

  if (markets.length === 0) {
    log("No markets found for this post from any source");
    return null;
  }

  // --- BATCH SCORING WITH EMBEDDINGS + BM25 ---
  let marketScores: number[] = [];
  let contextGateResults: ContextGateResult[] = [];
  let marketTexts: string[] = [];
  let gateTexts: string[] = [];
  const rerankScoresByIndex = new Map<number, number>();
  let scoringMode: ScoringMode = "heuristic";
  try {
    marketTexts = markets.map((m) => {
      let rich = m.title || "";
      const tagStr = (m.tags || [])
        .map((t) => t.label || t.slug || "")
        .filter(Boolean)
        .slice(0, 5)
        .join(", ");
      if (tagStr) rich += ` [${tagStr}]`;
      if (m.description) rich += ` ${m.description.slice(0, 120)}`;
      return rich;
    });

    gateTexts = markets.map((market) => buildMarketGateText(market));

    const scoring = await scoreMarketsBatch(text, marketTexts, gateTexts);
    contextGateResults = scoring.contextGateResults;

    const hasBm25Signal = scoring.bm25Scores.some((s) => s > 0);
    scoringMode = determineScoringMode({
      usedEmbeddings: scoring.usedEmbeddings,
      bm25Scores: scoring.bm25Scores,
      source: scoring.source,
    });

    if (scoringMode === "hybrid") {
      const SEMANTIC_WEIGHT = hasBm25Signal ? 0.7 : 1;
      const BM25_WEIGHT = hasBm25Signal ? 0.3 : 0;
      marketScores = scoring.similarities.map((emb, i) => {
        const bm = scoring.bm25Scores[i] ?? 0;
        return emb * SEMANTIC_WEIGHT + bm * BM25_WEIGHT;
      });
      log(
        hasBm25Signal
          ? "🧠 Hybrid scoring —"
          : "🧠 Embedding scoring (BM25 unavailable) —",
        marketTexts.length,
        "markets scored"
      );
      if (isDebug) {
        const scored = marketTexts.map((title, i) => ({
          title: title.slice(0, 50),
          embedding: scoring.similarities[i].toFixed(4),
          bm25: (scoring.bm25Scores[i] ?? 0).toFixed(4),
          combined: marketScores[i].toFixed(4),
        }));
        scored.sort((a, b) => parseFloat(b.combined) - parseFloat(a.combined));
        log("🧠 Hybrid scores (sorted):", scored);
      }
    } else if (scoringMode === "lexical") {
      const heuristicScores = markets.map((m) =>
        calculateRelevanceScore([text], m)
      );
      const BM25_WEIGHT = 0.8;
      const HEURISTIC_WEIGHT = 0.2;
      marketScores = scoring.bm25Scores.map((bm25, i) => {
        return (
          bm25 * BM25_WEIGHT + (heuristicScores[i] ?? 0) * HEURISTIC_WEIGHT
        );
      });
      log(
        "📖 Lexical scoring — embeddings unavailable, using BM25 + heuristic:",
        marketTexts.length,
        "markets scored"
      );
    } else {
      scoringMode = "heuristic";
      log(
        "⚠️ Heuristic scoring — offscreen scoring unavailable:",
        scoring.source
      );
      marketScores = markets.map((m) => calculateRelevanceScore([text], m));
    }

    if (isDebug && scoringMode !== "heuristic" && marketScores.length > 0) {
      const candidateIndexes = marketScores
        .map((score, index) => ({ index, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, XENCODER_RERANK_TOP_K)
        .map((entry) => entry.index);
      if (candidateIndexes.length < 2) {
        xencoderStats.skippedSingleCandidate++;
        maybeLogXencoderStats(log);
      } else {
        const before = candidateIndexes.map((index) => ({
          index,
          score: Number((marketScores[index] ?? 0).toFixed(4)),
          title: markets[index]?.title?.slice(0, 80) ?? "",
        }));
        log(`${XENCODER_AB_PREFIX} request`, {
          post: text.slice(0, 120),
          candidateCount: candidateIndexes.length,
          before,
        });

        const rerank = await scoreMarketsBatch(
          text,
          candidateIndexes.map((index) => marketTexts[index] ?? ""),
          candidateIndexes.map((index) => gateTexts[index] ?? ""),
          {
            includeEmbeddings: false,
            includeBm25: false,
            includeContextGate: false,
            includeRerank: true,
          }
        );

        if (rerank.usedRerank) {
          candidateIndexes.forEach((marketIndex, rerankIndex) => {
            const score = rerank.rerankScores[rerankIndex];
            if (typeof score === "number") {
              rerankScoresByIndex.set(marketIndex, score);
            }
          });
          const after = candidateIndexes
            .map((index) => ({
              index,
              baseScore: Number((marketScores[index] ?? 0).toFixed(4)),
              rerankScore: Number(
                (rerankScoresByIndex.get(index) ?? 0).toFixed(4)
              ),
              title: markets[index]?.title?.slice(0, 80) ?? "",
            }))
            .sort((a, b) => b.rerankScore - a.rerankScore);
          const elapsedMs = rerank.rerankMetrics?.elapsedMs ?? 0;
          const queueWaitMs = rerank.rerankMetrics?.queueWaitMs ?? 0;
          recordXencoderResult(candidateIndexes.length, elapsedMs, queueWaitMs);
          log(`${XENCODER_AB_PREFIX} result`, {
            elapsedMs,
            queueWaitMs,
            model: rerank.rerankMetrics?.model,
            dtype: rerank.rerankMetrics?.dtype,
            device: rerank.rerankMetrics?.device,
            after,
          });
          maybeLogXencoderStats(log);
        } else {
          log(`${XENCODER_AB_PREFIX} unavailable`, {
            source: rerank.source,
            candidateCount: candidateIndexes.length,
          });
        }
      }
    }
  } catch (e) {
    scoringMode = "heuristic";
    log("⚠️ Heuristic scoring — scoring error:", e);
    marketScores = markets.map((m) => calculateRelevanceScore([text], m));
  }
  // -----------------------------------------

  const telemetryCandidates: RelevanceTelemetryCandidate[] = markets.map(
    (market, index) => ({
      id: market.id,
      title: market.title || "",
      source: market.source || "polymarket",
      hybridScore: marketScores[index] ?? 0,
      gatePassed: false,
      gateReason: "not-evaluated",
      xencoderScore: rerankScoresByIndex.get(index),
      shown: false,
    })
  );

  const telemetryByMarketId = new Map<string, RelevanceTelemetryCandidate>();
  for (const candidate of telemetryCandidates) {
    if (!telemetryByMarketId.has(candidate.id)) {
      telemetryByMarketId.set(candidate.id, candidate);
    }
  }

  const recordTelemetry = () => {
    recordRelevanceTelemetry({
      platform: currentPlatform?.name ?? "unknown",
      postKey,
      sourceTextPreview: text,
      searchQuery: result.keywords,
      matchedTags: result.matchedTags,
      scoringMode,
      candidates: telemetryCandidates,
    });
  };

  if (isDebug) {
    // Count markets by source for debugging
    const polymarketCount = markets.filter(
      (m) => (m.source || "polymarket") === "polymarket"
    ).length;
    const kalshiCount = markets.filter((m) => m.source === "kalshi").length;

    log("📊 Markets breakdown:", {
      total: markets.length,
      polymarket: polymarketCount,
      kalshi: kalshiCount,
    });

    // Debug: Log all Kalshi markets found
    if (kalshiCount > 0) {
      log("🟠 KALSHI markets found:");
      markets
        .filter((m) => m.source === "kalshi")
        .forEach((m, i) => {
          log(
            `  ${i + 1}. "${m.title}" (id: ${m.id}, volume: ${
              m.volume24hr || m.volume || 0
            })`
          );
        });
    } else {
      log("⚠️ No Kalshi markets returned from search");
    }
  }

  // Cosine similarity needs a higher bar than keyword/BM25 overlap to avoid
  // false positives from shared vocabulary. Only apply the floor in hybrid mode.
  const effectiveThreshold = getEffectiveThreshold(
    CONFIG.MIN_RELEVANCE_SCORE,
    scoringMode
  );

  // Track best market PER SOURCE for debug visibility, but retain multiple
  // post-level candidates so allocation can fall back if the top candidate
  // for this post is blocked elsewhere in the feed.
  const bestBySource: Record<string, BestBySourceEntry> = {};
  const candidateMarketsById = new Map<string, MarketSearchResult>();

  // Initialize tracking for each enabled source
  if (ENABLED_SOURCES?.polymarket) {
    bestBySource.polymarket = { market: null, score: 0, allScores: [] };
  }
  if (ENABLED_SOURCES?.kalshi) {
    bestBySource.kalshi = { market: null, score: 0, allScores: [] };
  }

  const gateBlockedHighScorers: Array<{
    index: number;
    score: number;
    gateText: string;
  }> = [];

  let metricsGateBlocked = 0;
  let metricsGateZeroSignal = 0;
  let metricsGateSingleSignal = 0;
  let metricsGateRecovered = 0;
  let metricsRetryEligible = 0;
  let metricsBelowThreshold = 0;

  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    const source = market.source || "polymarket";
    const telemetryCandidate = telemetryCandidates[i];

    if (!bestBySource[source]) {
      if (telemetryCandidate) {
        telemetryCandidate.gateReason = `disabled-source:${source}`;
      }
      log(`⏭️ Skipping market from disabled source: ${source}`);
      continue;
    }

    const isDirectPolymarketLink = directMarketIds.has(market.id);
    const score = isDirectPolymarketLink
      ? Math.max(marketScores[i] ?? 0, 0.99)
      : (marketScores[i] ?? 0);

    const gateDecision = isDirectPolymarketLink
      ? ({
          pass: true,
          gate: {
            pass: true,
            sharedNouns: 0,
            meaningfulNouns: 0,
            sharedEntities: 0,
            details: "direct-polymarket-link",
          },
          recoveryGate: undefined,
          retryEligible: false,
          usedFallbackGate: false,
          usedRecoveryGate: false,
        } as const)
      : evaluateCandidateGate({
          postText: text,
          market,
          matchedTags: result.matchedTags,
          scoringMode,
          score,
          gate: contextGateResults[i],
          relaxed: currentPlatform?.relaxContextGate === true,
        });
    const gate = gateDecision.gate;
    const signals = (gate.meaningfulNouns || 0) + (gate.sharedEntities || 0);
    const gateReason =
      signals === 0
        ? "gate-zero-signal"
        : signals === 1
          ? "gate-single-signal"
          : "gate-low-overlap";

    if (gateDecision.usedRecoveryGate && gateDecision.recoveryGate) {
      metricsGateRecovered++;
      log(
        `🔄 Single-signal recovery [${scoringMode}]: "${market.title?.slice(0, 50)}..." (score=${score.toFixed(3)}, ${gateDecision.recoveryGate.details})`
      );
    }

    if (!gateDecision.pass) {
      metricsGateBlocked++;
      if (signals === 0) metricsGateZeroSignal++;
      else if (signals === 1) metricsGateSingleSignal++;
      if (telemetryCandidate) {
        telemetryCandidate.gatePassed = false;
        telemetryCandidate.gateReason = `${gateReason}; ${gate.details}`;
      }

      log(
        `🛑 Context gate [${scoringMode}] dropped "${market.title?.slice(0, 50)}..." (score=${score.toFixed(3)}, reason=${gateReason}, ${gate.details})`
      );
      if (gateDecision.retryEligible) {
        gateBlockedHighScorers.push({
          index: i,
          score,
          gateText: buildMarketGateText(market),
        });
        metricsRetryEligible++;
      }
      continue;
    }
    if (telemetryCandidate) {
      telemetryCandidate.gatePassed = true;
      telemetryCandidate.gateReason = gate.details;
    }
    if (isDebug) {
      log(
        `✅ Context gate [${scoringMode}] passed "${market.title?.slice(0, 50)}..." (${gate.details})`
      );
    }

    if (score > bestBySource[source].score) {
      bestBySource[source] = {
        ...bestBySource[source],
        market,
        score,
      };
    }

    const meetsThreshold = score >= effectiveThreshold;

    if (isDebug) {
      bestBySource[source].allScores.push({
        title: market.title?.slice(0, 40),
        score: score.toFixed(2),
        meetsThreshold,
      });

      if (score >= 0.1) {
        log(
          `[${source}] "${market.title?.slice(0, 50)}..." score: ${score.toFixed(
            2
          )}`
        );
      }
    }

    if (!meetsThreshold) {
      metricsBelowThreshold++;
      if (telemetryCandidate) {
        telemetryCandidate.gateReason = `${telemetryCandidate.gateReason}; below-threshold:${score.toFixed(3)}<${effectiveThreshold.toFixed(3)}`;
      }
      log(
        `⏭️ ${source} market below threshold (${score.toFixed(2)} < ${effectiveThreshold} [${scoringMode}]): "${market.title?.slice(0, 50)}"`
      );
      continue;
    }

    if (scoringMode !== "heuristic" && !market._contextReason) {
      const pct = Math.round(score * 100);
      const topicHint =
        result.matchedTags.length > 0
          ? result.matchedTags.slice(0, 2).join(", ")
          : result.keywords.split(" ").slice(0, 3).join(" ").trim();
      market._contextReason = topicHint
        ? `${pct}% match · ${topicHint}`
        : `${pct}% match`;
    }

    if (isDirectPolymarketLink) {
      market._contextReason = "Direct Polymarket link";
    }

    const existingCandidate = candidateMarketsById.get(market.id);
    if (!existingCandidate || score > existingCandidate.score) {
      const rerankScore = rerankScoresByIndex.get(i);
      candidateMarketsById.set(market.id, {
        market,
        score,
        rerankScore,
        source: source as "polymarket" | "kalshi",
      });
    }
  }

  // AI-assisted retry: if no market passed the gate but high-scoring markets
  // were blocked, use AI extraction to enrich the post text with better
  // entities/keywords and re-evaluate the gate for those candidates.
  let candidateMarkets = selectTopCandidatesForPost(
    Array.from(candidateMarketsById.values())
  );
  const hasPassedMarket = candidateMarkets.length > 0;

  if (
    !hasPassedMarket &&
    gateBlockedHighScorers.length > 0 &&
    scoringMode === "hybrid" &&
    CONFIG.USE_AI_EXTRACTION &&
    window.KNOWW_API?.extractKeywordsWithAI
  ) {
    log(
      `🤖 [AI Retry] ${gateBlockedHighScorers.length} high-scoring market(s) blocked by gate, attempting AI extraction...`
    );

    try {
      const aiResult = await window.KNOWW_API.extractKeywordsWithAI(text);

      if (aiResult?.keywords) {
        const enrichedText = [
          text,
          aiResult.keywords,
          ...aiResult.entities,
          ...aiResult.topics,
        ].join(" ");

        log(
          `🤖 [AI Retry] Enriched text with AI: +${aiResult.entities.length} entities, +${aiResult.topics.length} topics`
        );

        const blockedGateTexts = gateBlockedHighScorers.map((b) => b.gateText);
        const retryScoring = await scoreMarketsBatch(
          enrichedText,
          blockedGateTexts,
          blockedGateTexts,
          {
            includeEmbeddings: false,
            includeBm25: false,
            includeContextGate: true,
          }
        );

        for (let j = 0; j < gateBlockedHighScorers.length; j++) {
          const { index, score: originalScore } = gateBlockedHighScorers[j];
          const gate =
            retryScoring.contextGateResults[j] ??
            naiveContextGate(enrichedText, blockedGateTexts[j]);
          const market = markets[index];
          const source = market.source || "polymarket";

          if (!gate.pass) {
            const telemetryCandidate = telemetryCandidates[index];
            if (telemetryCandidate) {
              telemetryCandidate.gateReason = `ai-retry-blocked; ${gate.details}`;
            }
            log(
              `🤖 [AI Retry] Still blocked: "${market.title?.slice(0, 50)}..." (${gate.details})`
            );
            continue;
          }
          const telemetryCandidate = telemetryCandidates[index];
          if (telemetryCandidate) {
            telemetryCandidate.gatePassed = true;
            telemetryCandidate.gateReason = `ai-retry-passed; ${gate.details}`;
          }

          log(
            `🤖 [AI Retry] ✅ Gate passed with AI: "${market.title?.slice(0, 50)}..." (originalScore=${originalScore.toFixed(3)}, ${gate.details})`
          );

          if (
            bestBySource[source] &&
            originalScore > bestBySource[source].score
          ) {
            bestBySource[source] = {
              ...bestBySource[source],
              market,
              score: originalScore,
            };
          }

          const existingCandidate = candidateMarketsById.get(market.id);
          if (!existingCandidate || originalScore > existingCandidate.score) {
            const rerankScore = rerankScoresByIndex.get(index);
            candidateMarketsById.set(market.id, {
              market,
              score: originalScore,
              rerankScore,
              source,
            });
          }
        }

        candidateMarkets = selectTopCandidatesForPost(
          Array.from(candidateMarketsById.values())
        );
      } else {
        log("🤖 [AI Retry] AI extraction returned no usable result");
      }
    } catch (e) {
      log("🤖 [AI Retry] Failed:", e);
    }
  } else if (
    !hasPassedMarket &&
    gateBlockedHighScorers.length > 0 &&
    scoringMode === "hybrid" &&
    !CONFIG.USE_AI_EXTRACTION
  ) {
    log(
      `🤖 [AI Retry] Skipped — AI-assisted matching is disabled in settings (${gateBlockedHighScorers.length} high-scoring market(s) blocked by gate)`
    );
  }

  if (isDebug) {
    // Debug: Log scoring summary per source
    log("📈 Scoring summary:");
    for (const [source, data] of Object.entries(bestBySource)) {
      const aboveThreshold = data.allScores.filter(
        (s) => s.meetsThreshold
      ).length;
      log(
        `  ${source}: ${data.allScores.length} scored, ${aboveThreshold} above threshold (${effectiveThreshold} [${scoringMode}])`
      );
      if (data.market) {
        log(
          `    ✓ Best: "${data.market.title?.slice(
            0,
            40
          )}..." (${data.score.toFixed(2)})`
        );
      } else {
        log(`    ✗ No markets found`);
      }
    }
  }

  log(
    `📊 Post metrics: mode=${scoringMode} searched=${markets.length} gate-blocked=${metricsGateBlocked} (zero-signal=${metricsGateZeroSignal} single-signal=${metricsGateSingleSignal}) recovered=${metricsGateRecovered} retry-eligible=${metricsRetryEligible}`
  );

  log(
    `📊 Post result: below-threshold=${metricsBelowThreshold} final-candidates=${candidateMarkets.length}`
  );

  if (candidateMarkets.length === 0) {
    log(
      `❌ No market from any source met relevance threshold (${effectiveThreshold} [${scoringMode}]) for this post`
    );
    recordTelemetry();
    return null;
  }

  // AI relevance validation — validate all candidates in parallel to avoid
  // sequential latency (each call can take up to 6s on timeout).
  const { validateMarketRelevance } = window.KNOWW_API;

  const validationResults = await Promise.allSettled(
    candidateMarkets.map(async (entry) => {
      const validation = await validateMarketRelevance(text, entry.market);
      return { entry, validation };
    })
  );

  const relevantMarkets: MarketSearchResult[] = [];
  for (let i = 0; i < validationResults.length; i++) {
    const candidate = candidateMarkets[i];
    const result = validationResults[i];
    const telemetryCandidate = telemetryByMarketId.get(candidate.market.id);
    if (result.status === "rejected") {
      if (telemetryCandidate) {
        telemetryCandidate.validator = "error";
      }
      if (!shouldFailOpen(candidate.score, FAIL_OPEN_FLOOR)) {
        log(
          `✗ reason=validator-error-low-score [${scoringMode}] (${candidate.score.toFixed(2)} < ${FAIL_OPEN_FLOOR}): "${candidate.market.title?.slice(0, 50)}"`
        );
        continue;
      }
      log(
        `⚠️ reason=validator-error-fail-open [${scoringMode}] (${candidate.score.toFixed(2)}): "${candidate.market.title?.slice(0, 50)}"`
      );
      relevantMarkets.push(candidate);
      continue;
    }
    const { entry, validation } = result.value;
    const entryTelemetryCandidate = telemetryByMarketId.get(entry.market.id);
    if (validation) {
      if (!validation.relevant) {
        if (entryTelemetryCandidate) {
          entryTelemetryCandidate.validator = "rejected";
        }
        log(
          `✗ reason=validator-rejected: "${entry.market.title?.slice(0, 50)}"`
        );
        continue;
      }
      if (entryTelemetryCandidate) {
        entryTelemetryCandidate.validator = "passed";
      }
      if (validation.reason) {
        entry.market._contextReason = validation.reason;
      }
    } else if (!shouldFailOpen(entry.score, FAIL_OPEN_FLOOR)) {
      if (entryTelemetryCandidate) {
        entryTelemetryCandidate.validator = "unavailable";
      }
      log(
        `✗ reason=validator-unavailable-low-score [${scoringMode}] (${entry.score.toFixed(2)} < ${FAIL_OPEN_FLOOR}): "${entry.market.title?.slice(0, 50)}"`
      );
      continue;
    }
    if (!validation && entryTelemetryCandidate) {
      entryTelemetryCandidate.validator = "unavailable";
    }
    relevantMarkets.push(entry);
  }

  if (relevantMarkets.length === 0) {
    log("❌ All candidate markets rejected by AI validation");
    recordTelemetry();
    return null;
  }

  // Sort by rerank score when both candidates were in the debug top-K rerank
  // set; otherwise keep the existing score semantics.
  relevantMarkets.sort((a, b) => {
    if (
      typeof a.rerankScore === "number" &&
      typeof b.rerankScore === "number"
    ) {
      return b.rerankScore - a.rerankScore;
    }
    return b.score - a.score;
  });
  if (isDebug && relevantMarkets.some((entry) => entry.rerankScore != null)) {
    log(
      `${XENCODER_AB_PREFIX} final-order`,
      relevantMarkets.map((entry) => ({
        title: entry.market.title?.slice(0, 80),
        baseScore: Number(entry.score.toFixed(4)),
        rerankScore:
          typeof entry.rerankScore === "number"
            ? Number(entry.rerankScore.toFixed(4))
            : null,
      }))
    );
  }
  const topRelevantMarkets = selectTopCandidatesForPost(relevantMarkets);
  topRelevantMarkets.forEach((entry, index) => {
    const telemetryCandidate = telemetryByMarketId.get(entry.market.id);
    if (telemetryCandidate) {
      telemetryCandidate.finalRank = index + 1;
      telemetryCandidate.shown = true;
    }
  });
  recordTelemetry();

  if (isDebug) {
    log(`✓ Found ${topRelevantMarkets.length} candidate markets for this post`);
  }

  return {
    markets: topRelevantMarkets,
    topics:
      result.matchedTags.length > 0
        ? result.matchedTags
        : [result.keywords.split(" ")[0]],
    postText: text,
  };
}

/**
 * Find the best injection point for market cards
 * Delegates to platform adapter for platform-specific logic
 */
function findInjectionPoint(article: Element): InjectionPoint | null {
  // Use platform adapter if available
  if (
    window.KNOWW_PLATFORM &&
    typeof window.KNOWW_PLATFORM.findInjectionPoint === "function"
  ) {
    return window.KNOWW_PLATFORM.findInjectionPoint(article);
  }

  // Fallback: Twitter-specific logic (backwards compatibility)
  const cellInnerDiv = article.closest('div[data-testid="cellInnerDiv"]');
  if (cellInnerDiv) {
    const contentWrapper = cellInnerDiv.firstElementChild;
    if (contentWrapper) {
      return {
        container: contentWrapper,
        cellInnerDiv: cellInnerDiv,
        insertPosition: "append",
      };
    }
  }

  // Fallback: LinkedIn-specific logic
  const feedUpdate =
    article.closest(".feed-shared-update-v2") ||
    article.closest(".occludable-update");
  if (feedUpdate) {
    const socialActionsBar =
      feedUpdate.querySelector(".feed-shared-social-actions") ||
      feedUpdate.querySelector(".social-details-social-actions");
    if (socialActionsBar?.parentElement) {
      return {
        container: socialActionsBar.parentElement,
        referenceElement: socialActionsBar,
        insertPosition: "before",
        postWrapper: feedUpdate,
      };
    }
    // Fallback: append to the feed update
    return {
      container: feedUpdate,
      insertPosition: "append",
      postWrapper: feedUpdate,
    };
  }

  // Fallback: Reddit-specific logic
  if (article.tagName?.toLowerCase() === "shreddit-post") {
    const parent = article.parentElement;
    if (parent) {
      const nextSibling = article.nextElementSibling;
      if (nextSibling) {
        return {
          container: parent,
          referenceElement: nextSibling,
          insertPosition: "before",
          postWrapper: article,
        };
      }
      return {
        container: parent,
        insertPosition: "append",
        postWrapper: article,
      };
    }
  }

  // Generic fallback for div-based Reddit posts
  const redditPost =
    article.closest("[data-testid='post-container']") ||
    article.closest(".Post");
  if (redditPost) {
    return {
      container: redditPost,
      insertPosition: "append",
      postWrapper: redditPost,
    };
  }

  return null;
}

/**
 * Inject market cards into a post
 * Supports injecting multiple cards from different sources (stacked vertically)
 * Works across different platforms (Twitter, LinkedIn, etc.)
 * @param targetPost - The post element to inject into
 * @param marketsData - Array of { market, score, source } objects
 * @param topics - Relevant topics/tags
 * @returns True if at least one card was injected
 */
function injectMarketCards(
  targetPost: Element,
  marketsData: MarketSearchResult[],
  topics: string[],
  options: { postKey?: string } = {}
): boolean {
  const { log } = window.KNOWW_UTILS;
  const { createInlineMarketCard } = window.KNOWW_UI;
  const postKey = options.postKey ?? getPostIdentityKey(targetPost);

  if (!postKey) {
    log("Could not resolve post identity for injection");
    return false;
  }

  const injectionPoint = findInjectionPoint(targetPost);

  if (!injectionPoint) {
    log("Could not find injection point");
    return false;
  }

  const {
    container,
    cellInnerDiv,
    postWrapper,
    cleanup,
    referenceElement,
    insertPosition,
  } = injectionPoint;

  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();

  // Check if card already exists in the post wrapper
  const wrapperToCheck = cellInnerDiv || postWrapper || container;
  const platformAlreadyInjected =
    platform && typeof platform.hasInjectedCard === "function"
      ? platform.hasInjectedCard(targetPost)
      : false;

  if (
    platformAlreadyInjected ||
    wrapperToCheck?.querySelector(".knoww-market-card")
  ) {
    log("Post already has a Knoww card");
    cleanup?.();
    return false;
  }

  if (injectedIntoPosts.has(targetPost)) {
    log("Post was previously injected; card missing, attempting reinjection");
  }

  // Policy A: inject at most one card per post, but keep a fallback candidate
  // available if the top candidate for this post is blocked elsewhere.
  const newMarkets = marketsData
    .filter(({ market }) => isMarketInjectableForPost(postKey, market.id))
    .slice(0, 1);

  if (newMarkets.length === 0) {
    log("All markets already injected");
    cleanup?.();
    return false;
  }

  // Get platform-specific wrapper styles
  let wrapperStyles = `
    padding: 0 16px 12px 16px;
    margin-top: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  `;

  // Use platform adapter for wrapper styles if available
  if (platform && typeof platform.getWrapperStyles === "function") {
    wrapperStyles = platform.getWrapperStyles();
  }

  // Detect platform for CSS class
  const platformName = window.KNOWW_PLATFORM?.getPlatformName?.() || "unknown";

  // Detect theme for CSS class (platforms like Reddit/Twitter need this)
  let themeClass = "";
  if (platform && typeof platform.detectTheme === "function") {
    const theme = platform.detectTheme();
    // Support dark, light, and dim (Twitter) themes
    themeClass = ` knoww-theme-${theme}`;
  }

  // Create wrapper for all cards (stacked vertically)
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-knoww-injected", "true");
  wrapper.setAttribute("data-knoww-platform", platformName);
  wrapper.setAttribute("data-knoww-post-key", postKey);
  wrapper.className = `knoww-stacked-cards knoww-platform-${platformName}${themeClass}`;
  wrapper.style.cssText = wrapperStyles;
  applyPlatformStyleVariables(wrapper, platform?.getCardStyles?.());

  const injectedCards: Array<{ market: Market; card: HTMLElement }> = [];

  // Create and append cards for each source
  for (const { market, score } of newMarkets) {
    const card = createInlineMarketCard(market, score, topics);
    card.setAttribute("data-knoww-market-id", market.id);
    card.setAttribute("data-knoww-post-key", postKey);
    wrapper.appendChild(card);
    injectedCards.push({ market, card });
  }

  try {
    // Insert based on the injection position
    if (insertPosition === "before" && referenceElement) {
      referenceElement.parentNode?.insertBefore(wrapper, referenceElement);
    } else if (insertPosition === "after" && referenceElement) {
      referenceElement.parentNode?.insertBefore(
        wrapper,
        referenceElement.nextSibling
      );
    } else {
      // Default: append to container
      container.appendChild(wrapper);
    }

    // PERFORMANCE: Removed forced reflow (wrapper.offsetHeight)
    // CSS animations/transitions will trigger reflow naturally when needed

    // Mark all post/market pairs as injected and update active market coverage
    for (const { market, card } of injectedCards) {
      injectedMarketIds.add(market.id);
      const trackingKey = getPostMarketPairKey(postKey, market.id);
      injectedPostMarketPairs.add(trackingKey);
      const injectedMarketData = newMarkets.find(
        (entry) => entry.market.id === market.id
      );
      liveInjectedCardRefs.set(trackingKey, {
        marketId: market.id,
        cardRef: new WeakRef(card),
      });

      let activePosts = activePostKeysByMarket.get(market.id);
      if (!activePosts) {
        activePosts = new Set<string>();
        activePostKeysByMarket.set(market.id, activePosts);
      }
      activePosts.add(postKey);

      if (injectedMarketData) {
        rememberReinjectionCandidate(
          postKey,
          market,
          injectedMarketData.score,
          topics
        );
      }

      // Track for notification stack using WeakRef to allow GC when DOM elements are removed
      upsertInjectedMarketEntry(postKey, market, card);

      ensureCardVisibilityObserver();
      cardVisibilityObserver?.observe(card);

      const source = market.source || "polymarket";
      void window.KNOWW_ANALYTICS?.track("market_card_impression", {
        marketId: market.id,
        source,
      });
      log(
        `✅ Injected ${source} market card on ${platformName}:`,
        market.title
      );
    }

    injectedIntoPosts.add(targetPost);

    // MEMORY: Immediately trim to keep only MAX_INJECTED_MARKETS most recent
    if (injectedMarkets.length > MAX_INJECTED_MARKETS) {
      injectedMarkets.splice(0, injectedMarkets.length - MAX_INJECTED_MARKETS);
    }

    // Notify UI to update notification stack
    if (window.KNOWW_UI?.updateNotificationStack) {
      window.KNOWW_UI.updateNotificationStack(injectedMarkets);
    }

    log(
      `✅ Successfully injected ${injectedCards.length} market cards (stacked) on ${platformName}`
    );
    return true;
  } catch (e) {
    cleanup?.();
    void window.KNOWW_ANALYTICS?.track("market_card_injection_failed", {
      cardsAttempted: injectedCards.length,
      error: e instanceof Error ? e.message : String(e),
    });
    log("Failed to inject cards:", e);
    return false;
  }
}

/**
 * Legacy single-card injection (for backwards compatibility)
 * @deprecated Use injectMarketCards instead
 */
function injectMarketCard(
  targetPost: Element,
  market: Market,
  score: number,
  topics: string[]
): boolean {
  return injectMarketCards(
    targetPost,
    [{ market, score, source: market.source || "polymarket" }],
    topics,
    { postKey: getPostIdentityKey(targetPost) ?? undefined }
  );
}

async function analyzeBatchSelections(
  posts: Array<{ post: Element; key: string | null }>
): Promise<BatchCandidateSelection[]> {
  const { log } = window.KNOWW_UTILS;
  const selections = new Array<BatchCandidateSelection | null>(
    posts.length
  ).fill(null);
  let nextIndex = 0;

  const workerCount = Math.min(ANALYZE_BATCH_CONCURRENCY, posts.length);
  if (workerCount === 0) return [];

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= posts.length) return;

      const { post, key } = posts[currentIndex];
      if (injectedIntoPosts.has(post)) continue;

      const postKey = key ?? getPostIdentityKey(post);
      if (!postKey) continue;

      try {
        const result = await analyzePostAndFindMarket(post);
        if (!result?.markets || result.markets.length === 0) continue;

        selections[currentIndex] = {
          post,
          postKey,
          topics: result.topics,
          markets: result.markets,
        };
      } catch (error) {
        log("⚠️ [PostAnalyzer] analyzePostAndFindMarket failed:", error);
      }
    }
  });

  await Promise.all(workers);

  return selections.filter(
    (selection): selection is BatchCandidateSelection => selection !== null
  );
}

/**
 * Process visible posts - analyze each post individually for relevance
 */
async function processVisiblePosts(options: {
  itemSelector: string;
}): Promise<void> {
  const { log } = window.KNOWW_UTILS;
  const { CONFIG } = window.KNOWW_CONFIG;
  const isDebug =
    window.KNOWW_CONFIG?.isDebugMode?.() ??
    window.KNOWW_CONFIG?.DEV_MODE ??
    false;
  const { itemSelector } = options;

  if (!hasValidExtensionContextForProcessing("PostScanner")) {
    return;
  }

  // Debug: Log that we're scanning for posts
  if (isDebug) {
    log(`\n🔄 [PostScanner] ========== SCAN START ==========`);
    log(`🔄 [PostScanner] Using selector: "${itemSelector}"`);
  }

  if (isAnalyzing) {
    if (isDebug) {
      log(`⏸️ [PostScanner] Already analyzing, skipping this scan`);
      log(`🔄 [PostScanner] ========== SCAN END ==========\n`);
    }
    return;
  }

  const posts = Array.from(document.querySelectorAll(itemSelector));
  if (isDebug) {
    log(`🔄 [PostScanner] Found ${posts.length} total posts in DOM`);
  }

  // Filter out nested posts and already processed logical IDs
  // Using O(n) approach with closest() instead of O(n²) nested loop
  const newPosts: Array<{ post: Element; key: string | null }> = [];
  let nestedCount = 0;
  let alreadyProcessedCount = 0;
  let duplicateLogicalPostCount = 0;
  let restoredTrackedCards = 0;
  const shouldAttemptRestore = reinjectionTrackingKeysByPostKey.size > 0;
  const seenPostKeys = new Set<string>();

  if (shouldAttemptRestore) {
    syncInjectedCardTrackingFromDom();
  }

  for (const post of posts) {
    // Skip nested posts using closest() - O(n) total instead of O(n²)
    // Check if this post has a parent that also matches the item selector
    const parentPost = post.parentElement?.closest(itemSelector);
    if (parentPost && parentPost !== post) {
      nestedCount++;
      continue;
    }

    const key = getPostIdentityKey(post);
    if (key && seenPostKeys.has(key)) {
      duplicateLogicalPostCount++;
      continue;
    }

    if (shouldAttemptRestore && key && restoreTrackedMarketsOnPost(post, key)) {
      seenPostKeys.add(key);
      restoredTrackedCards++;
      continue;
    }

    if (key && processedPostKeys.has(key)) {
      seenPostKeys.add(key);
      alreadyProcessedCount++;
      continue;
    }

    if (key) {
      seenPostKeys.add(key);
    }

    newPosts.push({ post, key });
  }

  if (isDebug) {
    log(`🔄 [PostScanner] Filtering results:`);
    log(`   • Total posts found: ${posts.length}`);
    log(`   • Nested (skipped): ${nestedCount}`);
    log(`   • Already processed: ${alreadyProcessedCount}`);
    log(`   • Duplicate logical posts: ${duplicateLogicalPostCount}`);
    log(`   • Restored tracked cards: ${restoredTrackedCards}`);
    log(`   • New posts to process: ${newPosts.length}`);
  }

  if (newPosts.length === 0 && cooldownPendingPosts.length === 0) {
    if (isDebug) {
      log(`🔄 [PostScanner] No new posts to process`);
      log(`🔄 [PostScanner] ========== SCAN END ==========\n`);
    }
    return;
  }

  const newlyDeferredPosts = enqueueCooldownPendingPosts(newPosts);
  postsSinceLastInjection += newlyDeferredPosts;

  if (isDebug) {
    log(`📊 [PostScanner] Stats update:`);
    log(`   • Total posts processed (all time): ${totalPostsProcessed}`);
    log(`   • Posts since last injection: ${postsSinceLastInjection}`);
    log(`   • Cooldown threshold: ${CONFIG.COOLDOWN_POSTS}`);
    log(`   • Cooldown pending posts: ${cooldownPendingPosts.length}`);
    log(
      `   • Will analyze for markets: ${
        postsSinceLastInjection >= CONFIG.COOLDOWN_POSTS
          ? "YES ✅"
          : "NO (waiting for cooldown)"
      }`
    );
  }

  // Respect user's Injection Frequency setting (COOLDOWN_POSTS)
  if (postsSinceLastInjection < CONFIG.COOLDOWN_POSTS) {
    if (isDebug) {
      log(`🔄 [PostScanner] ========== SCAN END ==========\n`);
    }
    return;
  }

  const postsReadyForAnalysis = dequeueCooldownPendingPosts(itemSelector);
  if (postsReadyForAnalysis.length === 0) {
    if (isDebug) {
      log(`🔄 [PostScanner] No pending posts remained eligible for analysis`);
      log(`🔄 [PostScanner] ========== SCAN END ==========\n`);
    }
    return;
  }

  // Mark posts as analyzed only once they are actually entering analysis.
  for (const { post, key } of postsReadyForAnalysis) {
    if (key) {
      processedPostKeys.add(key);
    }
    analyzedPosts.add(post);
  }
  totalPostsProcessed += postsReadyForAnalysis.length;

  isAnalyzing = true;
  if (isDebug) {
    log(`\n🔍 [PostAnalyzer] ========== ANALYSIS START ==========`);
    log(
      `🔍 [PostAnalyzer] Analyzing ${postsReadyForAnalysis.length} posts for market relevance...`
    );
  }

  try {
    const batchSelections = await analyzeBatchSelections(postsReadyForAnalysis);
    const plannedInjections = allocateBatchInjections(batchSelections);

    if (isDebug) {
      log(
        `🧭 [PostAnalyzer] Planned ${plannedInjections.length} injection(s) from ${batchSelections.length} post candidate set(s)`
      );
    }

    let injectionsThisBatch = 0;
    for (const plan of plannedInjections) {
      const injected = injectMarketCards(
        plan.post,
        [plan.market],
        plan.topics,
        { postKey: plan.postKey }
      );

      if (!injected) {
        if (isDebug) {
          log(`⚠️ [PostAnalyzer] Injection failed, trying next planned post...`);
        }
        continue;
      }

      injectionsThisBatch++;
      postsSinceLastInjection = 0;

      if (isDebug) {
        log(
          `🎉 [PostAnalyzer] Injected "${plan.market.market.title?.slice(
            0,
            50
          )}..." (${injectionsThisBatch}/${resolveMaxInjectionsPerBatch()} this batch)`
        );
      }
    }

    if (isDebug) {
      log(`🔍 [PostAnalyzer] ========== ANALYSIS END ==========\n`);
    }
  } catch (e) {
    if (isDebug) {
      log(`💥 [PostAnalyzer] Error during analysis:`, e);
      log(`🔍 [PostAnalyzer] ========== ANALYSIS END (ERROR) ==========\n`);
    }
  } finally {
    isAnalyzing = false;
  }

  if (isDebug) {
    log(`🔄 [PostScanner] ========== SCAN END ==========\n`);
  }
}

/**
 * Queue of newly added post elements (collected from MutationObserver)
 * PERFORMANCE: Process only new posts instead of full DOM scan
 */
const pendingPostsQueue: Element[] = [];
const MAX_PENDING_QUEUE_SIZE = 30; // Reduced from 50 for better memory

/**
 * Unified memory cleanup — single entry point for all cache maintenance.
 * Rebuilds live injection tracking from DOM so per-market active-post limits
 * stay accurate as cards mount and unmount.
 * LRU Set handles processedPostKeys eviction automatically.
 * @param force - bypass the time-based throttle
 */
function runMemoryCleanup(force = false): void {
  const { log } = window.KNOWW_UTILS || { log: () => {} };
  const now = Date.now();

  // Skip if cleanup was run recently (unless forced)
  if (!force && now - lastMemoryCleanup < MEMORY_CLEANUP_INTERVAL) {
    return;
  }

  lastMemoryCleanup = now;
  log(`🧹 [MemoryCleanup] Running cleanup...`);

  syncInjectedCardTrackingFromDom();

  // 1. processedPostKeys: LRU Set self-manages, no pruning needed

  // 2. Keep only MAX_INJECTED_MARKETS most recent (for notification stack)
  //    We intentionally keep entries even when cards scroll out of the DOM so
  //    users can still click the notification and open that market directly.
  //    NOTE: Do NOT remove their IDs from injectedMarketIds here.
  //    These cards may still be visible in the DOM — removing IDs would allow
  //    re-injection of the same market into a different post.
  if (injectedMarkets.length > MAX_INJECTED_MARKETS) {
    const removed = injectedMarkets.splice(
      0,
      injectedMarkets.length - MAX_INJECTED_MARKETS
    );
    for (const removedEntry of removed) {
      const removedCard = removedEntry.cardRef?.deref?.();
      if (removedCard) {
        cardVisibilityObserver?.unobserve(removedCard);
      }
      forgetReinjectionCandidate(removedEntry.postKey, removedEntry.market.id);
    }
    log(
      `🧹 [MemoryCleanup] Trimmed injectedMarkets to ${injectedMarkets.length} (removed ${removed.length})`
    );
  }

  // 3. Clear cooldown-deferred posts if they have disconnected elements
  let deferredCleaned = 0;
  for (let i = cooldownPendingPosts.length - 1; i >= 0; i--) {
    if (!cooldownPendingPosts[i].post.isConnected) {
      cooldownPendingPosts.splice(i, 1);
      deferredCleaned++;
    }
  }
  if (deferredCleaned > 0) {
    log(
      `🧹 [MemoryCleanup] Removed ${deferredCleaned} disconnected deferred posts`
    );
  }

  // 4. Clear pending queue if it has disconnected elements
  let queueCleaned = 0;
  for (let i = pendingPostsQueue.length - 1; i >= 0; i--) {
    if (!pendingPostsQueue[i].isConnected) {
      pendingPostsQueue.splice(i, 1);
      queueCleaned++;
    }
  }
  if (queueCleaned > 0) {
    log(
      `🧹 [MemoryCleanup] Removed ${queueCleaned} disconnected posts from queue`
    );
  }

  // Keep notification stack state in sync with active vs scrolled-out cards.
  if (window.KNOWW_UI?.updateNotificationStack) {
    window.KNOWW_UI.updateNotificationStack(injectedMarkets);
  }

  log(
    `🧹 [MemoryCleanup] Cleanup complete. Stats: processedKeys=${processedPostKeys.size}, injectedMarkets=${injectedMarkets.length}, marketIds=${injectedMarketIds.size}, queue=${pendingPostsQueue.length}`
  );
}

/**
 * Check if feed is ready (container exists and has minimum posts)
 * PERFORMANCE: Prevents premature scanning while feed is still loading
 */
function isFeedReady(
  containerSelector: string,
  itemSelector: string,
  minPosts = 3
): boolean {
  const container = document.querySelector(containerSelector);
  if (!container) return false;

  const posts = container.querySelectorAll(itemSelector);
  return posts.length >= minPosts;
}

/**
 * Wait for feed to be ready before starting scans
 * Returns a promise that resolves when feed has minimum posts
 */
function waitForFeedReady(
  containerSelector: string,
  itemSelector: string,
  maxWaitMs = 10000,
  checkIntervalMs = 500,
  minPosts = 3
): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const check = (): void => {
      if (isFeedReady(containerSelector, itemSelector, minPosts)) {
        resolve(true);
        return;
      }

      if (Date.now() - startTime >= maxWaitMs) {
        // Timeout - start anyway with whatever is available
        resolve(false);
        return;
      }

      setTimeout(check, checkIntervalMs);
    };

    check();
  });
}

/**
 * Process posts from the pending queue (collected from mutations)
 * PERFORMANCE: Only processes truly new posts, not full DOM scan
 */
async function processQueuedPosts(options: {
  itemSelector: string;
}): Promise<void> {
  const { log } = window.KNOWW_UTILS;
  const { CONFIG } = window.KNOWW_CONFIG;
  const { itemSelector } = options;

  if (!hasValidExtensionContextForProcessing("QueueProcessor")) {
    return;
  }

  if (document.hidden || isAnalyzing || pendingPostsQueue.length === 0) {
    return;
  }

  log(
    `\n🔄 [QueueProcessor] Processing ${pendingPostsQueue.length} queued posts`
  );

  // Drain the queue
  const postsToProcess = pendingPostsQueue.splice(0, pendingPostsQueue.length);

  // Filter and deduplicate
  const newPosts: Array<{ post: Element; key: string | null }> = [];
  const shouldAttemptRestore = reinjectionTrackingKeysByPostKey.size > 0;
  const seenPostKeys = new Set<string>();

  if (shouldAttemptRestore) {
    syncInjectedCardTrackingFromDom();
  }

  for (const post of postsToProcess) {
    // Skip if not connected to DOM anymore (virtualized away)
    if (!post.isConnected) continue;

    // Skip nested posts
    const parentPost = post.parentElement?.closest(itemSelector);
    if (parentPost && parentPost !== post) continue;

    const key = getPostIdentityKey(post);
    if (key && seenPostKeys.has(key)) continue;

    if (shouldAttemptRestore && key && restoreTrackedMarketsOnPost(post, key)) {
      seenPostKeys.add(key);
      continue;
    }

    if (key && processedPostKeys.has(key)) continue;

    if (key) {
      seenPostKeys.add(key);
    }

    // Skip if already in analyzedPosts WeakSet
    if (analyzedPosts.has(post)) continue;

    newPosts.push({ post, key });
  }

  if (newPosts.length === 0 && cooldownPendingPosts.length === 0) {
    log(`🔄 [QueueProcessor] No new posts after filtering`);
    return;
  }

  log(`🔄 [QueueProcessor] ${newPosts.length} new posts to process`);

  const newlyDeferredPosts = enqueueCooldownPendingPosts(newPosts);
  postsSinceLastInjection += newlyDeferredPosts;

  // Respect user's Injection Frequency setting (COOLDOWN_POSTS)
  if (postsSinceLastInjection < CONFIG.COOLDOWN_POSTS) {
    return;
  }

  const postsReadyForAnalysis = dequeueCooldownPendingPosts(itemSelector);
  if (postsReadyForAnalysis.length === 0) {
    return;
  }

  // Mark posts as analyzed only once they are actually entering analysis.
  for (const { post, key } of postsReadyForAnalysis) {
    if (key) {
      processedPostKeys.add(key);
    }
    analyzedPosts.add(post);
  }

  totalPostsProcessed += postsReadyForAnalysis.length;

  isAnalyzing = true;
  try {
    const batchSelections = await analyzeBatchSelections(postsReadyForAnalysis);
    const plannedInjections = allocateBatchInjections(batchSelections);

    let injectionsThisBatch = 0;
    for (const plan of plannedInjections) {
      const injected = injectMarketCards(
        plan.post,
        [plan.market],
        plan.topics,
        { postKey: plan.postKey }
      );
      if (!injected) continue;

      injectionsThisBatch++;
      postsSinceLastInjection = 0;
      log(
        `🎉 [QueueProcessor] Successfully injected card! (${injectionsThisBatch}/${resolveMaxInjectionsPerBatch()} this batch)`
      );
    }
  } finally {
    isAnalyzing = false;
  }
}

/**
 * Observe feed mutations and process new posts
 * PERFORMANCE OPTIMIZATIONS:
 * - Waits for feed to be ready before starting
 * - Collects posts directly from MutationObserver addedNodes
 * - Uses scheduleIdle for processing
 * - Avoids full DOM scans where possible
 */
function watchFeed(containerSelector: string, itemSelector: string): void {
  const { log } = window.KNOWW_UTILS;
  let container: Element | Document =
    document.querySelector(containerSelector) || document;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let observer: MutationObserver | null = null;
  let feedReady = false;
  let pollIntervalId: ReturnType<typeof setInterval> | null = null;
  let isPaused = false;
  let scrollListenerAttached = false;
  let lastMutationTime = 0;
  let initialScanDone = false;

  log(`\n👁️ [FeedWatcher] ========== INITIALIZING ==========`);
  log(`👁️ [FeedWatcher] Container selector: "${containerSelector}"`);
  log(`👁️ [FeedWatcher] Item selector: "${itemSelector}"`);
  log(
    `👁️ [FeedWatcher] Container found: ${
      document.querySelector(containerSelector)
        ? "YES ✅"
        : "NO (using document)"
    }`
  );

  /**
   * Collect post elements from mutation addedNodes
   * PERFORMANCE: Directly extracts posts without querySelectorAll
   */
  const collectPostsFromMutation = (mutations: MutationRecord[]): Element[] => {
    const collectedPosts: Element[] = [];

    for (const m of mutations) {
      if (!m?.addedNodes?.length) continue;

      for (const node of Array.from(m.addedNodes)) {
        if (node.nodeType !== 1) continue;

        const element = node as Element;
        const tagName = element.tagName?.toLowerCase();

        // Direct post element
        if (tagName === "shreddit-post" || element.matches?.(itemSelector)) {
          collectedPosts.push(element);
          continue;
        }

        // Contains post elements - extract them
        if (element.querySelectorAll) {
          const nestedPosts = element.querySelectorAll(itemSelector);
          for (const post of Array.from(nestedPosts)) {
            collectedPosts.push(post);
          }
        }
      }
    }

    return collectedPosts;
  };

  /**
   * Start or restart the MutationObserver on the current container.
   * LinkedIn/Reddit occasionally swap out large DOM chunks; this re-attaches if needed.
   */
  const startObserver = (): void => {
    if (isPaused || document.hidden) return;
    if (observer) {
      observer.disconnect();
      log(`👁️ [FeedWatcher] Disconnected previous observer`);
    }

    container = document.querySelector(containerSelector) || document;
    log(`👁️ [FeedWatcher] Starting MutationObserver on container`);

    observer = new MutationObserver((mutations) => {
      // PERFORMANCE: Skip processing if feed not ready yet
      if (!feedReady || isPaused || document.hidden) return;

      // PERFORMANCE: Collect posts directly from addedNodes
      const newPosts = collectPostsFromMutation(mutations);

      if (newPosts.length === 0) return;

      lastMutationTime = Date.now();
      log(`👁️ [FeedWatcher] Collected ${newPosts.length} posts from mutations`);

      // Add to queue (with cap to prevent memory issues)
      for (const post of newPosts) {
        if (pendingPostsQueue.length >= MAX_PENDING_QUEUE_SIZE) {
          // Remove oldest entries if queue is full
          pendingPostsQueue.shift();
        }
        pendingPostsQueue.push(post);
      }

      // Debounce processing
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        scheduleIdle(
          () => processQueuedPosts({ itemSelector }),
          QUEUED_POST_PROCESS_IDLE_TIMEOUT_MS
        );
      }, 300);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    log(`👁️ [FeedWatcher] ✅ MutationObserver started successfully`);
  };

  const runPeriodicScan = (): void => {
    // Skip if feed not ready
    if (!feedReady) return;
    // Drain pending queue first to avoid starvation after tab hide/show.
    if (pendingPostsQueue.length > 0) {
      scheduleIdle(
        () => processQueuedPosts({ itemSelector }),
        PERIODIC_QUEUE_DRAIN_IDLE_TIMEOUT_MS
      );
      return;
    }
    // Skip if we recently saw mutations
    if (Date.now() - lastMutationTime < 2000) return;

    // If container was removed (LinkedIn/Reddit often re-renders), reattach observer
    if (
      container &&
      container !== document &&
      !(container as Element).isConnected
    ) {
      log(`👁️ [FeedWatcher] Container disconnected, restarting observer...`);
      startObserver();
      return;
    }
    log(`⏰ [FeedWatcher] Periodic scan triggered`);
    // Use full scan for periodic (catches virtualized content)
    processVisiblePosts({ itemSelector });
  };

  const startPeriodicScan = (): void => {
    if (pollIntervalId) return;
    // Safety net: periodic scan catches any missed mutations or virtualized inserts
    // Using scheduleIdle for better CPU scheduling
    // Increased to 20s to reduce CPU/memory overhead (MutationObserver handles most cases)
    log(`👁️ [FeedWatcher] Setting up periodic scan (every 20s, idle-aware)`);
    pollIntervalId = setInterval(() => {
      // Skip periodic scan if tab is hidden to save resources
      if (document.hidden || isPaused) {
        log(`⏸️ [FeedWatcher] Tab hidden, skipping periodic scan`);
        return;
      }
      scheduleIdle(runPeriodicScan, PERIODIC_SCAN_IDLE_TIMEOUT_MS);
    }, 20000); // Increased from 15s to 20s for better performance
  };

  const stopPeriodicScan = (): void => {
    if (!pollIntervalId) return;
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  };

  // Scroll listener - only trigger if user has stopped scrolling
  // PERFORMANCE: Longer debounce (1000ms) to reduce CPU overhead during fast scrolling
  log(`👁️ [FeedWatcher] Setting up scroll listener`);
  let scrollDebounce: ReturnType<typeof setTimeout> | null = null;
  let lastScrollY = window.scrollY;

  // Track scroll count for memory cleanup triggering
  let scrollCount = 0;
  const CLEANUP_EVERY_N_SCROLLS = 10; // Run cleanup every 10 significant scrolls

  const handleScroll = (): void => {
    // Skip if feed not ready
    if (!feedReady || isPaused || document.hidden) return;

    if (scrollDebounce) clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(() => {
      // Only scan if scroll position actually changed significantly
      const scrollDelta = Math.abs(window.scrollY - lastScrollY);
      if (scrollDelta < 100) return; // Skip minor scrolls

      lastScrollY = window.scrollY;
      scrollCount++;

      log(
        `📜 [FeedWatcher] Scroll detected (delta: ${scrollDelta}px), triggering post scan`
      );

      // MEMORY: Trigger cleanup periodically during scrolling
      if (scrollCount % CLEANUP_EVERY_N_SCROLLS === 0) {
        runMemoryCleanup();
      }

      // Skip full scan if we already have queued posts to process
      if (pendingPostsQueue.length > 0 || isAnalyzing) return;

      scheduleIdle(
        () => processVisiblePosts({ itemSelector }),
        SCROLL_SCAN_IDLE_TIMEOUT_MS
      );
    }, 1000); // Increased from 750ms to 1000ms
  };

  const startScrollListener = (): void => {
    if (scrollListenerAttached) return;
    window.addEventListener("scroll", handleScroll, { passive: true });
    scrollListenerAttached = true;
  };

  const stopScrollListener = (): void => {
    if (!scrollListenerAttached) return;
    window.removeEventListener("scroll", handleScroll);
    scrollListenerAttached = false;
    if (scrollDebounce) {
      clearTimeout(scrollDebounce);
      scrollDebounce = null;
    }
  };

  const pauseWatchers = (): void => {
    if (isPaused) return;
    isPaused = true;
    observer?.disconnect();
    stopPeriodicScan();
    stopScrollListener();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    stopCleanupInterval();
    log(`⏸️ [FeedWatcher] Paused watchers (tab hidden)`);
  };

  const resumeWatchers = (): void => {
    if (!isPaused) return;
    isPaused = false;
    if (!feedReady) return;
    startObserver();
    startPeriodicScan();
    startScrollListener();
    startCleanupInterval();

    // Always attempt to drain queued posts on resume.
    if (pendingPostsQueue.length > 0) {
      scheduleIdle(
        () => processQueuedPosts({ itemSelector }),
        RESUME_QUEUE_DRAIN_IDLE_TIMEOUT_MS
      );
    }

    if (!initialScanDone) {
      // Run initial scan when we resume from a hidden state
      scheduleIdle(
        () => processVisiblePosts({ itemSelector }),
        RESUME_INITIAL_SCAN_IDLE_TIMEOUT_MS
      );
      initialScanDone = true;
    }
    log(`▶️ [FeedWatcher] Resumed watchers (tab visible)`);
  };

  const handleVisibilityChange = (): void => {
    if (document.hidden) {
      pauseWatchers();
    } else {
      resumeWatchers();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // PERFORMANCE: Wait for feed to be ready before starting scans
  log(`👁️ [FeedWatcher] Waiting for feed to be ready...`);
  waitForFeedReady(
    containerSelector,
    itemSelector,
    10000,
    FEED_READY_CHECK_INTERVAL_MS,
    FEED_READY_MIN_POSTS
  ).then((ready) => {
    feedReady = true;

    if (ready) {
      log(`✅ [FeedWatcher] Feed is ready! Starting scans...`);
    } else {
      log(`⚠️ [FeedWatcher] Feed ready timeout, starting scans anyway...`);
    }

    if (document.hidden) {
      pauseWatchers();
      return;
    }

    // Start the observer now that feed is ready
    startObserver();

    // Start periodic cleanup and scans
    startCleanupInterval();
    startPeriodicScan();
    startScrollListener();

    // Run initial scan
    log(`🚀 [FeedWatcher] Running initial post scan`);
    scheduleIdle(
      () => processVisiblePosts({ itemSelector }),
      INITIAL_SCAN_IDLE_TIMEOUT_MS
    );
    initialScanDone = true;
  });

  log(`👁️ [FeedWatcher] ========== INITIALIZATION COMPLETE ==========\n`);

  // Expose a lightweight disposer for debugging (not used in prod flow)
  window.KNOWW_INJECTION_WATCHER = {
    stop: () => {
      log(`👁️ [FeedWatcher] Stopping all watchers...`);
      observer?.disconnect();
      stopPeriodicScan();
      stopScrollListener();
      stopCleanupInterval();
      cardVisibilityObserver?.disconnect();
      cardVisibilityObserver = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      pendingPostsQueue.length = 0; // Clear queue
      log(`👁️ [FeedWatcher] All watchers stopped`);
    },
  };
}

/**
 * Clear processed post keys cache (for memory optimization)
 * Delegates to unified runMemoryCleanup. LRU Set handles eviction automatically.
 * @deprecated Prefer calling runMemoryCleanup(true) directly.
 */
function clearProcessedPostsCache(): void {
  // LRU Set self-manages; nothing to do manually.
  // Kept for backwards compatibility with main.ts visibility handler.
}

/**
 * Clear injected market IDs cache (for memory optimization)
 * Delegates to unified runMemoryCleanup.
 * @deprecated Prefer calling runMemoryCleanup(true) directly.
 */
function clearInjectedMarketIdsCache(): void {
  // Handled by runMemoryCleanup step 4
  runMemoryCleanup(true);
}

// Export injection functions
window.KNOWW_INJECTION = {
  analyzePostAndFindMarket,
  injectMarketCard, // Legacy single-card (backwards compatible)
  injectMarketCards, // New multi-source stacked cards
  processVisiblePosts,
  watchFeed,
  getInjectedMarketIds: () => injectedMarketIds,
  getInjectedMarkets: () => injectedMarkets, // Returns array with WeakRef cardRef properties
  pruneStaleMarkets, // Manually trigger cleanup of stale entries
  clearProcessedPostsCache, // Memory optimization: clear processed posts cache
  clearInjectedMarketIdsCache, // Memory optimization: clear market IDs cache
  runMemoryCleanup, // Aggressive memory cleanup (called during scroll)
  startCleanupInterval, // Lifecycle-managed cleanup interval
  stopCleanupInterval, // Lifecycle-managed cleanup interval
  markClicked: (marketId: string) => {
    clickedMarketIds.add(marketId);
  },
  restoreTrackedMarket,
  // Stats for debugging
  getMemoryStats: () => ({
    processedPostKeys: processedPostKeys.size,
    injectedMarketIds: injectedMarketIds.size,
    injectedMarkets: injectedMarkets.length,
    pendingQueue: pendingPostsQueue.length,
    totalPostsProcessed,
  }),
};
