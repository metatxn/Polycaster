import { createBasicAdapter } from "./basic-adapter";
import {
  collectTextParts,
  combineTextParts,
  extractPostIdFromAttributes,
  extractPostIdFromLink,
  normalizeText,
} from "./helpers";

const DEFAULT_CONTAINER_SELECTORS = ["main", '[role="main"]', "body"];

const DEFAULT_TEXT_SELECTORS = [
  "h1",
  "h2",
  "h3",
  "p",
  "blockquote",
  "li",
  "[data-slate-string='true']",
  "[class*='title']",
  "[class*='headline']",
  "[class*='excerpt']",
  "[class*='description']",
  "[class*='summary']",
];

const DEFAULT_REFERENCE_SELECTORS = [
  "h1",
  "h2",
  "h3",
  "[class*='title']",
  "[class*='headline']",
  "[class*='excerpt']",
  "[class*='description']",
  "p",
];

interface EditorialPlatformConfig {
  name: string;
  hostPatterns: RegExp[];
  itemSelectors: string[];
  accentColor: string;
  fontFamily?: string;
  borderRadius?: string;
  containerSelectors?: string[];
  textSelectors?: string[];
  referenceSelectors?: string[];
  linkPattern?: RegExp;
}

export function createEditorialPlatformAdapter(
  config: EditorialPlatformConfig
) {
  const textSelectors = config.textSelectors || DEFAULT_TEXT_SELECTORS;
  const titleSelectors = [
    "h1",
    "h2",
    "h3",
    "[class*='title']",
    "[class*='headline']",
  ];

  return createBasicAdapter({
    name: config.name,
    hostPatterns: config.hostPatterns,
    itemSelectors: config.itemSelectors,
    containerSelectors:
      config.containerSelectors || DEFAULT_CONTAINER_SELECTORS,
    textSelectors,
    referenceSelectors:
      config.referenceSelectors || DEFAULT_REFERENCE_SELECTORS,
    accentColor: config.accentColor,
    fontFamily:
      config.fontFamily ||
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    borderRadius: config.borderRadius || "12px",
    extractPostText(postElement: Element): string {
      const title = normalizeText(
        postElement.querySelector(titleSelectors.join(", "))?.textContent
      );
      const parts = collectTextParts(postElement, textSelectors);
      return combineTextParts(title ? [title, ...parts] : parts);
    },
    getPostId(postElement: Element): string | null {
      return (
        extractPostIdFromAttributes(postElement, [
          "data-id",
          "data-post-id",
          "data-testid",
          "id",
        ]) ||
        (config.linkPattern
          ? extractPostIdFromLink(postElement, config.linkPattern)
          : null)
      );
    },
  });
}
