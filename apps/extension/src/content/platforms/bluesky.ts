import type { PlatformAdapter } from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import { extractPostIdFromAttributes, extractPostIdFromLink } from "./helpers";

const BlueskyAdapter = createBasicAdapter({
  name: "bluesky",
  hostPatterns: [/^bsky\.app$/],
  itemSelectors: [
    "[data-testid^='feedItem-']",
    "[data-testid='postThreadItem']",
    "article",
  ],
  containerSelectors: ["main", '[role="main"]', "body"],
  textSelectors: ["[data-testid='postText']", "div[dir='auto']"],
  referenceSelectors: ["[data-testid='postText']", "div[dir='auto']"],
  accentColor: "#1185fe",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  getPostId(postElement: Element): string | null {
    return (
      extractPostIdFromLink(postElement, /\/post\/([^/?#]+)/) ||
      extractPostIdFromAttributes(postElement, ["data-testid", "id"])
    );
  },
});

export const adapter: PlatformAdapter = BlueskyAdapter;

export { BlueskyAdapter };
