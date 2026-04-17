import { collectTextParts, combineTextParts } from "../helpers";
import {
  getFirstMatchingText,
  stripTrailingBylineFragment,
} from "../story-adapter-helpers";

// Hosts that can rely on the generic editorial fallback without per-site
// extraction or injection overrides in the family-specific modules.
export const GENERIC_EDITORIAL_HOST_PATTERNS = [
  /^(?:www\.)?wired\.com$/,
  /^(?:www\.)?theverge\.com$/,
  /^(?:www\.)?arstechnica\.com$/,
  /^(?:www\.)?macrumors\.com$/,
  /^(?:www\.)?reuters\.com$/,
  /^(?:www\.)?bbc\.com$/,
  /^(?:www\.)?aljazeera\.com$/,
  /^(?:www\.)?axios\.com$/,
  /^(?:www\.)?zerohedge\.com$/,
  /^(?:www\.)?time\.com$/,
  /^(?:www\.)?theatlantic\.com$/,
  /^(?:www\.)?indianexpress\.com$/,
  /^(?:www\.)?espn\.com$/,
  /^(?:www\.)?espn\.in$/,
  /^(?:www\.)?cbssports\.com$/,
  /^(?:www\.)?pcworld\.com$/,
] as const;

export const BASE_EDITORIAL_ITEM_SELECTORS = [
  ".loop-card",
  ".duet--content-cards--content-card",
  ".apnews_story_feed",
  ".apnews_story_feed_dynamic",
  ".apnews_story_rail_large",
  ".contentItem",
  "[data-testid='SummaryRiverSection'] > div",
  "[class*='SummaryItemWrapper-']",
  "[class*='story-card-module__tpl-']",
  "[class*='media-story-card-module__hub__']",
  "[class*='story-collection-module__story__']",
  ".headlineStack__list li",
  "[class*='article-card']",
  "[class*='headlineStack'] li",
  "main > article",
  "article",
] as const;

export const BASE_EDITORIAL_CONTAINER_SELECTORS = [
  "main",
  "#main-content",
  '[role="main"]',
  ".duet--layout--river-container",
  "body",
] as const;

export const EDITORIAL_TITLE_SELECTORS = [
  ".loop-card__title-link",
  ".loop-card__title",
  ".clickable-multi-line-link",
  "[data-testid='SummaryItemHed']",
  ".summary-item__hed-link",
  ".contentItem__title",
  "[class*='story-card-module__headline__']",
  "[class*='media-story-card-module__headline__']",
  ".headlineStack__list li a",
  ".duet--content-cards--content-card h1",
  ".duet--content-cards--content-card h2",
  ".duet--content-cards--content-card h3",
  ".duet--content-cards--content-card a",
  "h1",
  "h2",
  "h3",
  "h4",
  "[class*='title']",
  "[class*='headline']",
] as const;

export const EDITORIAL_SUMMARY_SELECTORS = [
  ".loop-card__content p",
  ".summary-item__content",
  ".contentItem__subhead",
  "[class*='story-card-module__area-description__']",
  "[class*='summary']",
  "[class*='description']",
  ".duet--content-cards--content-card p",
  "p",
] as const;

export const BASE_EDITORIAL_TEXT_SELECTORS = [
  ".loop-card__title-link",
  ".loop-card__title",
  ".loop-card__content p",
  ".clickable-multi-line-link",
  "[data-testid='SummaryItemHed']",
  ".summary-item__hed-link",
  ".summary-item__content",
  ".duet--content-cards--content-card a",
  ".contentItem__title",
  ".contentItem__subhead",
  "[class*='story-card-module__headline__']",
  "[class*='media-story-card-module__headline__']",
  "[class*='story-card-module__area-description__']",
  ".headlineStack__list li a",
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "blockquote",
  "li",
  "[class*='title']",
  "[class*='headline']",
  "[class*='summary']",
  "[class*='description']",
] as const;

export const BASE_EDITORIAL_REFERENCE_SELECTORS = [
  ".loop-card",
  ".duet--content-cards--content-card",
  ".apnews_story_feed",
  ".apnews_story_feed_dynamic",
  ".apnews_story_rail_large",
  ".contentItem",
  "[class*='story-card-module__tpl-']",
  "[class*='media-story-card-module__hub__']",
  "[class*='story-collection-module__story__']",
  ".headlineStack__list li",
  "article",
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
] as const;

export function extractGenericEditorialPostText(postElement: Element): string {
  const title = getFirstMatchingText(postElement, EDITORIAL_TITLE_SELECTORS);
  const summary = stripTrailingBylineFragment(
    getFirstMatchingText(postElement, EDITORIAL_SUMMARY_SELECTORS)
  );
  const focusedText = combineTextParts([title, summary]);
  if (focusedText) {
    return focusedText;
  }

  return combineTextParts([
    ...collectTextParts(postElement, [...EDITORIAL_TITLE_SELECTORS]),
    ...collectTextParts(postElement, [...EDITORIAL_SUMMARY_SELECTORS]),
  ]);
}
