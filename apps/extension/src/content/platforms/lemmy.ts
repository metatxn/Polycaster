import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import { extractPostIdFromAttributes } from "./helpers";

const LemmyAdapter = createBasicAdapter({
  name: "lemmy",
  hostPatterns: [
    /^(?:www\.)?lemmy\.world$/,
    /^(?:www\.)?lemmy\.ml$/,
    /^(?:www\.)?sh\.itjust\.works$/,
    /^(?:www\.)?programming\.dev$/,
    /^(?:www\.)?beehaw\.org$/,
    /^(?:www\.)?feddit\.org$/,
    /^(?:www\.)?lemm\.ee$/,
  ],
  itemSelectors: [".post-listing", ".post-view", ".comment", ".comment-node"],
  containerSelectors: ["#app", "main", '[role="main"]', "body"],
  textSelectors: [
    ".post-title",
    ".md-div",
    ".comment-content",
    ".comment-body",
    ".md-div p",
  ],
  beforeSelectors: [".post-actions", ".comment-actions"],
  accentColor: "#5e8c31",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  getPostId(postElement: Element): string | null {
    return extractPostIdFromAttributes(postElement, [
      "data-post-id",
      "data-comment-id",
      "id",
    ]);
  },
});

registerAdapterWithRetry(LemmyAdapter, 100, 50);

export { LemmyAdapter };
