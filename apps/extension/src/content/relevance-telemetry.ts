type RelevanceTelemetryScoringMode = "hybrid" | "lexical" | "heuristic";

export interface RelevanceTelemetryCandidate {
  id: string;
  title: string;
  source: "polymarket" | "kalshi" | string;
  hybridScore: number;
  gatePassed: boolean;
  gateReason?: string;
  xencoderScore?: number;
  finalRank?: number;
  shown: boolean;
  validator?: "passed" | "rejected" | "unavailable" | "error";
  feedback?: "good" | "bad";
  feedbackAt?: number;
}

export interface RelevanceTelemetryEvent {
  id: string;
  timestamp: number;
  pageUrl: string;
  postKey?: string;
  platform: string;
  sourceTextPreview: string;
  searchQuery: string;
  matchedTags: string[];
  scoringMode: RelevanceTelemetryScoringMode;
  candidates: RelevanceTelemetryCandidate[];
}

export interface RelevanceTelemetryFeedback {
  id: string;
  timestamp: number;
  pageUrl: string;
  platform: string;
  postKey?: string;
  marketId: string;
  marketTitle: string;
  source: string;
  feedback: "good" | "bad";
}

export interface RelevanceTelemetryExport {
  exportedAt: number;
  pageUrl: string;
  platform: string;
  events: RelevanceTelemetryEvent[];
  feedback: RelevanceTelemetryFeedback[];
}

const MAX_RELEVANCE_TELEMETRY_EVENTS = 500;
const SOURCE_TEXT_PREVIEW_LENGTH = 180;
const CANDIDATE_TITLE_LENGTH = 160;

let sequence = 0;
let feedbackSequence = 0;
const events: RelevanceTelemetryEvent[] = [];
const feedbackEvents: RelevanceTelemetryFeedback[] = [];

function isEnabled(): boolean {
  return (
    window.KNOWW_CONFIG?.isDebugMode?.() === true ||
    window.KNOWW_CONFIG?.DEV_MODE === true ||
    window.KNOWW_CONFIG?.getUserSettings?.().debugMode === true
  );
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length <= maxLength
    ? compacted
    : `${compacted.slice(0, maxLength - 1)}…`;
}

function normalizeEvent(
  event: Omit<RelevanceTelemetryEvent, "id" | "timestamp" | "pageUrl">
): RelevanceTelemetryEvent {
  return {
    ...event,
    id: `${Date.now()}-${++sequence}`,
    timestamp: Date.now(),
    pageUrl: window.location.href,
    sourceTextPreview: compactText(
      event.sourceTextPreview,
      SOURCE_TEXT_PREVIEW_LENGTH
    ),
    searchQuery: compactText(event.searchQuery, SOURCE_TEXT_PREVIEW_LENGTH),
    matchedTags: event.matchedTags.slice(0, 12),
    candidates: event.candidates.map((candidate) => ({
      ...candidate,
      title: compactText(candidate.title, CANDIDATE_TITLE_LENGTH),
      hybridScore: Number(candidate.hybridScore.toFixed(4)),
      xencoderScore:
        typeof candidate.xencoderScore === "number"
          ? Number(candidate.xencoderScore.toFixed(4))
          : undefined,
      gateReason: candidate.gateReason
        ? compactText(candidate.gateReason, 240)
        : undefined,
    })),
  };
}

export function recordRelevanceFeedback(input: {
  postKey?: string;
  marketId: string;
  marketTitle: string;
  source: string;
  feedback: "good" | "bad";
}): void {
  if (!isEnabled()) return;

  const timestamp = Date.now();
  const platform = window.KNOWW_PLATFORM?.getPlatformName?.() ?? "unknown";
  const event: RelevanceTelemetryFeedback = {
    ...input,
    id: `${timestamp}-feedback-${++feedbackSequence}`,
    timestamp,
    pageUrl: window.location.href,
    platform,
    marketTitle: compactText(input.marketTitle, CANDIDATE_TITLE_LENGTH),
  };

  feedbackEvents.push(event);
  if (feedbackEvents.length > MAX_RELEVANCE_TELEMETRY_EVENTS) {
    feedbackEvents.splice(
      0,
      feedbackEvents.length - MAX_RELEVANCE_TELEMETRY_EVENTS
    );
  }

  for (let i = events.length - 1; i >= 0; i--) {
    const relevanceEvent = events[i];
    if (input.postKey && relevanceEvent.postKey !== input.postKey) continue;
    const candidate = relevanceEvent.candidates.find(
      (entry) => entry.id === input.marketId
    );
    if (candidate) {
      candidate.feedback = input.feedback;
      candidate.feedbackAt = timestamp;
      break;
    }
  }
}

export function recordRelevanceTelemetry(
  event: Omit<RelevanceTelemetryEvent, "id" | "timestamp" | "pageUrl">
): void {
  if (!isEnabled()) return;

  events.push(normalizeEvent(event));
  if (events.length > MAX_RELEVANCE_TELEMETRY_EVENTS) {
    events.splice(0, events.length - MAX_RELEVANCE_TELEMETRY_EVENTS);
  }
}

export function getRelevanceTelemetry(): RelevanceTelemetryEvent[] {
  return events.map((event) => ({
    ...event,
    matchedTags: [...event.matchedTags],
    candidates: event.candidates.map((candidate) => ({ ...candidate })),
  }));
}

export function getRelevanceFeedback(): RelevanceTelemetryFeedback[] {
  return feedbackEvents.map((event) => ({ ...event }));
}

export function clearRelevanceTelemetry(): void {
  events.length = 0;
  feedbackEvents.length = 0;
}

export function exportRelevanceTelemetry(): RelevanceTelemetryExport {
  return {
    exportedAt: Date.now(),
    pageUrl: window.location.href,
    platform: window.KNOWW_PLATFORM?.getPlatformName?.() ?? "unknown",
    events: getRelevanceTelemetry(),
    feedback: getRelevanceFeedback(),
  };
}

function installMessageHandlers(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "KNOWW_EXPORT_RELEVANCE_TELEMETRY") {
      sendResponse({ ok: true, data: exportRelevanceTelemetry() });
      return;
    }

    if (message?.type === "KNOWW_CLEAR_RELEVANCE_TELEMETRY") {
      clearRelevanceTelemetry();
      sendResponse({ ok: true });
    }
  });
}

export const KNOWW_RELEVANCE_TELEMETRY = {
  record: recordRelevanceTelemetry,
  recordFeedback: recordRelevanceFeedback,
  get: getRelevanceTelemetry,
  getFeedback: getRelevanceFeedback,
  clear: clearRelevanceTelemetry,
  export: exportRelevanceTelemetry,
};

window.KNOWW_RELEVANCE_TELEMETRY = KNOWW_RELEVANCE_TELEMETRY;
installMessageHandlers();
