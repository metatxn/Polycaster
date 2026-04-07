import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import { extractPostIdFromAttributes } from "./helpers";

const YouTubeAdapter = createBasicAdapter({
  name: "youtube",
  hostPatterns: [/^(?:www\.|m\.)?youtube\.com$/],
  itemSelectors: [
    "ytd-comment-thread-renderer",
    "ytd-comment-view-model",
    "ytd-comment-renderer",
  ],
  containerSelectors: ["#comments", "ytd-comments", "#sections", "body"],
  textSelectors: ["#content-text", "yt-formatted-string#content-text"],
  referenceSelectors: ["#content-text", "#toolbar"],
  accentColor: "#ff0033",
  fontFamily: "Roboto, Arial, sans-serif",
  getPostId(postElement: Element): string | null {
    return extractPostIdFromAttributes(postElement, ["id", "data-comment-id"]);
  },
});

registerAdapterWithRetry(YouTubeAdapter, 100, 50);

export { YouTubeAdapter };
