import type { PlatformAdapter } from "../../types/platform";
import { createBasicAdapter } from "./basic-adapter";
import { extractPostIdFromAttributes, extractPostIdFromLink } from "./helpers";

const MastodonAdapter = createBasicAdapter({
  name: "mastodon",
  hostPatterns: [
    /^(?:www\.)?mastodon\.social$/,
    /^(?:www\.)?mstdn\.social$/,
    /^(?:www\.)?fosstodon\.org$/,
    /^(?:www\.)?hachyderm\.io$/,
    /^(?:www\.)?mas\.to$/,
    /^(?:www\.)?infosec\.exchange$/,
  ],
  itemSelectors: [
    ".status",
    ".detailed-status",
    ".conversation__status",
    ".entry",
  ],
  containerSelectors: [
    "main",
    ".columns-area__panels__main",
    '[role="main"]',
    "body",
  ],
  textSelectors: [
    ".status__content",
    ".reply-indicator__content",
    ".e-content",
  ],
  beforeSelectors: [".status__action-bar", ".detailed-status__action-bar"],
  accentColor: "#6364ff",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  getPostId(postElement: Element): string | null {
    return (
      extractPostIdFromLink(postElement, /\/statuses\/(\d+)/) ||
      extractPostIdFromAttributes(postElement, ["data-id", "id"])
    );
  },
});

export const adapter: PlatformAdapter = MastodonAdapter;

export { MastodonAdapter };
