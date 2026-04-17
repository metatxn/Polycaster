import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import { normalizeText } from "./helpers";

// Content-script adapter for manifold.markets.
//
// Manifold's market grid is rendered as anchor elements with Tailwind utility
// classes — no semantic hooks, no headings anywhere on the homepage. Each
// market card is `<a href="/{user}/{slug}">` with a shared class combo:
//   flex w-full flex-col p-2 text-base outline-none transition-colors ...
// Inside the anchor, the question lives in a plain `<span>`; everything else
// (trade count, volume, percentage, "Bet") is rendered in sibling divs, so
// using `textContent` directly would mash the question with stat glyphs like
// "...April 30? [Polymarket]254Ṁ2k43%28Bet".

const MANIFOLD_HOST_RE = /^(?:www\.)?manifold\.markets$/i;

const MANIFOLD_CONTAINER_SELECTORS = ["main", "#__next", "body"] as const;

// This class combo is unique to market cards on the homepage/browse grids —
// verified to capture all 41 market anchors with zero false positives.
const MANIFOLD_CARD_SELECTOR =
  "a.flex.flex-col.text-base.outline-none[href^='/']";

const MANIFOLD_ITEM_SELECTORS = [MANIFOLD_CARD_SELECTOR] as const;

// The question title is always a plain `<span>` with no class, and always
// the first span in DOM order within the anchor. Stats (vote counts, Ṁ
// volume, percentages, "Bet", per-outcome rows) render in subsequent spans,
// so we filter those out. Taking the first match is more robust than
// "longest" because multi-outcome cards concatenate their outcome spans
// into a single long string that would otherwise win.
function extractManifoldTitle(postElement: Element): string {
  const spans = Array.from(postElement.querySelectorAll("span"));
  for (const span of spans) {
    const text = normalizeText(span.textContent);
    if (text.length < 10 || text.length > 300) continue;
    // Skip stat-only spans
    if (/^\d[\d,.]*\s*%?$/.test(text)) continue;
    if (/^Ṁ/.test(text)) continue;
    if (text === "Bet") continue;
    // Skip outcome rows like "91%GPT-5.5 (or 5.x variant)"
    if (/^\d+%/.test(text)) continue;
    return text;
  }
  return "";
}

function extractManifoldPostText(postElement: Element): string {
  const title = extractManifoldTitle(postElement);
  if (title) return title;

  // Fallback: the anchor's full text, which at worst looks like
  // "...question?254Ṁ2k43%28Bet" — the downstream analyzer still has enough
  // signal to extract keywords from the leading question words.
  return normalizeText(postElement.textContent);
}

const MANIFOLD_HREF_PATTERN = /^\/([^/?#]+)\/([^/?#]+)/;

function getManifoldPostId(postElement: Element): string | null {
  const anchor =
    postElement instanceof HTMLAnchorElement
      ? postElement
      : postElement.querySelector<HTMLAnchorElement>("a[href^='/']");
  const href = anchor?.getAttribute("href") || "";
  const match = href.match(MANIFOLD_HREF_PATTERN);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  return normalizeText(href) || null;
}

function findManifoldInjectionPoint(
  postElement: Element
): InjectionPoint | null {
  // Inject as a sibling AFTER the anchor so the card is outside the anchor's
  // click target — otherwise every card click would navigate to the market
  // page (same failure mode we fixed on Tom's Hardware).
  if (postElement.parentElement) {
    return {
      container: postElement.parentElement,
      referenceElement: postElement,
      insertPosition: "after",
      postWrapper: postElement,
    };
  }

  return null;
}

function hasManifoldInjectedCard(postElement: Element): boolean {
  const parent = postElement.parentElement;
  if (!parent) return false;

  // The card is a sibling of the anchor, not a descendant.
  for (const sibling of Array.from(parent.children)) {
    if (sibling === postElement) continue;
    if (sibling.classList.contains("knoww-market-card")) return true;
    if (sibling.querySelector?.(".knoww-market-card")) return true;
  }

  return false;
}

function getManifoldWrapperStyles(): string {
  return `
    padding: 8px 0 4px 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  `;
}

const ManifoldMarketsAdapter = createBasicAdapter({
  name: "manifold-markets",
  hostPatterns: [MANIFOLD_HOST_RE],
  // Every Manifold card is an English market question; the short-title
  // heuristic otherwise drops posts like "Starmer out before July?".
  bypassEnglishCheck: true,
  // Market-question vs market-question comparisons rarely share 2+
  // meaningful nouns, so accept a single high-score signal — same reasoning
  // as kalshi-website.
  relaxContextGate: true,
  // Manifold surfaces 40+ markets per page and relaxContextGate unlocks many
  // candidates; align the per-batch and panel caps with Kalshi.
  maxInjectionsPerBatch: 20,
  maxActiveNotificationItems: 20,
  maxNotificationItems: 40,
  itemSelectors: [...MANIFOLD_ITEM_SELECTORS],
  containerSelectors: [...MANIFOLD_CONTAINER_SELECTORS],
  textSelectors: ["span", "p"],
  accentColor: "#4337c9",
  fontFamily:
    '"Readex Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "12px",
  extractPostText: extractManifoldPostText,
  getPostId: getManifoldPostId,
  findInjectionPoint: findManifoldInjectionPoint,
  getWrapperStyles: getManifoldWrapperStyles,
  hasInjectedCard: hasManifoldInjectedCard,
});

registerAdapterWithRetry(ManifoldMarketsAdapter, 100, 50);

export { ManifoldMarketsAdapter };
